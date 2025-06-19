import React, { useEffect, useRef } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';

interface ClaudeOutputProps {
  rawOutput: string;
}

const ClaudeOutput: React.FC<ClaudeOutputProps> = ({ rawOutput }) => {
  const terminalRef = useRef<HTMLDivElement>(null);
  const terminal = useRef<Terminal | null>(null);
  const fitAddon = useRef<FitAddon | null>(null);
  const lastOutputLength = useRef<number>(0);

  // ターミナルを初期化
  useEffect(() => {
    if (!terminalRef.current) return;

    // FitAddonを作成
    fitAddon.current = new FitAddon();

    // ターミナルインスタンスを作成（Claude CLIと同じ仮想スクロール設定）
    terminal.current = new Terminal({
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
      cursorBlink: true,
      cursorStyle: 'block',
      scrollback: 10000, // 仮想スクロール用の履歴バッファ
      convertEol: true,
      allowTransparency: false,
      disableStdin: true,
      smoothScrollDuration: 0, // スムーススクロールを無効化
      scrollOnUserInput: false, // Claude出力ではユーザー入力時自動スクロールを無効
      fastScrollModifier: 'shift' // Shift+スクロールで高速スクロール
    });

    // FitAddonを読み込み
    terminal.current.loadAddon(fitAddon.current);

    // ターミナルをDOMに接続
    terminal.current.open(terminalRef.current);

    // サイズを自動調整
    setTimeout(() => {
      if (fitAddon.current && terminal.current) {
        fitAddon.current.fit();
        terminal.current.refresh(0, terminal.current.rows - 1);
      }
    }, 100);

    // 初期メッセージを表示
    if (!rawOutput) {
      terminal.current.writeln('Claude CLIの出力がここに表示されます');
      terminal.current.writeln('リポジトリを選択してClaude CLIを開始してください');
    }

    return () => {
      if (terminal.current) {
        terminal.current.dispose();
      }
    };
  }, []);

  // 出力が更新されたらターミナルに書き込み
  useEffect(() => {
    if (!terminal.current || !rawOutput) return;

    // 新しい出力部分のみを取得
    const newOutput = rawOutput.slice(lastOutputLength.current);
    
    if (newOutput) {
      // ターミナルをクリアして全体を再描画
      if (lastOutputLength.current === 0) {
        terminal.current.clear();
      }
      
      // 新しい出力を書き込み
      terminal.current.write(newOutput);
      
      // 最下部にスクロール
      terminal.current.scrollToBottom();
      
      // 出力長を更新
      lastOutputLength.current = rawOutput.length;
    }
  }, [rawOutput]);

  // ウィンドウサイズ変更時に再調整
  useEffect(() => {
    const handleResize = () => {
      if (fitAddon.current && terminal.current) {
        fitAddon.current.fit();
      }
    };

    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  return (
    <div className="flex flex-col h-full">
      {/* ヘッダー */}
      <div className="bg-gray-800 px-2 sm:px-3 py-2 border-b border-gray-700">
        <div className="flex items-center space-x-1 sm:space-x-2">
          <div className="w-2 h-2 rounded-full bg-green-500"></div>
          <span className="text-gray-300 text-xs">Claude CLI Output</span>
        </div>
      </div>

      {/* XTermターミナル出力エリア */}
      <div className="flex-1 bg-gray-900 overflow-hidden">
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
    </div>
  );
};

export default ClaudeOutput;