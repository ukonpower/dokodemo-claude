import React, { useEffect, useRef, useCallback, useMemo, useId } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { ArrowDown, Maximize2 } from 'lucide-react';
import type { AiProvider } from '../types';
import TerminalOut from './TerminalOut';

interface AiOutputProps {
  rawOutput: string;
  currentProvider?: AiProvider; // プロバイダー情報を追加
  isLoading?: boolean;
  onKeyInput?: (key: string) => void;
  onResize?: (cols: number, rows: number) => void;
}

const AiOutput: React.FC<AiOutputProps> = ({
  rawOutput,
  currentProvider = 'claude',
  isLoading = false,
  onKeyInput,
  onResize,
}) => {
  const outputId = useId();
  const terminal = useRef<Terminal | null>(null);
  const fitAddon = useRef<FitAddon | null>(null);
  const lastOutputLength = useRef<number>(0);
  const hasShownInitialMessage = useRef<boolean>(false);
  const pendingInitialOutput = useRef<string | null>(null);

  const providerInfo = useMemo(() => {
    switch (currentProvider) {
      case 'claude':
        return {
          name: 'Claude CLI',
          shortName: 'Claude',
          initialMessage1: 'Claude CLIの出力がここに表示されます',
          initialMessage2: 'リポジトリを選択してClaude CLIを開始してください',
          loadingMessage: 'Claude CLI履歴を読み込み中...',
          headerLabel: 'Claude CLI Output',
        };
      case 'codex':
        return {
          name: 'Codex CLI',
          shortName: 'Codex',
          initialMessage1: 'Codex CLIの出力がここに表示されます',
          initialMessage2: 'リポジトリを選択してCodex CLIを開始してください',
          loadingMessage: 'Codex CLI履歴を読み込み中...',
          headerLabel: 'Codex CLI Output',
        };
      default:
        return {
          name: 'AI CLI',
          shortName: 'AI',
          initialMessage1: 'AI CLIの出力がここに表示されます',
          initialMessage2: 'リポジトリを選択してAI CLIを開始してください',
          loadingMessage: 'AI CLI履歴を読み込み中...',
          headerLabel: 'AI CLI Output',
        };
    }
  }, [currentProvider]);

  const debugLog = useCallback(
    (message: string, extra?: Record<string, unknown>) => {
      const rawLength = rawOutput?.length ?? 0;
      console.debug('[AiOutput]', message, {
        id: outputId,
        rawLength,
        lastOutputLength: lastOutputLength.current,
        hasShownInitialMessage: hasShownInitialMessage.current,
        provider: currentProvider,
        ...extra,
      });
    },
    [currentProvider, outputId, rawOutput]
  );

  const renderInitialMessages = useCallback(
    (targetTerminal: Terminal) => {
      targetTerminal.writeln(providerInfo.initialMessage1);
      targetTerminal.writeln(providerInfo.initialMessage2);
      hasShownInitialMessage.current = true;
      debugLog('Rendered initial provider messages');
    },
    [debugLog, providerInfo]
  );

  const syncTerminalWithOutput = useCallback(
    (options?: { forceFullRender?: boolean }) => {
      if (!terminal.current) {
        const requestedForce = options?.forceFullRender ?? false;
        if (rawOutput) {
          pendingInitialOutput.current = rawOutput;
          debugLog('Terminal not ready, cached pending output', {
            cachedLength: rawOutput.length,
            force: requestedForce,
          });
        } else if (pendingInitialOutput.current && !rawOutput) {
          pendingInitialOutput.current = null;
        }
        debugLog('syncTerminalWithOutput skipped: terminal not ready', {
          force: options?.forceFullRender,
        });
        return;
      }

      const targetTerminal = terminal.current;
      const shouldForceFullRender = options?.forceFullRender ?? false;
      debugLog('syncTerminalWithOutput invoked', {
        force: shouldForceFullRender,
      });

      if (!rawOutput) {
        pendingInitialOutput.current = null;
        const shouldClear =
          shouldForceFullRender ||
          lastOutputLength.current > 0 ||
          !hasShownInitialMessage.current;

        if (shouldClear) {
          targetTerminal.clear();
          lastOutputLength.current = 0;
          hasShownInitialMessage.current = false;
          debugLog('Cleared terminal for empty rawOutput', {
            reason: shouldForceFullRender ? 'force' : 'stateChanged',
          });
        }

        if (shouldForceFullRender || !hasShownInitialMessage.current) {
          renderInitialMessages(targetTerminal);
        }
        return;
      }

      if (shouldForceFullRender || rawOutput.length < lastOutputLength.current) {
        targetTerminal.clear();
        targetTerminal.write(rawOutput);
        lastOutputLength.current = rawOutput.length;
        hasShownInitialMessage.current = false;

        // 出力後に確実にスクロール
        requestAnimationFrame(() => {
          if (targetTerminal && targetTerminal.buffer) {
            const buffer = targetTerminal.buffer.active;
            const scrollToLine = buffer.baseY + buffer.length;
            targetTerminal.scrollToLine(scrollToLine);
          }
        });

        debugLog('Rendered full rawOutput', {
          appliedLength: rawOutput.length,
          force: shouldForceFullRender,
        });
        return;
      }

      const newOutput = rawOutput.slice(lastOutputLength.current);
      if (!newOutput) {
        debugLog('No new output to append');
        return;
      }

      if (lastOutputLength.current === 0) {
        targetTerminal.clear();
      }

      targetTerminal.write(newOutput);
      lastOutputLength.current = rawOutput.length;
      hasShownInitialMessage.current = false;

      // 出力後に確実にスクロール
      requestAnimationFrame(() => {
        if (targetTerminal && targetTerminal.buffer) {
          const buffer = targetTerminal.buffer.active;
          const scrollToLine = buffer.baseY + buffer.length;
          targetTerminal.scrollToLine(scrollToLine);
        }
      });

      debugLog('Appended new output chunk', {
        appendedLength: newOutput.length,
      });
    },
    [debugLog, rawOutput, renderInitialMessages]
  );

  // 一番下までスクロールする関数
  const scrollToBottom = () => {
    if (terminal.current) {
      // 確実にスクロールするために、少し遅延させて実行
      requestAnimationFrame(() => {
        if (terminal.current) {
          // バッファの一番下の行番号を取得してスクロール
          const buffer = terminal.current.buffer.active;
          const scrollToLine = buffer.baseY + buffer.length;
          terminal.current.scrollToLine(scrollToLine);
          debugLog('Scroll to bottom button pressed', { scrollToLine });
        }
      });
    }
  };

  // ターミナルのリサイズを再送信する関数
  const resendTerminalSize = () => {
    if (fitAddon.current && terminal.current) {
      try {
        // ターミナルをリサイズ
        fitAddon.current.fit();
        const cols = terminal.current.cols;
        const rows = terminal.current.rows;

        // 新しいサイズをバックエンドに送信
        if (onResize) {
          onResize(cols, rows);
          debugLog('Terminal size resent', { cols, rows });
        }
      } catch (error) {
        console.warn('Failed to resize terminal:', error);
      }
    }
  };

  // TerminalOutからのリサイズコールバック
  const handleTerminalOutResize = useCallback(
    (cols: number, rows: number) => {
      if (onResize) {
        onResize(cols, rows);
      }
    },
    [onResize]
  );

  // TerminalOutからターミナルインスタンスを受け取る
  const handleTerminalReady = useCallback(
    (
      terminalInstance: Terminal,
      fitAddonInstance: FitAddon,
      initialSize?: { cols: number; rows: number }
    ) => {
      debugLog('Terminal ready');
      terminal.current = terminalInstance;
      fitAddon.current = fitAddonInstance;

      // 初期サイズをバックエンドに通知
      if (initialSize && onResize) {
        onResize(initialSize.cols, initialSize.rows);
      }

      // 既存の出力または初期メッセージを描画
      if (pendingInitialOutput.current) {
        const cachedOutput = pendingInitialOutput.current;
        pendingInitialOutput.current = null;
        terminalInstance.clear();
        terminalInstance.write(cachedOutput);
        lastOutputLength.current = cachedOutput.length;
        hasShownInitialMessage.current = false;
        terminalInstance.scrollToBottom();
        debugLog('Flushed cached pending output', {
          length: cachedOutput.length,
        });
        return;
      }

      syncTerminalWithOutput({ forceFullRender: true });
    },
    [debugLog, onResize, syncTerminalWithOutput]
  );

  // プロバイダー変更時にターミナルを初期化
  useEffect(() => {
    if (!terminal.current) return;

    // ターミナルをクリアしてリセット
    terminal.current.clear();
    lastOutputLength.current = 0;
    hasShownInitialMessage.current = false;
    debugLog('Provider changed, forcing full render');
    syncTerminalWithOutput({ forceFullRender: true });
  }, [currentProvider, debugLog, syncTerminalWithOutput]);

  // 出力が更新されたらターミナルに書き込み（差分のみ追記）
  useEffect(() => {
    debugLog('rawOutput changed, syncing terminal');
    syncTerminalWithOutput();
  }, [debugLog, rawOutput, syncTerminalWithOutput]);

  return (
    <div className="flex flex-col h-full">
      {/* ヘッダー */}
      <div className="px-2 sm:px-3 py-2 border-b bg-dark-bg-tertiary border-dark-border-DEFAULT">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <div className="w-2 h-2 rounded-full bg-dark-accent-green"></div>
            <span className="text-gray-300 text-xs">
              {providerInfo.headerLabel}
            </span>
          </div>
          {/* リサイズ再送信ボタン */}
          <button
            onClick={resendTerminalSize}
            className="flex items-center justify-center w-6 h-6 bg-dark-bg-secondary hover:bg-dark-bg-hover rounded border border-dark-border-light text-white focus:outline-none focus:ring-1 focus:ring-dark-border-focus transition-all duration-150"
            title="ターミナルサイズを再送信"
          >
            <Maximize2 size={14} />
          </button>
        </div>
      </div>

      {/* XTermターミナル出力エリア */}
      <div className="flex-1 bg-dark-bg-primary relative">
        <TerminalOut
          onKeyInput={onKeyInput}
          onTerminalReady={handleTerminalReady}
          onResize={handleTerminalOutResize}
          disableStdin={false}
        />

        {/* 右下のスクロールボタン */}
        <div className="absolute right-2 bottom-2" style={{ zIndex: 20 }}>
          {/* スクロール位置を一番下に移動するボタン */}
          <button
            onClick={scrollToBottom}
            className="flex items-center justify-center w-8 h-8 bg-dark-bg-secondary hover:bg-dark-bg-hover rounded-full border border-dark-border-light text-white focus:outline-none focus:ring-2 focus:ring-dark-border-focus transition-all duration-150 shadow-lg"
            title="一番下までスクロール"
          >
            <ArrowDown size={16} />
          </button>
        </div>

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
