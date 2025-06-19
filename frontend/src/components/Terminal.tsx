import React, { useState, useEffect, useRef } from 'react';
import { Terminal as XTerm } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
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
  const terminalRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const xtermInstance = useRef<XTerm | null>(null);
  const fitAddon = useRef<FitAddon | null>(null);
  const lastMessageCount = useRef<number>(0);

  // XTermインスタンスを初期化
  useEffect(() => {
    if (!terminalRef.current) return;

    // FitAddonを作成
    fitAddon.current = new FitAddon();

    // XTermインスタンスを作成（Claude CLI出力と同じテーマ設定）
    xtermInstance.current = new XTerm({
      theme: {
        background: '#111827',
        foreground: '#d1d5db',
        cursor: '#9ca3af',
        selectionBackground: '#374151',
        black: '#1f2937',
        red: '#f87171',
        green: '#86efac',
        yellow: '#fbbf24',
        blue: '#93c5fd',
        magenta: '#c084fc',
        cyan: '#67e8f9',
        white: '#e5e7eb',
        brightBlack: '#4b5563',
        brightRed: '#fca5a5',
        brightGreen: '#bbf7d0',
        brightYellow: '#fde047',
        brightBlue: '#bfdbfe',
        brightMagenta: '#e9d5ff',
        brightCyan: '#a5f3fc',
        brightWhite: '#f9fafb'
      },
      fontFamily: '"Fira Code", "SF Mono", Monaco, Inconsolata, "Roboto Mono", "Source Code Pro", monospace',
      fontSize: 8,
      lineHeight: 1.2,
      cursorBlink: false,
      cursorStyle: 'block',
      scrollback: 10000,
      convertEol: true,
      allowTransparency: false,
      disableStdin: true
    });

    // FitAddonを読み込み
    xtermInstance.current.loadAddon(fitAddon.current);

    // XTermをDOMに接続
    xtermInstance.current.open(terminalRef.current);

    // サイズを自動調整
    setTimeout(() => {
      fitAddon.current?.fit();
    }, 100);

    return () => {
      if (xtermInstance.current) {
        xtermInstance.current.dispose();
      }
    };
  }, []);

  // メッセージが更新されたらXTermに書き込み
  useEffect(() => {
    if (!xtermInstance.current) return;

    const terminalMessages = messages.filter(msg => msg.terminalId === terminal.id);
    const newMessages = terminalMessages.slice(lastMessageCount.current);

    newMessages.forEach(message => {
      if (message.type === 'input') return; // 入力メッセージは表示しない

      // ANSIエスケープシーケンスをそのまま出力（XTermが処理）
      xtermInstance.current?.write(message.data);
    });

    lastMessageCount.current = terminalMessages.length;

    // 最下部にスクロール
    xtermInstance.current.scrollToBottom();
  }, [messages, terminal.id]);

  // アクティブなターミナルの場合、入力フィールドにフォーカス
  useEffect(() => {
    if (isActive) {
      if (inputRef.current) {
        inputRef.current.focus();
      }
      // アクティブになった時にサイズを再調整
      setTimeout(() => {
        fitAddon.current?.fit();
      }, 100);
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


  return (
    <div className="h-full flex flex-col">
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

      {/* XTermターミナル出力エリア */}
      <div className="flex-1 bg-gray-900 rounded-b-lg overflow-hidden">
        <div
          ref={terminalRef}
          className="h-full"
          style={{ 
            background: '#111827',
            minHeight: '200px',
            minWidth: 'fit-content'
          }}
        />
      </div>

      {/* 入力エリア */}
      <div className="border-t border-gray-700 p-2 sm:p-3 bg-gray-800">
        <form onSubmit={handleSubmit} className="flex space-x-2 mb-2">
          <span className="text-gray-400 flex-shrink-0 font-mono">$</span>
          <input
            ref={inputRef}
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            className="flex-1 bg-transparent text-gray-300 outline-none text-xs sm:text-sm min-w-0 font-mono"
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