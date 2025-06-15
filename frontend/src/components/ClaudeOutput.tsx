import React, { useEffect, useRef } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';

interface ClaudeOutputProps {
  rawOutput: string;
  onSendInterrupt?: () => void;
}

const ClaudeOutput: React.FC<ClaudeOutputProps> = ({ rawOutput, onSendInterrupt }) => {
  const terminalRef = useRef<HTMLDivElement>(null);
  const terminal = useRef<Terminal | null>(null);
  const fitAddon = useRef<FitAddon | null>(null);
  const lastOutputLength = useRef<number>(0);

  // ターミナルを初期化
  useEffect(() => {
    if (!terminalRef.current) return;

    // ターミナルインスタンスを作成
    terminal.current = new Terminal({
      cols: 200,
      rows: 24,
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
      scrollback: 10000,
      convertEol: true,
      allowTransparency: false,
      disableStdin: true,
      wordWrap: false
    });

    // ターミナルをDOMに接続
    terminal.current.open(terminalRef.current);

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

  return (
    <div className="bg-gray-900 rounded-lg overflow-auto">
      <div
        ref={terminalRef}
        className="h-64 sm:h-96"
        style={{ 
          background: '#111827',
          minWidth: 'fit-content'
        }}
      />
    </div>
  );
};

export default ClaudeOutput;