import React, { useEffect, useRef, useCallback } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import { RotateCw, Trash2 } from 'lucide-react';
import type { AiProvider } from '../types';

interface AiOutputProps {
  rawOutput: string;
  currentProvider?: AiProvider; // プロバイダー情報を追加
  onFocusChange?: (focused: boolean) => void;
  isLoading?: boolean;
  onClearOutput?: () => void;
  onRestartAi?: () => void;
  onKeyInput?: (key: string) => void;
  isFocused?: boolean;
}

const AiOutput: React.FC<AiOutputProps> = ({
  rawOutput,
  currentProvider = 'claude',
  onFocusChange,
  isLoading = false,
  onClearOutput,
  onRestartAi,
  onKeyInput,
  isFocused = false,
}) => {
  const terminalRef = useRef<HTMLDivElement>(null);
  const terminal = useRef<Terminal | null>(null);
  const fitAddon = useRef<FitAddon | null>(null);
  const lastOutputLength = useRef<number>(0);
  const rootRef = useRef<HTMLDivElement>(null);

  // ターミナルの履歴をクリアする関数
  const clearTerminal = () => {
    if (terminal.current) {
      terminal.current.clear();
      lastOutputLength.current = 0;
    }
    if (onClearOutput) {
      onClearOutput();
    }
  };

  // プロバイダー名とメッセージを取得
  const getProviderInfo = useCallback(() => {
    switch (currentProvider) {
      case 'claude':
        return {
          name: 'Claude CLI',
          shortName: 'Claude',
          initialMessage1: 'Claude CLIの出力がここに表示されます',
          initialMessage2: 'リポジトリを選択してClaude CLIを開始してください',
          loadingMessage: 'Claude CLI履歴を読み込み中...',
          headerLabel: 'Claude CLI Output',
          focusLabel: '（キー入力モード - ESCで解除）',
        };
      case 'codex':
        return {
          name: 'Codex CLI',
          shortName: 'Codex',
          initialMessage1: 'Codex CLIの出力がここに表示されます',
          initialMessage2: 'リポジトリを選択してCodex CLIを開始してください',
          loadingMessage: 'Codex CLI履歴を読み込み中...',
          headerLabel: 'Codex CLI Output',
          focusLabel: '（キー入力モード - ESCで解除）',
        };
      default:
        return {
          name: 'AI CLI',
          shortName: 'AI',
          initialMessage1: 'AI CLIの出力がここに表示されます',
          initialMessage2: 'リポジトリを選択してAI CLIを開始してください',
          loadingMessage: 'AI CLI履歴を読み込み中...',
          headerLabel: 'AI CLI Output',
          focusLabel: '（キー入力モード - ESCで解除）',
        };
    }
  }, [currentProvider]);

  // ターミナルを初期化
  useEffect(() => {
    if (!terminalRef.current) return;

    // FitAddonを作成
    fitAddon.current = new FitAddon();

    // ターミナルインスタンスを作成（横スクロール対応の設定）
    // PC時(lg以上)はフォントサイズを大きく設定
    const isLargeScreen = window.innerWidth >= 1024; // lg breakpoint

    terminal.current = new Terminal({
      theme: {
        background: '#0a0a0a', // dark-bg-primary
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
      fontSize: isLargeScreen ? 10 : 8, // PC時は10px, モバイル時は8px
      lineHeight: 1.4,
      cursorBlink: true,
      cursorStyle: 'block',
      scrollback: 10000,
      convertEol: false, // 改行の自動変換を無効化して横スクロールを有効
      allowTransparency: false,
      disableStdin: false, // 標準入力を有効化してxterm.jsのキーボード処理を使う
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

    // xterm.jsのonDataを使ってキー入力を受け取る
    terminal.current.onData((data) => {
      // ESCキーでフォーカス解除
      if (data === '\x1b' && onFocusChange) {
        onFocusChange(false);
        return;
      }
      
      // その他のキー入力をClaude CLIに送信
      if (onKeyInput) {
        onKeyInput(data);
      }
    });

    // サイズを自動調整
    setTimeout(() => {
      if (fitAddon.current && terminal.current) {
        fitAddon.current.fit();
        terminal.current.refresh(0, terminal.current.rows - 1);
      }
    }, 100);

    // 初期メッセージを表示
    if (!rawOutput) {
      const providerInfo = getProviderInfo();
      terminal.current.writeln(providerInfo.initialMessage1);
      terminal.current.writeln(providerInfo.initialMessage2);
    }

    return () => {
      if (terminal.current) {
        terminal.current.dispose();
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // プロバイダー変更時にターミナルを初期化して正しい内容に更新
  useEffect(() => {
    if (!terminal.current) return;

    // ターミナルをクリア
    terminal.current.clear();
    lastOutputLength.current = 0;

    // rawOutputがあれば全量描画、なければ初期メッセージ表示
    if (rawOutput && rawOutput.length > 0) {
      terminal.current.write(rawOutput);
      lastOutputLength.current = rawOutput.length;
    } else {
      const info = getProviderInfo();
      terminal.current.writeln(info.initialMessage1);
      terminal.current.writeln(info.initialMessage2);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentProvider]);

  // 出力が更新されたらターミナルに書き込み
  useEffect(() => {
    if (!terminal.current) return;
    if (!rawOutput) return;

    // 入れ替え（長さが減った等）を検知したら全量描画
    if (rawOutput.length < lastOutputLength.current) {
      terminal.current.clear();
      lastOutputLength.current = 0;
    }

    // 新しい出力部分のみを取得
    const newOutput = rawOutput.slice(lastOutputLength.current);

    if (newOutput) {
      // ターミナルをクリアして全体を再描画
      if (lastOutputLength.current === 0) {
        terminal.current.clear();
      }

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

  // フォーカス管理: xterm.jsのfocus()/blur()を使用
  useEffect(() => {
    if (!terminal.current) return;

    if (isFocused) {
      terminal.current.focus();
    } else {
      terminal.current.blur();
    }
  }, [isFocused]);

  // Outside click 検出
  useEffect(() => {
    if (!isFocused || !onFocusChange) return;

    const handleDocPointerDown = (e: PointerEvent) => {
      // クリック対象が rootRef の外部なら OFF
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        onFocusChange(false);
      }
    };

    // キャプチャフェーズで登録（子要素のイベントより先に処理）
    document.addEventListener('pointerdown', handleDocPointerDown, true);

    return () => {
      document.removeEventListener('pointerdown', handleDocPointerDown, true);
    };
  }, [isFocused, onFocusChange]);

  const providerInfo = getProviderInfo();

  return (
    <div ref={rootRef} className="flex flex-col h-full">
      {/* ヘッダー */}
      <div className="px-2 sm:px-3 py-2 border-b bg-dark-bg-tertiary border-dark-border-DEFAULT">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-1 sm:space-x-2">
            <div
              className={`w-2 h-2 rounded-full ${isFocused ? 'bg-dark-accent-blue animate-pulse' : 'bg-dark-accent-green'}`}
            ></div>
            <span className="text-gray-300 text-xs">
              {providerInfo.headerLabel}{' '}
              {isFocused && (
                <span className="text-dark-accent-blue">
                  {providerInfo.focusLabel}
                </span>
              )}
            </span>
          </div>
          <div className="flex items-center space-x-2">
            {onRestartAi && (
              <button
                onClick={onRestartAi}
                className="flex items-center justify-center w-6 h-6 bg-dark-bg-secondary hover:bg-dark-bg-hover rounded border border-dark-border-light text-xs font-mono text-white focus:outline-none focus:ring-1 focus:ring-dark-border-focus transition-all duration-150"
                title="AI CLIを再起動"
              >
                <RotateCw size={14} />
              </button>
            )}
            {onClearOutput && (
              <button
                onClick={clearTerminal}
                className="flex items-center justify-center w-6 h-6 bg-dark-bg-secondary hover:bg-dark-bg-hover rounded border border-dark-border-light text-xs font-mono text-white focus:outline-none focus:ring-1 focus:ring-dark-border-focus transition-all duration-150"
                title="出力履歴をクリア"
              >
                <Trash2 size={14} />
              </button>
            )}
          </div>
        </div>
      </div>

      {/* XTermターミナル出力エリア */}
      <div
        className={`flex-1 bg-dark-bg-primary overflow-auto relative ${
          isFocused ? 'ring-2 ring-dark-accent-blue ring-inset' : ''
        }`}
      >
        <div
          ref={terminalRef}
          className="h-full w-full cursor-pointer"
          onClick={() => {
            // AI CLI出力エリアをクリックしたらキー入力モードをON（トグルしない）
            if (onFocusChange) {
              onFocusChange(true);
            }
          }}
          style={{
            background: '#0a0a0a', // dark-bg-primary
            minHeight: '400px',
            width: 'max-content',
            overflowX: 'auto',
            overflowY: 'auto',
            // 横スクロールを強制して改行を防ぐ
            whiteSpace: 'nowrap',
          }}
        />

        {/* AI CLI専用ローディング表示 */}
        {isLoading && (
          <div className="absolute inset-0 bg-dark-bg-primary bg-opacity-90 flex items-center justify-center">
            <div className="flex flex-col items-center space-y-3">
              <svg
                className="animate-spin h-8 w-8 text-dark-accent-blue"
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
                  {providerInfo.loadingMessage}
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

export default AiOutput;
