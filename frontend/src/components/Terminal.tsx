import React, { useState, useEffect, useRef } from 'react';
import { Terminal as XTerm } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import type { Terminal, TerminalMessage, TerminalOutputLine } from '../types';

interface TerminalProps {
  terminal: Terminal;
  messages: TerminalMessage[];
  history: TerminalOutputLine[];
  isActive: boolean;
  onInput: (terminalId: string, input: string) => void;
  onSignal: (terminalId: string, signal: string) => void;
  onClose: (terminalId: string) => void;
}

const TerminalComponent: React.FC<TerminalProps> = ({
  terminal,
  messages,
  history,
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
  const currentTerminalId = useRef<string>('');

  // 矢印キーハンドラ
  const handleArrowKey = (direction: 'up' | 'down' | 'left' | 'right') => {
    const arrowKeys = {
      up: '\x1b[A',
      down: '\x1b[B',
      right: '\x1b[C',
      left: '\x1b[D'
    };
    onInput(terminal.id, arrowKeys[direction]);
  };

  // XTermインスタンスを初期化
  useEffect(() => {
    if (!terminalRef.current) return;

    // FitAddonを作成
    fitAddon.current = new FitAddon();

    // XTermインスタンスを作成（横スクロール対応の設定）
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
      convertEol: false, // 改行の自動変換を無効化して横スクロールを有効
      allowTransparency: false,
      disableStdin: true,
      smoothScrollDuration: 0,
      scrollOnUserInput: true,
      fastScrollModifier: 'shift',
      scrollSensitivity: 3,
      // 横スクロール対応の設定
      cols: 600, // 適度な列数を設定
      allowProposedApi: true // 横スクロール機能に必要
    });

    // FitAddonを読み込み
    xtermInstance.current.loadAddon(fitAddon.current);

    // XTermをDOMに接続
    xtermInstance.current.open(terminalRef.current);

    // サイズを自動調整（仮想スクロール対応）
    setTimeout(() => {
      if (fitAddon.current && xtermInstance.current) {
        fitAddon.current.fit();
        // 仮想スクロール領域の正確な調整
        xtermInstance.current.refresh(0, xtermInstance.current.rows - 1);
      }
    }, 100);

    return () => {
      if (xtermInstance.current) {
        xtermInstance.current.dispose();
      }
    };
  }, []);

  // ターミナルが変更された時の処理
  useEffect(() => {
    if (!xtermInstance.current) return;

    // ターミナルが変更された場合、または初回表示の場合、出力をクリアして新しい内容をロード
    if (currentTerminalId.current !== terminal.id) {

      // 出力をクリア
      xtermInstance.current.clear();

      // 履歴をロード
      if (history && history.length > 0) {
        history.forEach(historyLine => {
          if (historyLine.content) {
            xtermInstance.current?.write(historyLine.content);
          }
        });
      }

      // 現在のメッセージをロード
      const terminalMessages = messages.filter(msg => msg.terminalId === terminal.id);
      terminalMessages.forEach(message => {
        if (message.type !== 'input') {
          xtermInstance.current?.write(message.data);
        }
      });

      lastMessageCount.current = terminalMessages.length;
      currentTerminalId.current = terminal.id;
      xtermInstance.current.scrollToBottom();
    }
    // 初回表示で履歴が空だった場合、後から履歴が読み込まれた時の対応
    else if (currentTerminalId.current === terminal.id && history && history.length > 0) {
      // 既に表示されているコンテンツと履歴を比較して、履歴が新しく追加されていれば表示
      const terminalMessages = messages.filter(msg => msg.terminalId === terminal.id);
      const totalExpectedLines = history.length + terminalMessages.filter(msg => msg.type !== 'input').length;

      // 現在の表示内容より履歴が多い場合は再描画
      if (totalExpectedLines > lastMessageCount.current) {

        // 出力をクリア
        xtermInstance.current.clear();

        // 履歴をロード
        history.forEach(historyLine => {
          if (historyLine.content) {
            xtermInstance.current?.write(historyLine.content);
          }
        });

        // 現在のメッセージをロード
        terminalMessages.forEach(message => {
          if (message.type !== 'input') {
            xtermInstance.current?.write(message.data);
          }
        });

        lastMessageCount.current = terminalMessages.length;
        xtermInstance.current.scrollToBottom();
      }
    }
  }, [terminal.id, history, messages]);

  // 新しいメッセージが追加されたらXTermに書き込み
  useEffect(() => {
    if (!xtermInstance.current || currentTerminalId.current !== terminal.id) return;

    const terminalMessages = messages.filter(msg => msg.terminalId === terminal.id);
    const newMessages = terminalMessages.slice(lastMessageCount.current);

    // 新しいメッセージがある場合のみ処理
    if (newMessages.length > 0) {

      newMessages.forEach(message => {
        if (message.type === 'input') return; // 入力メッセージは表示しない

        // ANSIエスケープシーケンスをそのまま出力（XTermが処理）
        xtermInstance.current?.write(message.data);
      });

      lastMessageCount.current = terminalMessages.length;

      // 最下部にスクロール
      xtermInstance.current.scrollToBottom();
    }
  }, [messages]);

  // アクティブなターミナルの場合、入力フィールドにフォーカス
  useEffect(() => {
    if (isActive) {
      if (inputRef.current) {
        inputRef.current.focus();
      }
      // アクティブになった時にサイズを再調整（仮想スクロール対応）
      setTimeout(() => {
        if (fitAddon.current && xtermInstance.current) {
          fitAddon.current.fit();
          // 仮想スクロール領域の再調整
          xtermInstance.current.refresh(0, xtermInstance.current.rows - 1);
        }
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
    } else if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) {
      e.preventDefault();
      
      // 矢印キーのANSIエスケープシーケンス
      const arrowKeys: { [key: string]: string } = {
        'ArrowUp': '\x1b[A',
        'ArrowDown': '\x1b[B',
        'ArrowRight': '\x1b[C',
        'ArrowLeft': '\x1b[D'
      };
      
      // ANSIエスケープシーケンスを直接送信
      onInput(terminal.id, arrowKeys[e.key]);
    }
  };


  return (
    <div className="h-full flex flex-col">
      {/* ターミナルヘッダー */}
      <div className="bg-gray-800 px-2 sm:px-3 py-2 flex items-center justify-between border-b border-gray-700">
        <div className="flex items-center space-x-1 sm:space-x-2 min-w-0">
          <div className={`w-2 h-2 rounded-full flex-shrink-0 ${terminal.status === 'active' ? 'bg-green-500' :
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
      <div className="flex-1 bg-gray-900 overflow-auto">
        <div
          ref={terminalRef}
          className="h-full w-full"
          style={{
            background: '#111827',
            minHeight: '200px',
            width: 'max-content',
            overflowX: 'auto',
            overflowY: 'auto',
            whiteSpace: 'nowrap'
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
        <div className="flex flex-col space-y-3">
          {/* 方向キーとコントロールボタンを横並びに配置 */}
          <div className="flex items-center justify-center space-x-4">
            {/* 方向キーボタン */}
            <div className="flex flex-col items-center space-y-2">
              <div className="grid grid-cols-3 gap-1">
                <div></div>
                <button
                  type="button"
                  onClick={() => handleArrowKey('up')}
                  disabled={terminal.status === 'exited'}
                  className="flex items-center justify-center w-8 h-8 sm:w-9 sm:h-9 bg-gray-600 hover:bg-gray-500 disabled:opacity-50 disabled:cursor-not-allowed rounded border border-gray-500 text-sm font-mono text-white focus:outline-none focus:ring-2 focus:ring-gray-400 touch-manipulation"
                  title="上キー"
                >
                  ↑
                </button>
                <div></div>
                <button
                  type="button"
                  onClick={() => handleArrowKey('left')}
                  disabled={terminal.status === 'exited'}
                  className="flex items-center justify-center w-8 h-8 sm:w-9 sm:h-9 bg-gray-600 hover:bg-gray-500 disabled:opacity-50 disabled:cursor-not-allowed rounded border border-gray-500 text-sm font-mono text-white focus:outline-none focus:ring-2 focus:ring-gray-400 touch-manipulation"
                  title="左キー"
                >
                  ←
                </button>
                <button
                  type="button"
                  onClick={() => handleArrowKey('down')}
                  disabled={terminal.status === 'exited'}
                  className="flex items-center justify-center w-8 h-8 sm:w-9 sm:h-9 bg-gray-600 hover:bg-gray-500 disabled:opacity-50 disabled:cursor-not-allowed rounded border border-gray-500 text-sm font-mono text-white focus:outline-none focus:ring-2 focus:ring-gray-400 touch-manipulation"
                  title="下キー"
                >
                  ↓
                </button>
                <button
                  type="button"
                  onClick={() => handleArrowKey('right')}
                  disabled={terminal.status === 'exited'}
                  className="flex items-center justify-center w-8 h-8 sm:w-9 sm:h-9 bg-gray-600 hover:bg-gray-500 disabled:opacity-50 disabled:cursor-not-allowed rounded border border-gray-500 text-sm font-mono text-white focus:outline-none focus:ring-2 focus:ring-gray-400 touch-manipulation"
                  title="右キー"
                >
                  →
                </button>
              </div>
            </div>

            {/* Ctrl+C、ESC、Enterボタン */}
            <div className="flex flex-col items-center space-y-2">
              <div className="flex space-x-1">
                <button
                  onClick={() => onSignal(terminal.id, 'SIGINT')}
                  className="flex items-center justify-center w-14 h-8 sm:w-16 sm:h-9 bg-gray-600 hover:bg-gray-500 disabled:opacity-50 disabled:cursor-not-allowed rounded border border-gray-500 text-xs font-mono text-white focus:outline-none focus:ring-2 focus:ring-gray-400 touch-manipulation"
                  title="プロセスを中断 (Ctrl+C)"
                  disabled={terminal.status === 'exited'}
                >
                  Ctrl+C
                </button>
                <button
                  onClick={() => onSignal(terminal.id, 'SIGTSTP')}
                  className="flex items-center justify-center w-14 h-8 sm:w-16 sm:h-9 bg-gray-600 hover:bg-gray-500 disabled:opacity-50 disabled:cursor-not-allowed rounded border border-gray-500 text-xs font-mono text-white focus:outline-none focus:ring-2 focus:ring-gray-400 touch-manipulation"
                  title="プロセスを一時停止 (Ctrl+Z)"
                  disabled={terminal.status === 'exited'}
                >
                  Ctrl+Z
                </button>
                <button
                  onClick={() => onSignal(terminal.id, 'ESC')}
                  className="flex items-center justify-center w-12 h-8 sm:w-14 sm:h-9 bg-gray-600 hover:bg-gray-500 disabled:opacity-50 disabled:cursor-not-allowed rounded border border-gray-500 text-xs font-mono text-white focus:outline-none focus:ring-2 focus:ring-gray-400 touch-manipulation"
                  title="エスケープキー (ESC)"
                  disabled={terminal.status === 'exited'}
                >
                  ESC
                </button>
              </div>
            </div>

            {/* Enterボタン */}
            <div className="flex flex-col items-center space-y-2">
              <button
                type="button"
                onClick={() => {
                  if (input.trim()) {
                    onInput(terminal.id, input + '\n');
                    setInput('');
                  } else {
                    onInput(terminal.id, '\n');
                  }
                }}
                disabled={terminal.status === 'exited'}
                className="bg-blue-600 text-white px-6 py-2.5 sm:px-4 sm:py-2 rounded-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed text-sm font-medium min-h-[2.5rem] sm:min-h-[2rem] flex items-center touch-manipulation"
                title="コマンドを実行 (Enter)"
              >
                Enter
              </button>
            </div>
          </div>

          <div className="text-xs text-gray-400 text-center">
            <span className="hidden sm:inline">Enter: 実行</span>
            <span className="sm:hidden">Enter:実行</span>
          </div>
        </div>
      </div>
    </div>
  );
};

export default TerminalComponent;