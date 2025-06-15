import React, { useState, useEffect, useRef } from 'react';
import type { Terminal, TerminalMessage } from '../types';

interface TerminalProps {
  terminal: Terminal;
  messages: TerminalMessage[];
  isActive: boolean;
  onInput: (terminalId: string, input: string) => void;
  onSignal: (terminalId: string, signal: string) => void;
  onClose: (terminalId: string) => void;
}

const TerminalComponent: React.FC<TerminalProps> = ({
  terminal,
  messages,
  isActive,
  onInput,
  onSignal,
  onClose
}) => {
  const [input, setInput] = useState('');
  const outputRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // 新しいメッセージが追加されたときに自動スクロール
  useEffect(() => {
    if (outputRef.current) {
      outputRef.current.scrollTop = outputRef.current.scrollHeight;
    }
  }, [messages]);

  // アクティブなターミナルの場合、入力フィールドにフォーカス
  useEffect(() => {
    if (isActive && inputRef.current) {
      inputRef.current.focus();
    }
  }, [isActive]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (input.trim()) {
      onInput(terminal.id, input + '\n');
      setInput('');
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.ctrlKey) {
      if (e.key === 'c') {
        e.preventDefault();
        onSignal(terminal.id, 'SIGINT');
      } else if (e.key === 'z') {
        e.preventDefault();
        onSignal(terminal.id, 'SIGTSTP');
      }
    } else if (e.key === 'Escape') {
      e.preventDefault();
      onSignal(terminal.id, 'ESC');
    }
  };

  const formatMessage = (message: TerminalMessage) => {
    // 入力メッセージは表示しない（重複を避けるため）
    if (message.type === 'input') {
      return '';
    }
    
    // ANSI escape sequences を簡易的に処理
    let formattedData = message.data;
    
    // 色コードの簡単な変換
    formattedData = formattedData
      .replace(/\u001b\[31m/g, '<span class="text-red-400">') // 赤
      .replace(/\u001b\[32m/g, '<span class="text-green-400">') // 緑
      .replace(/\u001b\[33m/g, '<span class="text-yellow-400">') // 黄
      .replace(/\u001b\[34m/g, '<span class="text-blue-400">') // 青
      .replace(/\u001b\[35m/g, '<span class="text-purple-400">') // 紫
      .replace(/\u001b\[36m/g, '<span class="text-cyan-400">') // シアン
      .replace(/\u001b\[37m/g, '<span class="text-gray-300">') // 白
      .replace(/\u001b\[90m/g, '<span class="text-gray-500">') // 暗い灰色
      .replace(/\u001b\[0m/g, '</span>') // リセット
      .replace(/\u001b\[[0-9;]*m/g, ''); // その他のANSIコードを除去

    return formattedData;
  };

  return (
    <div className="h-full flex flex-col bg-gray-900 text-gray-300 font-mono text-xs sm:text-sm">
      {/* ターミナルヘッダー */}
      <div className="bg-gray-800 px-2 sm:px-3 py-2 flex items-center justify-between border-b border-gray-700">
        <div className="flex items-center space-x-1 sm:space-x-2 min-w-0">
          <div className={`w-2 h-2 rounded-full flex-shrink-0 ${
            terminal.status === 'active' ? 'bg-green-500' :
            terminal.status === 'exited' ? 'bg-red-500' : 'bg-yellow-500'
          }`}></div>
          <span className="text-gray-300 text-xs truncate">{terminal.name}</span>
          <span className="text-gray-500 text-xs truncate hidden sm:inline">({terminal.cwd})</span>
          {terminal.pid && (
            <span className="text-gray-500 text-xs hidden sm:inline">PID: {terminal.pid}</span>
          )}
        </div>
        <button
          onClick={() => onClose(terminal.id)}
          className="text-gray-400 hover:text-red-400 text-xs px-2 py-1 rounded flex-shrink-0"
          title="ターミナルを閉じる"
        >
          ×
        </button>
      </div>

      {/* ターミナル出力エリア */}
      <div 
        ref={outputRef}
        className="flex-1 p-2 sm:p-3 overflow-y-auto whitespace-pre-wrap text-xs sm:text-sm"
        style={{ minHeight: '200px', maxHeight: '400px' }}
      >
        {messages
          .filter(msg => msg.terminalId === terminal.id)
          .slice(-1000) // 最新の1000メッセージのみ表示
          .map((message, index) => {
            const formattedContent = formatMessage(message);
            // 空の内容（入力メッセージなど）はスキップ
            if (!formattedContent.trim()) return null;
            
            return (
              <div key={index} className={`${
                message.type === 'stderr' ? 'text-red-400' :
                message.type === 'exit' ? 'text-yellow-300' :
                'text-gray-300'
              }`}>
                <span dangerouslySetInnerHTML={{ __html: formattedContent }} />
              </div>
            );
          })
        }
      </div>

      {/* 入力エリア */}
      <div className="border-t border-gray-700 p-2 sm:p-3">
        <form onSubmit={handleSubmit} className="flex space-x-2 mb-2">
          <span className="text-gray-400 flex-shrink-0">$</span>
          <input
            ref={inputRef}
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            className="flex-1 bg-transparent text-gray-300 outline-none text-xs sm:text-sm min-w-0"
            placeholder={terminal.status === 'exited' ? 'ターミナルが終了しました' : 'コマンドを入力...'}
            disabled={terminal.status === 'exited'}
          />
        </form>
        
        {/* コントロールボタン */}
        <div className="flex items-center justify-between">
          <div className="flex space-x-1">
            <button
              onClick={() => onSignal(terminal.id, 'SIGINT')}
              className="flex items-center justify-center w-14 h-7 sm:w-16 sm:h-8 bg-gray-200 hover:bg-gray-300 disabled:opacity-50 disabled:cursor-not-allowed rounded border text-xs font-mono text-gray-700 focus:outline-none focus:ring-2 focus:ring-gray-400"
              title="プロセスを中断 (Ctrl+C)"
              disabled={terminal.status === 'exited'}
            >
              Ctrl+C
            </button>
            <button
              onClick={() => onSignal(terminal.id, 'SIGTSTP')}
              className="flex items-center justify-center w-14 h-7 sm:w-16 sm:h-8 bg-gray-200 hover:bg-gray-300 disabled:opacity-50 disabled:cursor-not-allowed rounded border text-xs font-mono text-gray-700 focus:outline-none focus:ring-2 focus:ring-gray-400"
              title="プロセスを一時停止 (Ctrl+Z)"
              disabled={terminal.status === 'exited'}
            >
              Ctrl+Z
            </button>
            <button
              onClick={() => onSignal(terminal.id, 'ESC')}
              className="flex items-center justify-center w-14 h-7 sm:w-16 sm:h-8 bg-gray-200 hover:bg-gray-300 disabled:opacity-50 disabled:cursor-not-allowed rounded border text-xs font-mono text-gray-700 focus:outline-none focus:ring-2 focus:ring-gray-400"
              title="エスケープキー (ESC)"
              disabled={terminal.status === 'exited'}
            >
              ESC
            </button>
          </div>
          
          <div className="text-xs text-gray-500">
            <span className="hidden sm:inline">Enter: 実行</span>
            <span className="sm:hidden">Enter:実行</span>
          </div>
        </div>
      </div>
    </div>
  );
};

export default TerminalComponent;