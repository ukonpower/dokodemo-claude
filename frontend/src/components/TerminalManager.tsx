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
    console.log('TerminalManager: terminals.length =', terminals.length, ', activeTerminalId =', activeTerminalId);
    if (terminals.length > 0 && !activeTerminalId) {
      console.log('Setting first terminal as active:', terminals[0].id);
      setActiveTerminalId(terminals[0].id);
    }
  }, [terminals, activeTerminalId]);

  // アクティブなターミナルが削除された場合の処理
  useEffect(() => {
    if (activeTerminalId && !terminals.find(t => t.id === activeTerminalId)) {
      const newActiveId = terminals.length > 0 ? terminals[0].id : '';
      console.log('Active terminal deleted, setting new active:', newActiveId);
      setActiveTerminalId(newActiveId);
    }
  }, [terminals, activeTerminalId]);

  const handleCreateTerminal = () => {
    if (!currentRepo) {
      alert('プロジェクトを選択してください');
      return;
    }
    const terminalName = `Terminal ${terminals.length + 1}`;
    onCreateTerminal(currentRepo, terminalName);
  };

  const activeTerminal = terminals.find(t => t.id === activeTerminalId);
  console.log('TerminalManager render: terminals =', terminals.map(t => t.id), ', activeTerminalId =', activeTerminalId, ', activeTerminal =', activeTerminal?.id);

  return (
    <div className="h-full flex flex-col">
      {/* ターミナルタブ */}
      <div className="bg-gray-100 px-2 sm:px-4 py-2 border-b flex items-center space-x-1 overflow-x-auto flex-shrink-0">
        {terminals.map((terminal) => (
          <div
            key={terminal.id}
            className={`px-2 sm:px-3 py-1.5 sm:py-1 text-xs sm:text-sm rounded-t-lg flex items-center space-x-1 sm:space-x-2 whitespace-nowrap min-w-0 cursor-pointer ${
              activeTerminalId === terminal.id
                ? 'bg-gray-800 text-gray-100 border border-gray-600 border-b-0'
                : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
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
              className="text-xs hover:text-red-500 ml-1 flex-shrink-0"
            >
              ×
            </button>
          </div>
        ))}
        
        {/* 新しいターミナル作成ボタン */}
        <button
          onClick={handleCreateTerminal}
          disabled={!isConnected || !currentRepo}
          className="px-2 sm:px-3 py-1.5 sm:py-1 text-xs sm:text-sm bg-blue-500 text-white rounded-lg hover:bg-blue-600 disabled:bg-gray-300 disabled:cursor-not-allowed flex items-center space-x-1 flex-shrink-0"
        >
          <span>+</span>
          <span className="hidden sm:inline">新規</span>
        </button>
      </div>

      {/* ターミナル本体 */}
      <div className="flex-1 min-h-0">
        {terminals.length === 0 ? (
          <div className="h-full flex items-center justify-center bg-gray-50">
            <div className="text-center text-gray-500">
              <p className="mb-2">ターミナルがありません</p>
              <button
                onClick={handleCreateTerminal}
                disabled={!isConnected || !currentRepo}
                className="px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600 disabled:bg-gray-300 disabled:cursor-not-allowed"
              >
                ターミナルを作成
              </button>
              {!currentRepo && (
                <p className="text-xs text-gray-400 mt-2">
                  プロジェクトを選択してください
                </p>
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
          <div className="h-full flex items-center justify-center bg-gray-50">
            <p className="text-gray-500">ターミナルを選択してください</p>
          </div>
        )}
      </div>
    </div>
  );
};

export default TerminalManager;