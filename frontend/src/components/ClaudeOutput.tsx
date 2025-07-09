import React, { useEffect, useRef } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';

interface ClaudeOutputProps {
  rawOutput: string;
  onKeyInput?: (key: string) => void;
}

const ClaudeOutput: React.FC<ClaudeOutputProps> = ({
  rawOutput,
  onKeyInput,
}) => {
  const terminalRef = useRef<HTMLDivElement>(null);
  const terminal = useRef<Terminal | null>(null);
  const fitAddon = useRef<FitAddon | null>(null);
  const lastOutputLength = useRef<number>(0);
  const [isFocused, setIsFocused] = React.useState(false);

  // ターミナルを初期化
  useEffect(() => {
    if (!terminalRef.current) return;

    // FitAddonを作成
    fitAddon.current = new FitAddon();

    // ターミナルインスタンスを作成（横スクロール対応の設定）
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
        brightWhite: '#f9fafb',
      },
      fontFamily:
        '"Fira Code", "SF Mono", Monaco, Inconsolata, "Roboto Mono", "Source Code Pro", monospace',
      fontSize: 8,
      lineHeight: 1.2,
      cursorBlink: true,
      cursorStyle: 'block',
      scrollback: 10000,
      convertEol: false, // 改行の自動変換を無効化して横スクロールを有効
      allowTransparency: false,
      disableStdin: true,
      smoothScrollDuration: 0,
      scrollOnUserInput: false,
      fastScrollModifier: 'shift',
      scrollSensitivity: 3,
      // 横スクロール対応の設定
      cols: 600, // 適度な列数を設定
      allowProposedApi: true, // 横スクロール機能に必要
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
      terminal.current.writeln(
        'リポジトリを選択してClaude CLIを開始してください'
      );
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

  // キーボードイベントハンドラーを追加
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!isFocused || !onKeyInput) return;

      e.preventDefault();
      e.stopPropagation();

      let key = '';

      // 特殊キーの処理
      if (e.key === 'Enter') {
        key = '\r';
      } else if (e.key === 'Backspace') {
        key = '\x7f';
      } else if (e.key === 'Delete') {
        key = '\x1b[3~';
      } else if (e.key === 'Tab') {
        key = '\t';
      } else if (e.key === 'Escape') {
        key = '\x1b';
      } else if (e.key === 'ArrowUp') {
        key = '\x1b[A';
      } else if (e.key === 'ArrowDown') {
        key = '\x1b[B';
      } else if (e.key === 'ArrowRight') {
        key = '\x1b[C';
      } else if (e.key === 'ArrowLeft') {
        key = '\x1b[D';
      } else if (e.key === 'Home') {
        key = '\x1b[H';
      } else if (e.key === 'End') {
        key = '\x1b[F';
      } else if (e.key === 'PageUp') {
        key = '\x1b[5~';
      } else if (e.key === 'PageDown') {
        key = '\x1b[6~';
      } else if (e.ctrlKey && e.key === 'c') {
        key = '\x03';
      } else if (e.ctrlKey && e.key === 'z') {
        key = '\x1a';
      } else if (e.ctrlKey && e.key === 'd') {
        key = '\x04';
      } else if (e.ctrlKey && e.key === 'l') {
        key = '\x0c';
      } else if (e.key.length === 1) {
        // 通常の文字キー
        key = e.key;
      }

      if (key) {
        onKeyInput(key);
      }
    };

    if (isFocused) {
      window.addEventListener('keydown', handleKeyDown);
    }

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [isFocused, onKeyInput]);

  return (
    <div className="flex flex-col h-full">
      {/* ヘッダー */}
      <div className={`px-2 sm:px-3 py-2 border-b ${isFocused ? 'bg-blue-800 border-blue-600' : 'bg-gray-800 border-gray-700'}`}>
        <div className="flex items-center space-x-1 sm:space-x-2">
          <div className={`w-2 h-2 rounded-full ${isFocused ? 'bg-blue-400' : 'bg-green-500'}`}></div>
          <span className="text-gray-300 text-xs">Claude CLI Output</span>
          {isFocused && <span className="text-blue-300 text-xs font-bold">FOCUSED</span>}
        </div>
      </div>

      {/* XTermターミナル出力エリア */}
      <div className="flex-1 bg-gray-900 overflow-auto">
        <div
          ref={terminalRef}
          className={`h-full w-full cursor-pointer ${isFocused ? 'ring-2 ring-blue-500' : ''}`}
          onClick={() => {
            setIsFocused(true);
          }}
          onBlur={() => setIsFocused(false)}
          tabIndex={0}
          style={{
            background: '#111827',
            minHeight: '200px',
            width: 'max-content',
            overflowX: 'auto',
            overflowY: 'auto',
            // 横スクロールを強制して改行を防ぐ
            whiteSpace: 'nowrap',
          }}
        />
      </div>
    </div>
  );
};

export default ClaudeOutput;
