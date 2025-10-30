import React, { useState, useEffect } from 'react';
import type {
  Terminal,
  TerminalMessage,
  TerminalOutputLine,
  CommandShortcut,
} from '../types';
import TerminalComponent from './Terminal';

interface TerminalManagerProps {
  terminals: Terminal[];
  messages: TerminalMessage[];
  histories: Map<string, TerminalOutputLine[]>;
  shortcuts: CommandShortcut[];
  currentRepo: string;
  isConnected: boolean;
  onCreateTerminal: (cwd: string, name?: string) => void;
  onTerminalInput: (terminalId: string, input: string) => void;
  onTerminalSignal: (terminalId: string, signal: string) => void;
  onTerminalResize: (terminalId: string, cols: number, rows: number) => void;
  onCloseTerminal: (terminalId: string) => void;
  onCreateShortcut: (name: string, command: string) => void;
  onDeleteShortcut: (shortcutId: string) => void;
  onExecuteShortcut: (shortcutId: string, terminalId: string) => void;
}

const TerminalManager: React.FC<TerminalManagerProps> = ({
  terminals,
  messages,
  histories,
  shortcuts,
  currentRepo,
  isConnected,
  onCreateTerminal,
  onTerminalInput,
  onTerminalSignal,
  onTerminalResize,
  onCloseTerminal,
  onCreateShortcut,
  onDeleteShortcut,
  onExecuteShortcut,
}) => {
  const [activeTerminalId, setActiveTerminalId] = useState<string>('');
  const [showCreateShortcut, setShowCreateShortcut] = useState(false);
  const [shortcutName, setShortcutName] = useState('');
  const [shortcutCommand, setShortcutCommand] = useState('');

  // 最初のターミナルを自動的にアクティブにする
  useEffect(() => {
    if (terminals.length > 0 && !activeTerminalId) {
      setActiveTerminalId(terminals[0].id);
    }
  }, [terminals, activeTerminalId]);

  // アクティブなターミナルが削除された場合の処理
  useEffect(() => {
    if (activeTerminalId && !terminals.find((t) => t.id === activeTerminalId)) {
      const newActiveId = terminals.length > 0 ? terminals[0].id : '';
      setActiveTerminalId(newActiveId);
    }
  }, [terminals, activeTerminalId]);

  const handleCreateTerminal = () => {
    if (!currentRepo) {
      return;
    }
    const terminalName = `Terminal ${terminals.length + 1}`;
    onCreateTerminal(currentRepo, terminalName);
  };

  const handleCreateShortcut = () => {
    if (!shortcutCommand.trim()) {
      return;
    }
    onCreateShortcut(shortcutName, shortcutCommand.trim());
    setShortcutName('');
    setShortcutCommand('');
    setShowCreateShortcut(false);
  };

  const handleExecuteShortcut = (shortcutId: string) => {
    if (!activeTerminalId) {
      return;
    }
    onExecuteShortcut(shortcutId, activeTerminalId);
  };

  return (
    <div className="absolute inset-0 flex flex-col">
      {/* ターミナルタブ */}
      <div className="bg-gray-900 px-2 sm:px-4 py-2 border-b border-dark-border-DEFAULT flex items-center space-x-1 overflow-x-auto flex-shrink-0">
        {terminals.map((terminal) => (
          <div
            key={terminal.id}
            className={`px-2 sm:px-3 py-1.5 sm:py-1 text-xs sm:text-sm rounded-t-lg flex items-center space-x-1 sm:space-x-2 whitespace-nowrap min-w-0 cursor-pointer transition-all duration-200 ${
              activeTerminalId === terminal.id
                ? 'bg-white text-gray-900 border-2 border-gray-400 border-b-0 font-bold shadow-lg'
                : 'bg-gray-700 text-gray-300 hover:bg-gray-600 border border-gray-600'
            }`}
            onClick={() => setActiveTerminalId(terminal.id)}
          >
            <div
              className={`w-2 h-2 rounded-full flex-shrink-0 ${
                terminal.status === 'active'
                  ? 'bg-green-500'
                  : terminal.status === 'exited'
                    ? 'bg-red-500'
                    : 'bg-yellow-500'
              }`}
            ></div>
            <span className="truncate max-w-20 sm:max-w-none">
              {terminal.name}
            </span>
            <button
              onClick={(e) => {
                e.stopPropagation();
                onCloseTerminal(terminal.id);
              }}
              className="text-xs hover:text-red-400 ml-1 flex-shrink-0 text-gray-300"
            >
              ×
            </button>
          </div>
        ))}

        {/* 新しいターミナル作成ボタン */}
        <button
          onClick={handleCreateTerminal}
          disabled={!isConnected || !currentRepo}
          className="px-2 sm:px-3 py-1.5 sm:py-1 text-xs sm:text-sm bg-gray-800 text-gray-100 border border-dark-border-light rounded-lg hover:bg-gray-700 disabled:bg-gray-900 disabled:text-gray-500 disabled:cursor-not-allowed flex items-center space-x-1 flex-shrink-0"
        >
          <span>+</span>
          <span className="hidden sm:inline">新規</span>
        </button>
      </div>

      {/* ターミナル本体 */}
      <div className="flex-1 min-h-0 flex flex-col">
        <div className="flex-1 min-h-0 h-full relative">
          {terminals.length === 0 ? (
            <div className="h-full flex items-center justify-center bg-gray-900 overflow-y-auto">
              <div className="text-center text-gray-300 max-w-sm mx-auto px-4 py-8">
                <div className="mb-4">
                  <div className="w-12 h-12 mx-auto mb-3 bg-gray-700 rounded-full flex items-center justify-center">
                    <span className="text-xl text-gray-400">$</span>
                  </div>
                  <h3 className="text-base font-medium mb-2">
                    ターミナルがありません
                  </h3>
                  <p className="text-sm text-gray-400 mb-4">
                    新しいターミナルを作成してコマンドラインを開始しましょう
                  </p>
                </div>

                <button
                  onClick={handleCreateTerminal}
                  disabled={!isConnected || !currentRepo}
                  className="px-4 py-2 bg-gray-800 text-gray-100 border border-dark-border-light rounded-lg hover:bg-gray-700 disabled:bg-gray-900 disabled:text-gray-500 disabled:cursor-not-allowed transition-colors duration-200 text-sm font-medium"
                >
                  ターミナルを作成
                </button>

                {!currentRepo && (
                  <div className="mt-3 p-2 bg-yellow-900/20 border border-yellow-700/30 rounded-lg">
                    <p className="text-xs text-yellow-300">
                      先にプロジェクトを選択してください
                    </p>
                  </div>
                )}

                {!isConnected && (
                  <div className="mt-3 p-2 bg-red-900/20 border border-red-700/30 rounded-lg">
                    <p className="text-xs text-red-300">
                      サーバーに接続されていません
                    </p>
                  </div>
                )}
              </div>
            </div>
          ) : (
            terminals.map((terminal) => (
              <div
                key={terminal.id}
                className="absolute inset-0"
                style={{
                  display: activeTerminalId === terminal.id ? 'block' : 'none',
                }}
              >
                <TerminalComponent
                  terminal={terminal}
                  messages={messages}
                  history={histories.get(terminal.id) || []}
                  onInput={onTerminalInput}
                  onSignal={onTerminalSignal}
                  onResize={onTerminalResize}
                />
              </div>
            ))
          )}
        </div>

        {/* コマンドショートカットセクション */}
        {terminals.length > 0 && (
          <div className="border-t border-dark-border-light bg-gray-750 flex-shrink-0">
            <div className="px-3 py-2 border-b border-dark-border-light">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-medium text-gray-200 flex items-center">
                  <svg
                    className="w-4 h-4 mr-2 text-yellow-400"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M13 10V3L4 14h7v7l9-11h-7z"
                    />
                  </svg>
                  コマンドショートカット
                </h3>
                <button
                  onClick={() => setShowCreateShortcut(!showCreateShortcut)}
                  disabled={!isConnected || !currentRepo || !activeTerminalId}
                  className="px-2 py-1 text-xs bg-yellow-600 text-white rounded hover:bg-yellow-700 disabled:bg-gray-600 disabled:cursor-not-allowed flex items-center space-x-1"
                >
                  <span>+</span>
                  <span className="hidden sm:inline">追加</span>
                </button>
              </div>
            </div>

            <div className="px-3 py-2 max-h-32 overflow-y-auto">
              {/* ショートカット作成フォーム */}
              {showCreateShortcut && (
                <div className="mb-3 p-3 bg-gray-800 rounded-lg border border-dark-border-light">
                  <div className="flex flex-col space-y-2">
                    <input
                      type="text"
                      placeholder="ショートカット名（省略可）"
                      value={shortcutName}
                      onChange={(e) => setShortcutName(e.target.value)}
                      className="px-2 py-1 text-xs bg-gray-900 text-white border border-dark-border-light rounded focus:outline-none focus:border-dark-border-focus"
                    />
                    <input
                      type="text"
                      placeholder="コマンド (例: npm run dev)"
                      value={shortcutCommand}
                      onChange={(e) => setShortcutCommand(e.target.value)}
                      className="px-2 py-1 text-xs bg-gray-900 text-white border border-dark-border-light rounded focus:outline-none focus:border-dark-border-focus"
                    />
                    <div className="flex space-x-2">
                      <button
                        onClick={handleCreateShortcut}
                        disabled={!shortcutCommand.trim()}
                        className="px-3 py-1 text-xs bg-green-600 text-white rounded hover:bg-green-700 disabled:bg-gray-600 disabled:cursor-not-allowed"
                      >
                        作成
                      </button>
                      <button
                        onClick={() => {
                          setShowCreateShortcut(false);
                          setShortcutName('');
                          setShortcutCommand('');
                        }}
                        className="px-3 py-1 text-xs bg-gray-600 text-white rounded hover:bg-gray-700"
                      >
                        キャンセル
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {/* ショートカットボタン一覧 */}
              {shortcuts.length > 0 ? (
                <div className="flex flex-wrap gap-2">
                  {shortcuts.map((shortcut) => (
                    <div
                      key={shortcut.id}
                      className="flex items-center space-x-1 bg-gray-800 rounded-lg border border-dark-border-light overflow-hidden"
                    >
                      <button
                        onClick={() => handleExecuteShortcut(shortcut.id)}
                        disabled={!activeTerminalId}
                        className="px-3 py-2 text-xs text-white hover:bg-gray-700 disabled:bg-gray-800 disabled:cursor-not-allowed flex items-center space-x-2"
                        title={`実行: ${shortcut.command}`}
                      >
                        <svg
                          className="w-3 h-3 text-green-400"
                          fill="none"
                          stroke="currentColor"
                          viewBox="0 0 24 24"
                        >
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth={2}
                            d="M14.828 14.828a4 4 0 01-5.656 0M9 10h1m4 0h1m-6 4h1m4 0h1m6-6L10 2l-5 5v6l5 5z"
                          />
                        </svg>
                        <span className="font-medium">
                          {shortcut.name || shortcut.command}
                        </span>
                        {shortcut.name && (
                          <span className="text-gray-400 text-xs hidden sm:inline">
                            ({shortcut.command})
                          </span>
                        )}
                      </button>
                      <button
                        onClick={() => onDeleteShortcut(shortcut.id)}
                        className="px-2 py-2 text-xs text-red-400 hover:text-red-300 hover:bg-red-900/20"
                        title="削除"
                      >
                        ×
                      </button>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-center py-4">
                  <p className="text-xs text-gray-400">
                    コマンドショートカットがありません
                  </p>
                  <p className="text-xs text-gray-500 mt-1">
                    よく使うコマンドを登録して素早く実行できます
                  </p>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default TerminalManager;
