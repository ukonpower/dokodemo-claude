import React, { useState, useEffect } from 'react';
import { Socket } from 'socket.io-client';

interface AutoModeConfig {
  id: string;
  name: string;
  prompt: string;
  repositoryPath: string;
  isEnabled: boolean;
  triggerMode: 'hook';
  sendClearCommand: boolean;
  createdAt: number;
  updatedAt: number;
}

interface AutoModeState {
  repositoryPath: string;
  isRunning: boolean;
  currentConfigId?: string;
  lastExecutionTime?: number;
  isWaiting?: boolean;
  remainingTime?: number;
}

interface AutoModeSettingsProps {
  socket: Socket;
  repositoryPath: string;
  configs?: AutoModeConfig[];
  autoModeState?: AutoModeState | null;
}

const AutoModeSettings: React.FC<AutoModeSettingsProps> = ({
  socket,
  repositoryPath,
  configs: initialConfigs = [],
  autoModeState: initialAutoModeState = null,
}) => {
  const [configs, setConfigs] = useState<AutoModeConfig[]>(initialConfigs);
  const [autoModeState, setAutoModeState] = useState<AutoModeState | null>(
    initialAutoModeState
  );
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [editingConfig, setEditingConfig] = useState<AutoModeConfig | null>(
    null
  );
  const [newConfig, setNewConfig] = useState({
    name: '',
    prompt: '',
    isEnabled: true,
    triggerMode: 'hook' as const,
    sendClearCommand: true,
  });

  // propsからの初期値を反映
  useEffect(() => {
    setConfigs(initialConfigs);
  }, [initialConfigs]);

  useEffect(() => {
    setAutoModeState(initialAutoModeState);
  }, [initialAutoModeState]);

  useEffect(() => {
    if (repositoryPath && socket) {
      loadConfigs();
      loadAutoModeStatus();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [repositoryPath, socket]);

  // カウントダウンタイマー
  useEffect(() => {
    if (autoModeState?.isWaiting && autoModeState.remainingTime) {
      const interval = setInterval(() => {
        setAutoModeState((prev) => {
          if (!prev || !prev.isWaiting || !prev.remainingTime) {
            return prev;
          }
          const newRemainingTime = prev.remainingTime - 1;
          if (newRemainingTime <= 0) {
            return {
              ...prev,
              isWaiting: false,
              remainingTime: undefined,
            };
          }
          return {
            ...prev,
            remainingTime: newRemainingTime,
          };
        });
      }, 1000);

      return () => clearInterval(interval);
    }
  }, [autoModeState?.isWaiting, autoModeState?.remainingTime]);

  const loadConfigs = () => {
    if (!socket) return;
    socket.emit('get-automode-configs', { repositoryPath });
  };

  const loadAutoModeStatus = () => {
    if (!socket) return;
    socket.emit('get-automode-status', { repositoryPath });
  };

  useEffect(() => {
    if (!socket) return;

    const handleConfigsList = (data: { configs: AutoModeConfig[] }) => {
      setConfigs(data.configs);
    };

    const handleConfigCreated = (data: {
      success: boolean;
      message: string;
      config?: AutoModeConfig;
    }) => {
      if (data.success && data.config) {
        setConfigs((prev) => [...prev, data.config!]);
        setShowCreateForm(false);
        setNewConfig({
          name: '',
          prompt: '',
          isEnabled: true,
          triggerMode: 'hook',
          sendClearCommand: true,
        });
      }
    };

    const handleConfigUpdated = (data: {
      success: boolean;
      message: string;
      config?: AutoModeConfig;
    }) => {
      if (data.success && data.config) {
        setConfigs((prev) =>
          prev.map((c) => (c.id === data.config!.id ? data.config! : c))
        );
        setEditingConfig(null);
      }
    };

    const handleConfigDeleted = (data: {
      success: boolean;
      message: string;
      configId?: string;
    }) => {
      if (data.success && data.configId) {
        setConfigs((prev) => prev.filter((c) => c.id !== data.configId));
      }
    };

    const handleAutoModeStatusChanged = (data: {
      repositoryPath: string;
      isRunning: boolean;
      configId?: string;
      isWaiting?: boolean;
      remainingTime?: number;
    }) => {
      if (data.repositoryPath === repositoryPath) {
        setAutoModeState((prev) => ({
          repositoryPath: data.repositoryPath,
          isRunning: data.isRunning,
          currentConfigId: data.configId,
          lastExecutionTime: prev?.lastExecutionTime,
          isWaiting: data.isWaiting,
          remainingTime: data.remainingTime,
        }));
      }
    };

    const handleAutoModeWaiting = (data: {
      repositoryPath: string;
      remainingTime: number;
      nextExecutionTime: number;
    }) => {
      if (data.repositoryPath === repositoryPath) {
        setAutoModeState((prev) => {
          if (!prev) return null;
          return {
            ...prev,
            isWaiting: true,
            remainingTime: data.remainingTime,
          };
        });
      }
    };

    const handleManualPromptSent = (data: {
      repositoryPath: string;
      success: boolean;
      message: string;
    }) => {
      if (data.repositoryPath === repositoryPath) {
        // 手動プロンプト送信結果の処理（必要に応じて通知やUIの更新）
        if (data.success) {
          // 成功時の処理
          console.log('Manual prompt sent successfully:', data.message);
        } else {
          // 失敗時の処理
          console.error('Manual prompt failed:', data.message);
        }
      }
    };

    socket.on('automode-configs-list', handleConfigsList);
    socket.on('automode-config-created', handleConfigCreated);
    socket.on('automode-config-updated', handleConfigUpdated);
    socket.on('automode-config-deleted', handleConfigDeleted);
    socket.on('automode-status-changed', handleAutoModeStatusChanged);
    socket.on('automode-waiting', handleAutoModeWaiting);
    socket.on('manual-prompt-sent', handleManualPromptSent);

    return () => {
      socket.off('automode-configs-list', handleConfigsList);
      socket.off('automode-config-created', handleConfigCreated);
      socket.off('automode-config-updated', handleConfigUpdated);
      socket.off('automode-config-deleted', handleConfigDeleted);
      socket.off('automode-status-changed', handleAutoModeStatusChanged);
      socket.off('automode-waiting', handleAutoModeWaiting);
      socket.off('manual-prompt-sent', handleManualPromptSent);
    };
  }, [socket, repositoryPath]);

  const handleCreateConfig = () => {
    if (!socket) return;
    if (newConfig.name.trim() && newConfig.prompt.trim()) {
      socket.emit('create-automode-config', {
        name: newConfig.name.trim(),
        prompt: newConfig.prompt.trim(),
        repositoryPath,
        isEnabled: newConfig.isEnabled,
        triggerMode: newConfig.triggerMode,
        sendClearCommand: newConfig.sendClearCommand,
      });
    }
  };

  const handleUpdateConfig = () => {
    if (!socket || !editingConfig) return;
    socket.emit('update-automode-config', {
      id: editingConfig.id,
      name: editingConfig.name,
      prompt: editingConfig.prompt,
      isEnabled: editingConfig.isEnabled,
      triggerMode: editingConfig.triggerMode,
      sendClearCommand: editingConfig.sendClearCommand,
    });
  };

  const handleDeleteConfig = (configId: string) => {
    if (!socket) return;
    if (confirm('この自走モード設定を削除しますか？')) {
      socket.emit('delete-automode-config', { configId });
    }
  };

  const handleStartAutoMode = (configId: string) => {
    if (!socket) return;
    socket.emit('start-automode', { repositoryPath, configId });
  };

  const handleStopAutoMode = () => {
    if (!socket) return;
    socket.emit('stop-automode', { repositoryPath });
  };

  const handleForceExecute = () => {
    if (!socket) return;
    socket.emit('force-execute-automode', { repositoryPath });
  };

  const handleManualPrompt = () => {
    if (!socket) return;
    socket.emit('send-manual-prompt', { repositoryPath });
  };

  // socketが利用できない場合は何も表示しない
  if (!socket) {
    return (
      <div className="p-4 text-center text-gray-400">
        <p>接続を確立しています...</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* 自走モード状態表示 */}
      {autoModeState && (
        <div
          className={`p-4 rounded-lg border-2 ${
            autoModeState.isRunning
              ? 'bg-green-900 border-green-600'
              : 'bg-gray-900 border-dark-border-light'
          }`}
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-3 min-w-0 flex-1">
              <div
                className={`w-3 h-3 rounded-full ${
                  autoModeState.isRunning
                    ? 'bg-green-400 animate-pulse'
                    : 'bg-gray-500'
                }`}
              ></div>
              <div className="min-w-0 flex-1">
                <h4 className="font-semibold text-white text-sm sm:text-base">
                  自走モード:{' '}
                  {autoModeState.isRunning
                    ? '実行中（バックエンドで継続動作）'
                    : '停止中'}
                </h4>
                {autoModeState.isRunning && autoModeState.currentConfigId && (
                  <>
                    <p className="text-xs sm:text-sm text-gray-300 truncate">
                      実行中の設定:{' '}
                      {configs.find(
                        (c) => c.id === autoModeState.currentConfigId
                      )?.name || '不明'}
                    </p>
                    {autoModeState.lastExecutionTime && (
                      <p className="text-xs text-gray-400 mt-1">
                        最終実行:{' '}
                        {new Date(
                          autoModeState.lastExecutionTime
                        ).toLocaleString()}
                      </p>
                    )}
                    <div className="mt-2 flex items-center space-x-2">
                      <button
                        onClick={handleManualPrompt}
                        className="px-3 py-1 text-xs bg-green-600 hover:bg-green-700 text-white rounded transition-colors"
                      >
                        プロンプト送信
                      </button>
                      {autoModeState.isWaiting &&
                        autoModeState.remainingTime && (
                          <>
                            <p className="text-sm text-yellow-400">
                              次回実行まで:{' '}
                              {Math.floor(autoModeState.remainingTime / 60)}分{' '}
                              {autoModeState.remainingTime % 60}秒
                            </p>
                            <button
                              onClick={handleForceExecute}
                              className="px-3 py-1 text-xs bg-yellow-600 hover:bg-yellow-700 text-white rounded transition-colors"
                            >
                              今すぐ実行
                            </button>
                          </>
                        )}
                    </div>
                  </>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 設定管理セクション */}
      <div className="bg-gray-900 p-4 rounded-lg border border-dark-border-DEFAULT">
        <div className="flex justify-between items-center mb-4">
          <h3 className="text-base sm:text-lg font-semibold text-white">
            自走モード設定
          </h3>
          <button
            onClick={() => setShowCreateForm(!showCreateForm)}
            className="bg-gray-800 text-gray-100 border border-dark-border-light px-3 py-1 rounded text-sm hover:bg-gray-700 transition-colors"
          >
            {showCreateForm ? 'キャンセル' : '+ 新規作成'}
          </button>
        </div>

        {showCreateForm && (
          <div className="bg-gray-600 p-4 rounded border border-dark-border-light mb-4">
            <h4 className="font-semibold mb-3 text-white text-sm sm:text-base">
              新しい自走モード設定
            </h4>
            <div className="bg-gray-800 p-3 rounded-md mb-4 border border-dark-border-light">
              <p className="text-xs sm:text-sm text-gray-300">
                🚀 <strong>自走モードについて:</strong>
                <br />
                バックエンドで定期的に実行されるため、ブラウザを閉じても継続動作します。
                Claude Code
                CLIに対して設定されたプロンプトを自動送信し、継続的な作業を行います。
              </p>
            </div>
            <div className="space-y-3">
              <div>
                <label className="block text-xs sm:text-sm font-medium text-gray-200 mb-1">
                  設定名
                </label>
                <input
                  type="text"
                  value={newConfig.name}
                  onChange={(e) =>
                    setNewConfig({ ...newConfig, name: e.target.value })
                  }
                  className="w-full px-3 py-2 bg-gray-900 border border-dark-border-light text-white rounded-md focus:outline-none focus:ring-2 focus:ring-dark-border-focus text-xs sm:text-sm"
                  placeholder="例: 継続的リファクタリング"
                />
              </div>
              <div>
                <label className="block text-xs sm:text-sm font-medium text-gray-200 mb-1">
                  実行するプロンプト
                </label>
                <textarea
                  value={newConfig.prompt}
                  onChange={(e) =>
                    setNewConfig({ ...newConfig, prompt: e.target.value })
                  }
                  className="w-full px-3 py-2 bg-gray-900 border border-dark-border-light text-white rounded-md focus:outline-none focus:ring-2 focus:ring-dark-border-focus text-xs sm:text-sm"
                  rows={4}
                  placeholder="例: 現在のコードベースを見直して、改善点があれば教えてください。可能であれば実装も行ってください。"
                />
              </div>
              <div>
                <label className="block text-xs sm:text-sm font-medium text-gray-200 mb-1">
                  トリガーモード
                </label>
                <div className="space-y-2">
                  <label className="flex items-center">
                    <input
                      type="radio"
                      name="triggerMode"
                      value="hook"
                      checked={true}
                      disabled={true}
                      className="mr-2"
                    />
                    <span className="text-xs sm:text-sm text-gray-200">
                      Hookモード（Claude Code実行完了時に自動実行）
                    </span>
                  </label>
                </div>
              </div>
              <div className="flex items-center">
                <input
                  type="checkbox"
                  id="enabled"
                  checked={newConfig.isEnabled}
                  onChange={(e) =>
                    setNewConfig({ ...newConfig, isEnabled: e.target.checked })
                  }
                  className="mr-2"
                />
                <label
                  htmlFor="enabled"
                  className="text-xs sm:text-sm text-gray-200"
                >
                  この設定を有効にする
                </label>
              </div>
              <div className="flex items-center">
                <input
                  type="checkbox"
                  id="sendClearCommand"
                  checked={newConfig.sendClearCommand}
                  onChange={(e) =>
                    setNewConfig({
                      ...newConfig,
                      sendClearCommand: e.target.checked,
                    })
                  }
                  className="mr-2"
                />
                <label
                  htmlFor="sendClearCommand"
                  className="text-xs sm:text-sm text-gray-200"
                >
                  プロンプト送信前に/clearコマンドを送信する
                </label>
              </div>
              <div className="flex space-x-2">
                <button
                  onClick={handleCreateConfig}
                  className="bg-gray-800 text-gray-100 border border-dark-border-light px-4 py-2 rounded hover:bg-gray-700 transition-colors text-xs sm:text-sm"
                >
                  作成
                </button>
                <button
                  onClick={() => setShowCreateForm(false)}
                  className="bg-gray-700 text-gray-100 px-4 py-2 rounded hover:bg-gray-600 transition-colors text-xs sm:text-sm"
                >
                  キャンセル
                </button>
              </div>
            </div>
          </div>
        )}

        <div className="space-y-2">
          {configs.length === 0 ? (
            <p className="text-gray-400 text-center py-8 text-xs sm:text-sm">
              自走モード設定がありません。「+ 新規作成」から追加してください。
            </p>
          ) : (
            configs.map((config) => {
              const isCurrentlyRunning =
                autoModeState?.isRunning &&
                autoModeState.currentConfigId === config.id;

              return (
                <div
                  key={config.id}
                  className={`p-4 rounded border border-dark-border-DEFAULT ${
                    autoModeState?.isRunning && !isCurrentlyRunning
                      ? 'bg-gray-800 opacity-50'
                      : 'bg-gray-800'
                  }`}
                >
                  {editingConfig?.id === config.id ? (
                    <div className="space-y-3">
                      <div>
                        <label className="block text-xs sm:text-sm font-medium text-gray-200 mb-1">
                          設定名
                        </label>
                        <input
                          type="text"
                          value={editingConfig.name}
                          onChange={(e) =>
                            setEditingConfig({
                              ...editingConfig,
                              name: e.target.value,
                            })
                          }
                          className="w-full px-3 py-2 bg-gray-900 border border-dark-border-light text-white rounded focus:outline-none focus:ring-2 focus:ring-dark-border-focus text-xs sm:text-sm"
                        />
                      </div>
                      <div>
                        <label className="block text-xs sm:text-sm font-medium text-gray-200 mb-1">
                          実行するプロンプト
                        </label>
                        <textarea
                          value={editingConfig.prompt}
                          onChange={(e) =>
                            setEditingConfig({
                              ...editingConfig,
                              prompt: e.target.value,
                            })
                          }
                          className="w-full px-3 py-2 bg-gray-900 border border-dark-border-light text-white rounded focus:outline-none focus:ring-2 focus:ring-dark-border-focus text-xs sm:text-sm"
                          rows={4}
                        />
                      </div>
                      <div>
                        <label className="block text-xs sm:text-sm font-medium text-gray-200 mb-1">
                          トリガーモード
                        </label>
                        <div className="space-y-2">
                          <label className="flex items-center">
                            <input
                              type="radio"
                              name={`triggerMode-${config.id}`}
                              value="hook"
                              checked={true}
                              disabled={true}
                              className="mr-2"
                            />
                            <span className="text-xs sm:text-sm text-gray-200">
                              Hookモード（Claude Code実行完了時に自動実行）
                            </span>
                          </label>
                        </div>
                      </div>
                      <div className="flex items-center">
                        <input
                          type="checkbox"
                          id={`enabled-${config.id}`}
                          checked={editingConfig.isEnabled}
                          onChange={(e) =>
                            setEditingConfig({
                              ...editingConfig,
                              isEnabled: e.target.checked,
                            })
                          }
                          className="mr-2"
                        />
                        <label
                          htmlFor={`enabled-${config.id}`}
                          className="text-xs sm:text-sm text-gray-200"
                        >
                          この設定を有効にする
                        </label>
                      </div>
                      <div className="flex items-center">
                        <input
                          type="checkbox"
                          id={`sendClearCommand-${config.id}`}
                          checked={editingConfig.sendClearCommand}
                          onChange={(e) =>
                            setEditingConfig({
                              ...editingConfig,
                              sendClearCommand: e.target.checked,
                            })
                          }
                          className="mr-2"
                        />
                        <label
                          htmlFor={`sendClearCommand-${config.id}`}
                          className="text-xs sm:text-sm text-gray-200"
                        >
                          プロンプト送信前に/clearコマンドを送信する
                        </label>
                      </div>
                      <div className="flex space-x-2">
                        <button
                          onClick={handleUpdateConfig}
                          className="bg-gray-800 text-gray-100 border border-dark-border-light px-4 py-2 rounded hover:bg-gray-700 transition-colors text-xs sm:text-sm"
                        >
                          保存
                        </button>
                        <button
                          onClick={() => setEditingConfig(null)}
                          className="bg-gray-700 text-gray-100 px-4 py-2 rounded hover:bg-gray-600 transition-colors text-xs sm:text-sm"
                        >
                          キャンセル
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="space-y-3">
                      <div className="flex justify-between items-start">
                        <div>
                          <h4 className="font-semibold text-white text-sm sm:text-base">
                            {config.name}
                          </h4>
                          <div className="flex items-center space-x-2 mt-1">
                            <span
                              className={`inline-block px-2 py-1 rounded-full text-xs font-medium ${
                                isCurrentlyRunning
                                  ? 'bg-green-600 text-green-100'
                                  : config.isEnabled
                                    ? 'bg-green-600 text-green-100'
                                    : 'bg-gray-500 text-gray-200'
                              }`}
                            >
                              {isCurrentlyRunning
                                ? '実行中'
                                : config.isEnabled
                                  ? '有効'
                                  : '無効'}
                            </span>
                            <span className="text-xs text-gray-400">
                              Hookモード
                            </span>
                            <span className="text-xs text-gray-400">
                              {config.sendClearCommand
                                ? 'Clear有効'
                                : 'Clear無効'}
                            </span>
                          </div>
                        </div>
                        {isCurrentlyRunning && (
                          <button
                            onClick={handleStopAutoMode}
                            className="bg-red-500 text-white px-4 py-2 rounded hover:bg-red-600 transition-colors text-xs sm:text-sm"
                          >
                            停止
                          </button>
                        )}
                        {config.isEnabled && !autoModeState?.isRunning && (
                          <button
                            onClick={() => handleStartAutoMode(config.id)}
                            className="bg-green-500 text-white px-4 py-2 rounded hover:bg-green-600 transition-colors text-xs sm:text-sm"
                          >
                            開始
                          </button>
                        )}
                      </div>

                      <div className="bg-gray-900 p-3 rounded border border-dark-border-DEFAULT">
                        <p className="text-gray-200 text-xs sm:text-sm whitespace-pre-wrap">
                          {config.prompt}
                        </p>
                      </div>

                      <div className="flex space-x-2">
                        {!isCurrentlyRunning && (
                          <>
                            <button
                              onClick={() => setEditingConfig(config)}
                              className="bg-gray-700 text-gray-100 px-3 py-1 rounded text-xs sm:text-sm hover:bg-gray-600 transition-colors"
                            >
                              編集
                            </button>
                            <button
                              onClick={() => handleDeleteConfig(config.id)}
                              className="bg-red-600 text-red-100 px-3 py-1 rounded text-xs sm:text-sm hover:bg-red-500 transition-colors"
                            >
                              削除
                            </button>
                          </>
                        )}
                      </div>

                      <div className="text-xs text-gray-400 pt-2 border-t border-dark-border-light">
                        <p>
                          作成:{' '}
                          {new Date(config.createdAt).toLocaleString('ja-JP', {
                            year: 'numeric',
                            month: 'numeric',
                            day: 'numeric',
                            hour: '2-digit',
                            minute: '2-digit',
                          })}
                        </p>
                        {config.updatedAt !== config.createdAt && (
                          <p className="mt-1">
                            更新:{' '}
                            {new Date(config.updatedAt).toLocaleString(
                              'ja-JP',
                              {
                                year: 'numeric',
                                month: 'numeric',
                                day: 'numeric',
                                hour: '2-digit',
                                minute: '2-digit',
                              }
                            )}
                          </p>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
};

export default AutoModeSettings;
