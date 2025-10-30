import React, { useEffect, useRef, useCallback, useMemo, useState } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { ArrowDown } from 'lucide-react';
import type { AiProvider, AiOutputLine } from '../types';
import TerminalOut from './TerminalOut';

interface AiOutputProps {
  messages: AiOutputLine[];
  currentProvider?: AiProvider;
  isLoading?: boolean;
  onKeyInput?: (key: string) => void;
  onResize?: (cols: number, rows: number) => void;
  onReload?: (cols: number, rows: number) => void;
}

const AiOutput: React.FC<AiOutputProps> = ({
  messages,
  currentProvider = 'claude',
  isLoading = false,
  onKeyInput,
  onResize,
  onReload,
}) => {
  const xtermInstance = useRef<Terminal | null>(null);
  const fitAddon = useRef<FitAddon | null>(null);
  const lastMessageCount = useRef<number>(0);
  const currentProviderId = useRef<string>('');
  const hasShownInitialMessage = useRef<boolean>(false);
  const [isReloading, setIsReloading] = useState<boolean>(false);

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

  // 初期メッセージを表示
  const renderInitialMessages = useCallback(
    (targetTerminal: Terminal) => {
      targetTerminal.writeln(providerInfo.initialMessage1);
      targetTerminal.writeln(providerInfo.initialMessage2);
      hasShownInitialMessage.current = true;
    },
    [providerInfo]
  );

  // 一番下までスクロール（Terminalコンポーネントと同じパターン）
  const scrollToBottom = useCallback(() => {
    if (xtermInstance.current) {
      requestAnimationFrame(() => {
        if (xtermInstance.current && xtermInstance.current.buffer) {
          const buffer = xtermInstance.current.buffer.active;
          const scrollToLine = buffer.baseY + buffer.length;
          xtermInstance.current.scrollToLine(scrollToLine);
        }
      });
    }
  }, []);

  // ターミナルのリロード（リサイズ + 履歴再取得）
  const reloadTerminal = useCallback(() => {
    if (fitAddon.current && xtermInstance.current) {
      try {
        setIsReloading(true);

        // ターミナルをリサイズ
        fitAddon.current.fit();
        const cols = xtermInstance.current.cols;
        const rows = xtermInstance.current.rows;

        // onReloadが提供されている場合はリサイズ + 履歴再取得
        // 提供されていない場合は従来のonResizeを使用（リサイズのみ）
        if (onReload) {
          onReload(cols, rows);
        } else if (onResize) {
          onResize(cols, rows);
        }

        // 1秒後にリロード状態を解除
        setTimeout(() => {
          setIsReloading(false);
        }, 1000);
      } catch (error) {
        console.warn('Failed to reload terminal:', error);
        setIsReloading(false);
      }
    }
  }, [onReload, onResize]);

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
      xtermInstance.current = terminalInstance;
      fitAddon.current = fitAddonInstance;

      // 初期サイズをバックエンドに通知
      if (initialSize && onResize) {
        onResize(initialSize.cols, initialSize.rows);
      }

      // 現在のプロバイダーIDを設定
      currentProviderId.current = currentProvider;

      // 初期メッセージまたは履歴を表示
      if (messages.length === 0) {
        renderInitialMessages(terminalInstance);
      } else {
        // 既存のメッセージを全て表示
        messages.forEach((message) => {
          terminalInstance.write(message.content);
        });
        lastMessageCount.current = messages.length;

        // 初期表示後にスクロール
        requestAnimationFrame(() => {
          if (xtermInstance.current && xtermInstance.current.buffer) {
            const buffer = xtermInstance.current.buffer.active;
            const scrollToLine = buffer.baseY + buffer.length;
            xtermInstance.current.scrollToLine(scrollToLine);
          }
        });
      }
    },
    [currentProvider, messages, onResize, renderInitialMessages]
  );

  // プロバイダーが変更された時の処理（Terminalのターミナル切り替えと同じパターン）
  useEffect(() => {
    if (!xtermInstance.current) return;

    // プロバイダーが変更された場合、出力をクリアして新しい内容をロード
    if (currentProviderId.current !== currentProvider) {
      // 出力をクリア
      xtermInstance.current.clear();

      // 現在のメッセージをロード
      if (messages.length > 0) {
        messages.forEach((message) => {
          xtermInstance.current?.write(message.content);
        });
        lastMessageCount.current = messages.length;
      } else {
        // メッセージがない場合は初期メッセージを表示
        renderInitialMessages(xtermInstance.current);
        lastMessageCount.current = 0;
      }

      currentProviderId.current = currentProvider;

      // プロバイダー切り替え後に確実にスクロール
      requestAnimationFrame(() => {
        if (xtermInstance.current && xtermInstance.current.buffer) {
          const buffer = xtermInstance.current.buffer.active;
          const scrollToLine = buffer.baseY + buffer.length;
          xtermInstance.current.scrollToLine(scrollToLine);
        }
      });
    }
  }, [currentProvider, messages, renderInitialMessages]);

  // 新しいメッセージが追加されたらXTermに書き込み（Terminalコンポーネントと同じパターン）
  useEffect(() => {
    if (!xtermInstance.current || currentProviderId.current !== currentProvider)
      return;

    // メッセージが空になった場合
    if (messages.length === 0) {
      if (lastMessageCount.current > 0 || !hasShownInitialMessage.current) {
        xtermInstance.current.clear();
        renderInitialMessages(xtermInstance.current);
        lastMessageCount.current = 0;
      }
      return;
    }

    // 新しいメッセージのみ処理
    const newMessages = messages.slice(lastMessageCount.current);
    if (newMessages.length > 0) {
      // 最初のメッセージの場合は初期メッセージをクリア
      if (lastMessageCount.current === 0 && hasShownInitialMessage.current) {
        xtermInstance.current.clear();
        hasShownInitialMessage.current = false;
      }

      // 新しいメッセージを書き込み
      newMessages.forEach((message) => {
        xtermInstance.current?.write(message.content);
      });

      lastMessageCount.current = messages.length;

      // 最下部にスクロール
      requestAnimationFrame(() => {
        if (xtermInstance.current && xtermInstance.current.buffer) {
          const buffer = xtermInstance.current.buffer.active;
          const scrollToLine = buffer.baseY + buffer.length;
          xtermInstance.current.scrollToLine(scrollToLine);
        }
      });
    }
  }, [messages, currentProvider, renderInitialMessages]);

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
          {/* リロードボタン */}
          <button
            onClick={reloadTerminal}
            disabled={isReloading}
            className={`flex items-center justify-center w-6 h-6 bg-dark-bg-secondary hover:bg-dark-bg-hover rounded border border-dark-border-light text-white focus:outline-none focus:ring-1 focus:ring-dark-border-focus transition-all duration-150 ${
              isReloading ? 'opacity-50 cursor-not-allowed' : ''
            }`}
            title="リサイズして出力を再取得"
          >
            <svg
              className={`w-3.5 h-3.5 ${isReloading ? 'animate-spin' : ''}`}
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
              />
            </svg>
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
          cursorBlink={false}
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
