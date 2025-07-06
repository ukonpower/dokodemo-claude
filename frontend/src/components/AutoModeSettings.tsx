import React, { useState, useEffect } from 'react';
import { Socket } from 'socket.io-client';

interface AutoModeConfig {
  id: string;
  name: string;
  prompt: string;
  repositoryPath: string;
  isEnabled: boolean;
  triggerMode: 'hook';
  createdAt: number;
  updatedAt: number;
}

interface AutoModeState {
  repositoryPath: string;
  isRunning: boolean;
  currentConfigId?: string;
  lastExecutionTime?: number;
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
  }, [repositoryPath, socket]);

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
    }) => {
      if (data.repositoryPath === repositoryPath) {
        setAutoModeState((prev) => ({
          repositoryPath: data.repositoryPath,
          isRunning: data.isRunning,
          currentConfigId: data.configId,
          lastExecutionTime: prev?.lastExecutionTime,
        }));
      }
    };

    socket.on('automode-configs-list', handleConfigsList);
    socket.on('automode-config-created', handleConfigCreated);
    socket.on('automode-config-updated', handleConfigUpdated);
    socket.on('automode-config-deleted', handleConfigDeleted);
    socket.on('automode-status-changed', handleAutoModeStatusChanged);

    return () => {
      socket.off('automode-configs-list', handleConfigsList);
      socket.off('automode-config-created', handleConfigCreated);
      socket.off('automode-config-updated', handleConfigUpdated);
      socket.off('automode-config-deleted', handleConfigDeleted);
      socket.off('automode-status-changed', handleAutoModeStatusChanged);
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
    });
  };

  const handleDeleteConfig = (configId: string) => {
    if (!socket) return;
    if (confirm('この自走モード設定を削除しますか？')) {
      socket.emit('delete-automode-config', { configId });
    }
  };

  const handleToggleEnabled = (config: AutoModeConfig) => {
    if (!socket) return;
    socket.emit('update-automode-config', {
      id: config.id,
      name: config.name,
      prompt: config.prompt,
      isEnabled: !config.isEnabled,
      triggerMode: config.triggerMode,
    });
  };

  const handleStartAutoMode = (configId: string) => {
    if (!socket) return;
    socket.emit('start-automode', { repositoryPath, configId });
  };

  const handleStopAutoMode = () => {
    if (!socket) return;
    socket.emit('stop-automode', { repositoryPath });
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
          className={`p-4 rounded-lg border-2 ${autoModeState.isRunning
              ? 'bg-green-900 border-green-600'
              : 'bg-gray-700 border-gray-600'
            }`}
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-3 min-w-0 flex-1">
              <div
                className={`w-3 h-3 rounded-full ${autoModeState.isRunning
                    ? 'bg-green-400 animate-pulse'
                    : 'bg-gray-400'
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
                  </>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 設定管理セクション */}
      <div className="bg-gray-700 p-4 rounded-lg">
        <div className="flex justify-between items-center mb-4">
          <h3 className="text-base sm:text-lg font-semibold text-white">
            自走モード設定
          </h3>
          <button
            onClick={() => setShowCreateForm(!showCreateForm)}
            className="bg-blue-500 text-white px-3 py-1 rounded text-sm hover:bg-blue-600 transition-colors"
          >
            {showCreateForm ? 'キャンセル' : '+ 新規作成'}
          </button>
        </div>

        {showCreateForm && (
          <div className="bg-gray-600 p-4 rounded border border-gray-500 mb-4">
            <h4 className="font-semibold mb-3 text-white text-sm sm:text-base">
              新しい自走モード設定
            </h4>
            <div className="bg-blue-900 p-3 rounded-md mb-4 border border-blue-600">
              <p className="text-xs sm:text-sm text-blue-200">
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
                  className="w-full px-3 py-2 bg-gray-700 border border-gray-500 text-white rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 text-xs sm:text-sm"
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
                  className="w-full px-3 py-2 bg-gray-700 border border-gray-500 text-white rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 text-xs sm:text-sm"
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
              <div className="flex space-x-2">
                <button
                  onClick={handleCreateConfig}
                  className="bg-blue-500 text-white px-4 py-2 rounded hover:bg-blue-600 transition-colors text-xs sm:text-sm"
                >
                  作成
                </button>
                <button
                  onClick={() => setShowCreateForm(false)}
                  className="bg-gray-500 text-white px-4 py-2 rounded hover:bg-gray-400 transition-colors text-xs sm:text-sm"
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
                  className={`p-4 rounded border border-gray-500 ${autoModeState?.isRunning && !isCurrentlyRunning
                      ? 'bg-gray-700 opacity-50'
                      : 'bg-gray-600'
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
                          className="w-full px-3 py-2 bg-gray-700 border border-gray-500 text-white rounded focus:outline-none focus:ring-2 focus:ring-blue-500 text-xs sm:text-sm"
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
                          className="w-full px-3 py-2 bg-gray-700 border border-gray-500 text-white rounded focus:outline-none focus:ring-2 focus:ring-blue-500 text-xs sm:text-sm"
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
                      <div className="flex space-x-2">
                        <button
                          onClick={handleUpdateConfig}
                          className="bg-blue-500 text-white px-4 py-2 rounded hover:bg-blue-600 transition-colors text-xs sm:text-sm"
                        >
                          保存
                        </button>
                        <button
                          onClick={() => setEditingConfig(null)}
                          className="bg-gray-500 text-white px-4 py-2 rounded hover:bg-gray-400 transition-colors text-xs sm:text-sm"
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
                              className={`inline-block px-2 py-1 rounded-full text-xs font-medium ${isCurrentlyRunning
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

                      <div className="bg-gray-700 p-3 rounded">
                        <p className="text-gray-200 text-xs sm:text-sm whitespace-pre-wrap">
                          {config.prompt}
                        </p>
                      </div>

                      <div className="flex space-x-2">
                        {!isCurrentlyRunning && (
                          <>
                            <button
                              onClick={() => setEditingConfig(config)}
                              className="bg-gray-500 text-gray-100 px-3 py-1 rounded text-xs sm:text-sm hover:bg-gray-400 transition-colors"
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

                      <div className="text-xs text-gray-400 pt-2 border-t border-gray-600">
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
