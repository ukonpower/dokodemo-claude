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

    // ターミナルインスタンスを作成
    terminal.current = new Terminal({
      theme: {
        background: '#1a1a1a',
        foreground: '#00ff00',
        cursor: '#00ff00',
        selectionBackground: '#ffffff30',
        black: '#000000',
        red: '#ff0000',
        green: '#00ff00',
        yellow: '#ffff00',
        blue: '#0000ff',
        magenta: '#ff00ff',
        cyan: '#00ffff',
        white: '#ffffff',
        brightBlack: '#404040',
        brightRed: '#ff4040',
        brightGreen: '#40ff40',
        brightYellow: '#ffff40',
        brightBlue: '#4040ff',
        brightMagenta: '#ff40ff',
        brightCyan: '#40ffff',
        brightWhite: '#ffffff'
      },
      fontFamily: '"Fira Code", "SF Mono", Monaco, Inconsolata, "Roboto Mono", "Source Code Pro", monospace',
      fontSize: 12,
      lineHeight: 1.2,
      cursorBlink: true,
      cursorStyle: 'block',
      scrollback: 10000,
      convertEol: true,
      allowTransparency: false,
      disableStdin: true
    });

    // フィットアドオンを作成
    fitAddon.current = new FitAddon();
    terminal.current.loadAddon(fitAddon.current);

    // ターミナルをDOMに接続
    terminal.current.open(terminalRef.current);

    // 初期メッセージを表示
    if (!rawOutput) {
      terminal.current.writeln('Claude CLIの出力がここに表示されます');
      terminal.current.writeln('リポジトリを選択してClaude CLIを開始してください');
    }

    // サイズを調整
    fitAddon.current.fit();

    // リサイズイベントを設定
    const handleResize = () => {
      if (fitAddon.current) {
        fitAddon.current.fit();
      }
    };

    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
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
    <div className="bg-white rounded-lg shadow-sm border border-gray-200">
      <div className="px-4 py-3 border-b border-gray-200 flex items-center justify-between">
        <h2 className="text-lg font-semibold text-gray-900">
          Claude Code CLI 出力
        </h2>
        <div className="flex items-center space-x-2">
          <div className="w-3 h-3 bg-red-500 rounded-full"></div>
          <div className="w-3 h-3 bg-yellow-500 rounded-full"></div>
          <div className="w-3 h-3 bg-green-500 rounded-full"></div>
        </div>
      </div>
      
      <div
        ref={terminalRef}
        className="h-96"
        style={{ 
          background: '#1a1a1a'
        }}
      />
    </div>
  );
};

export default ClaudeOutput;