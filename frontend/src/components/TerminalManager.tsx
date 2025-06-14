import React, { useState, useEffect } from 'react';
import type { Terminal, TerminalMessage } from '../types';
import TerminalComponent from './Terminal';

interface TerminalManagerProps {
  terminals: Terminal[];
  messages: TerminalMessage[];
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
      setActiveTerminalId(terminals.length > 0 ? terminals[0].id : '');
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

  return (
    <div className="bg-white rounded-lg shadow-md overflow-hidden h-96">
      {/* ターミナルタブ */}
      <div className="bg-gray-100 px-4 py-2 border-b flex items-center space-x-1 overflow-x-auto">
        {terminals.map((terminal) => (
          <button
            key={terminal.id}
            onClick={() => setActiveTerminalId(terminal.id)}
            className={`px-3 py-1 text-sm rounded-t-lg flex items-center space-x-2 whitespace-nowrap ${
              activeTerminalId === terminal.id
                ? 'bg-black text-green-400 border border-b-0'
                : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
            }`}
          >
            <div className={`w-2 h-2 rounded-full ${
              terminal.status === 'active' ? 'bg-green-500' :
              terminal.status === 'exited' ? 'bg-red-500' : 'bg-yellow-500'
            }`}></div>
            <span>{terminal.name}</span>
            <button
              onClick={(e) => {
                e.stopPropagation();
                onCloseTerminal(terminal.id);
              }}
              className="text-xs hover:text-red-500 ml-1"
            >
              ×
            </button>
          </button>
        ))}
        
        {/* 新しいターミナル作成ボタン */}
        <button
          onClick={handleCreateTerminal}
          disabled={!isConnected || !currentRepo}
          className="px-3 py-1 text-sm bg-blue-500 text-white rounded-lg hover:bg-blue-600 disabled:bg-gray-300 disabled:cursor-not-allowed flex items-center space-x-1"
        >
          <span>+</span>
          <span>新規</span>
        </button>
      </div>

      {/* ターミナル本体 */}
      <div className="h-full">
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