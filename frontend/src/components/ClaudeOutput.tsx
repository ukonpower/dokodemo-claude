import React, { useEffect, useRef } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';

interface ClaudeOutputProps {
  rawOutput: string;
  onClickFocus?: () => void;
  isLoading?: boolean;
}

const ClaudeOutput: React.FC<ClaudeOutputProps> = ({
  rawOutput,
  onClickFocus,
  isLoading = false,
}) => {
  const terminalRef = useRef<HTMLDivElement>(null);
  const terminal = useRef<Terminal | null>(null);
  const fitAddon = useRef<FitAddon | null>(null);
  const lastOutputLength = useRef<number>(0);

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
      disableStdin: true, // 標準入力を無効化（直接入力は使わない）
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


  return (
    <div className="flex flex-col h-full">
      {/* ヘッダー */}
      <div className="px-2 sm:px-3 py-2 border-b bg-gray-800 border-gray-700">
        <div className="flex items-center space-x-1 sm:space-x-2">
          <div className="w-2 h-2 rounded-full bg-green-500"></div>
          <span className="text-gray-300 text-xs">Claude CLI Output</span>
        </div>
      </div>

      {/* XTermターミナル出力エリア */}
      <div className="flex-1 bg-gray-900 overflow-auto relative">
        <div
          ref={terminalRef}
          className="h-full w-full cursor-pointer"
          onClick={() => {
            // Claude CLI出力エリアをクリックしたら指示入力エリアにフォーカス
            if (onClickFocus) {
              onClickFocus();
            }
          }}
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
        
        {/* Claude CLI専用ローディング表示 */}
        {isLoading && (
          <div className="absolute inset-0 bg-gray-900 bg-opacity-80 flex items-center justify-center">
            <div className="flex flex-col items-center space-y-3">
              <svg
                className="animate-spin h-8 w-8 text-blue-400"
                xmlns="http://www.w3.org/2000/svg"
                fill="none"
                viewBox="0 0 24 24"
              >
                <circle
                  className="opacity-25"
                  cx="12"
                  cy="12"
                  r="10"
                  stroke="currentColor"
                  strokeWidth="4"
                ></circle>
                <path
                  className="opacity-75"
                  fill="currentColor"
                  d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                ></path>
              </svg>
              <div className="text-center">
                <p className="text-sm font-medium text-white">
                  Claude CLI履歴を読み込み中...
                </p>
                <p className="text-xs text-gray-400 mt-1">
                  データを準備しています
                </p>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default ClaudeOutput;
