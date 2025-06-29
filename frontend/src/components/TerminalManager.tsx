import React, { useState, useEffect } from 'react';
import type { Terminal, TerminalMessage, TerminalOutputLine } from '../types';
import TerminalComponent from './Terminal';

interface TerminalManagerProps {
  terminals: Terminal[];
  messages: TerminalMessage[];
  histories: Map<string, TerminalOutputLine[]>;
  currentRepo: string;
  isConnected: boolean;
  onCreateTerminal: (cwd: string, name?: string) => void;
  onTerminalInput: (terminalId: string, input: string) => void;
  onTerminalSignal: (terminalId: string, signal: string) => void;
  onCloseTerminal: (terminalId: string) => void;
}

const TerminalManager: React.FC<TerminalManagerProps> = ({
  terminals,
  messages,
  histories,
  currentRepo,
  isConnected,
  onCreateTerminal,
  onTerminalInput,
  onTerminalSignal,
  onCloseTerminal
}) => {
  const [activeTerminalId, setActiveTerminalId] = useState<string>('');

  // 最初のターミナルを自動的にアクティブにする
  useEffect(() => {
    if (terminals.length > 0 && !activeTerminalId) {
      setActiveTerminalId(terminals[0].id);
    }
  }, [terminals, activeTerminalId]);

  // アクティブなターミナルが削除された場合の処理
  useEffect(() => {
    if (activeTerminalId && !terminals.find(t => t.id === activeTerminalId)) {
      const newActiveId = terminals.length > 0 ? terminals[0].id : '';
      setActiveTerminalId(newActiveId);
    }
  }, [terminals, activeTerminalId]);

  const handleCreateTerminal = () => {
    if (!currentRepo) {
      return;
      return;
    }
    const terminalName = `Terminal ${terminals.length + 1}`;
    onCreateTerminal(currentRepo, terminalName);
  };

  const activeTerminal = terminals.find(t => t.id === activeTerminalId);

  return (
    <div className="h-full flex flex-col">
      {/* ターミナルタブ */}
      <div className="bg-gray-700 px-2 sm:px-4 py-2 border-b border-gray-600 flex items-center space-x-1 overflow-x-auto flex-shrink-0">
        {terminals.map((terminal) => (
          <div
            key={terminal.id}
            className={`px-2 sm:px-3 py-1.5 sm:py-1 text-xs sm:text-sm rounded-t-lg flex items-center space-x-1 sm:space-x-2 whitespace-nowrap min-w-0 cursor-pointer ${
              activeTerminalId === terminal.id
                ? 'bg-gray-800 text-gray-100 border border-gray-600 border-b-0'
                : 'bg-gray-600 text-gray-200 hover:bg-gray-500'
            }`}
            onClick={() => setActiveTerminalId(terminal.id)}
          >
            <div className={`w-2 h-2 rounded-full flex-shrink-0 ${
              terminal.status === 'active' ? 'bg-green-500' :
              terminal.status === 'exited' ? 'bg-red-500' : 'bg-yellow-500'
            }`}></div>
            <span className="truncate max-w-20 sm:max-w-none">{terminal.name}</span>
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
          className="px-2 sm:px-3 py-1.5 sm:py-1 text-xs sm:text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:bg-gray-600 disabled:cursor-not-allowed flex items-center space-x-1 flex-shrink-0"
        >
          <span>+</span>
          <span className="hidden sm:inline">新規</span>
        </button>
      </div>

      {/* ターミナル本体 */}
      <div className="flex-1 min-h-0">
        {terminals.length === 0 ? (
          <div className="h-full flex items-center justify-center bg-gray-900 overflow-y-auto">
            <div className="text-center text-gray-300 max-w-sm mx-auto px-4 py-8">
              <div className="mb-4">
                <div className="w-12 h-12 mx-auto mb-3 bg-gray-700 rounded-full flex items-center justify-center">
                  <span className="text-xl text-gray-400">$</span>
                </div>
                <h3 className="text-base font-medium mb-2">ターミナルがありません</h3>
                <p className="text-sm text-gray-400 mb-4">
                  新しいターミナルを作成してコマンドラインを開始しましょう
                </p>
              </div>
              
              <button
                onClick={handleCreateTerminal}
                disabled={!isConnected || !currentRepo}
                className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:bg-gray-600 disabled:cursor-not-allowed transition-colors duration-200 text-sm font-medium"
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
        ) : activeTerminal ? (
          <TerminalComponent
            terminal={activeTerminal}
            messages={messages}
            history={histories.get(activeTerminal.id) || []}
            isActive={true}
            onInput={onTerminalInput}
            onSignal={onTerminalSignal}
            onClose={onCloseTerminal}
          />
        ) : (
          <div className="h-full flex items-center justify-center bg-gray-900">
            <p className="text-gray-300">ターミナルを選択してください</p>
          </div>
        )}
      </div>
    </div>
  );
};

export default TerminalManager;