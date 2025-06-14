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
    }
  };

  const formatMessage = (message: TerminalMessage) => {
    // ANSI escape sequences を簡易的に処理
    let formattedData = message.data;
    
    // 色コードの簡単な変換
    formattedData = formattedData
      .replace(/\u001b\[31m/g, '<span class="text-red-500">') // 赤
      .replace(/\u001b\[32m/g, '<span class="text-green-500">') // 緑
      .replace(/\u001b\[33m/g, '<span class="text-yellow-500">') // 黄
      .replace(/\u001b\[34m/g, '<span class="text-blue-500">') // 青
      .replace(/\u001b\[35m/g, '<span class="text-purple-500">') // 紫
      .replace(/\u001b\[36m/g, '<span class="text-cyan-500">') // シアン
      .replace(/\u001b\[37m/g, '<span class="text-gray-300">') // 白
      .replace(/\u001b\[90m/g, '<span class="text-gray-500">') // 暗い灰色
      .replace(/\u001b\[0m/g, '</span>') // リセット
      .replace(/\u001b\[[0-9;]*m/g, ''); // その他のANSIコードを除去

    return formattedData;
  };

  return (
    <div className="h-full flex flex-col bg-black text-green-400 font-mono text-sm">
      {/* ターミナルヘッダー */}
      <div className="bg-gray-800 px-3 py-2 flex items-center justify-between border-b border-gray-700">
        <div className="flex items-center space-x-2">
          <div className={`w-2 h-2 rounded-full ${
            terminal.status === 'active' ? 'bg-green-500' :
            terminal.status === 'exited' ? 'bg-red-500' : 'bg-yellow-500'
          }`}></div>
          <span className="text-gray-300 text-xs">{terminal.name}</span>
          <span className="text-gray-500 text-xs">({terminal.cwd})</span>
          {terminal.pid && (
            <span className="text-gray-500 text-xs">PID: {terminal.pid}</span>
          )}
        </div>
        <button
          onClick={() => onClose(terminal.id)}
          className="text-gray-400 hover:text-red-400 text-xs px-2 py-1 rounded"
          title="ターミナルを閉じる"
        >
          ×
        </button>
      </div>

      {/* ターミナル出力エリア */}
      <div 
        ref={outputRef}
        className="flex-1 p-3 overflow-y-auto whitespace-pre-wrap"
        style={{ minHeight: '300px' }}
      >
        {messages
          .filter(msg => msg.terminalId === terminal.id)
          .map((message, index) => (
            <div key={index} className={`${
              message.type === 'stderr' ? 'text-red-400' :
              message.type === 'input' ? 'text-blue-400' :
              message.type === 'exit' ? 'text-yellow-400' :
              'text-green-400'
            }`}>
              <span dangerouslySetInnerHTML={{ __html: formatMessage(message) }} />
            </div>
          ))
        }
      </div>

      {/* 入力エリア */}
      <div className="border-t border-gray-700 p-3">
        <form onSubmit={handleSubmit} className="flex space-x-2">
          <span className="text-green-400">$</span>
          <input
            ref={inputRef}
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            className="flex-1 bg-transparent text-green-400 outline-none"
            placeholder={terminal.status === 'exited' ? 'ターミナルが終了しました' : 'コマンドを入力...'}
            disabled={terminal.status === 'exited'}
          />
        </form>
        <div className="mt-1 text-xs text-gray-500">
          Ctrl+C: 中断 | Ctrl+Z: 一時停止 | Enter: 実行
        </div>
      </div>
    </div>
  );
};

export default TerminalComponent;