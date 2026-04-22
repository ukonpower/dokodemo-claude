import {
  useEffect,
  useRef,
  useCallback,
  useState,
  forwardRef,
  useImperativeHandle,
} from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { ArrowDown, Maximize2, X } from 'lucide-react';
import type { AiProvider, AiOutputLine } from '../types';
import TerminalOut from './TerminalOut';
import { getProviderInfo } from '../utils/ai-provider-info';
import ProviderSwitcher from './ProviderSwitcher';
import s from './AiOutput.module.scss';

/**
 * ターミナル制御シーケンスの応答をフィルタリング
 * CLIがターミナル機能を確認する際に送信するクエリへの応答を除去
 */
const filterTerminalResponses = (content: string): string => {
  // ESC文字（\x1b = \u001b）
  const ESC = '\u001b';
  // BEL文字（\x07 = \u0007）
  const BEL = '\u0007';
  const filtered = content
    // Device Attributes (DA) 応答: ESC [ ? ... c
    .replace(new RegExp(`${ESC}\\[\\?[\\d;]*c`, 'g'), '')
    // Cursor Position Report (CPR) 応答: ESC [ row ; col R
    .replace(new RegExp(`${ESC}\\[[\\d;]*R`, 'g'), '')
    // OSC (Operating System Command) シーケンス: ESC ] ... (BEL | ESC \)
    // ターミナルの色設定など、表示不要な制御シーケンスを除去
    .replace(
      new RegExp(`${ESC}\\][^${BEL}${ESC}]*(?:${BEL}|${ESC}\\\\)`, 'g'),
      ''
    );

  return filtered;
};

interface AiOutputProps {
  messages: AiOutputLine[];
  currentProvider?: AiProvider;
  isLoading?: boolean;
  onKeyInput?: (key: string) => void;
  onResize?: (cols: number, rows: number) => void;
  onReload?: (cols: number, rows: number) => void;
  onClearHistory?: () => void;
  /** プロバイダー切り替えハンドラ */
  onProviderChange?: (provider: AiProvider) => void;
  /** カスタムフォントサイズ */
  fontSize?: number;
}

/**
 * AiOutputコンポーネントの公開メソッド
 */
export interface AiOutputRef {
  scrollToBottom: () => void;
}

/**
 * AI CLI出力表示コンポーネント
 * プロバイダー（Claude, Codex等）の出力を統一的に表示
 */
const AiOutput = forwardRef<AiOutputRef, AiOutputProps>(
  (
    {
      messages,
      currentProvider = 'claude',
      isLoading = false,
      onKeyInput,
      onResize,
      onReload,
      onClearHistory,
      onProviderChange,
      fontSize,
    },
    ref
  ) => {
    // XTerm.js インスタンスとアドオンの参照
    const xtermInstance = useRef<Terminal | null>(null);
    const fitAddon = useRef<FitAddon | null>(null);

    // 状態管理
    const lastMessageIds = useRef<string[]>([]);
    const lastMessageContents = useRef<Map<string, string>>(new Map()); // メッセージIDと内容のマッピング
    const currentProviderId = useRef<string>('');
    const hasShownInitialMessage = useRef<boolean>(false);
    const [isReloading, setIsReloading] = useState<boolean>(false);
    const [isFullscreen, setIsFullscreen] = useState<boolean>(false);

    // プロバイダー情報を取得
    const providerInfo = getProviderInfo(currentProvider);

    /**
     * 初期メッセージを表示
     */
    const renderInitialMessages = useCallback(
      (targetTerminal: Terminal) => {
        targetTerminal.writeln(providerInfo.initialMessage1);
        targetTerminal.writeln(providerInfo.initialMessage2);
        hasShownInitialMessage.current = true;
      },
      [providerInfo]
    );

    /**
     * スクロール位置が一番下にあるかを判定
     */
    const isAtBottom = useCallback((): boolean => {
      if (!xtermInstance.current || !xtermInstance.current.buffer) {
        return true;
      }

      const buffer = xtermInstance.current.buffer.active;
      const viewport = xtermInstance.current.buffer.active.viewportY;
      const maxScroll =
        buffer.baseY + buffer.length - xtermInstance.current.rows;

      // 最下部から数行以内であれば「一番下」と判定（余裕を持たせる）
      const atBottom = viewport >= maxScroll - 2;

      return atBottom;
    }, []);

    /**
     * 一番下までスクロール
     */
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

    // refを通じてscrollToBottomメソッドを公開
    useImperativeHandle(ref, () => ({
      scrollToBottom,
    }));

    /**
     * 条件付き自動スクロール（一番下にいる場合のみスクロール）
     */
    const scrollToBottomIfAtBottom = useCallback(() => {
      if (isAtBottom()) {
        scrollToBottom();
      }
    }, [isAtBottom, scrollToBottom]);

    /**
     * ターミナルのリロード（リサイズ + 履歴再取得）
     */
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

    /**
     * ESCキーで全画面解除
     */
    useEffect(() => {
      const handleKeyDown = (e: KeyboardEvent) => {
        if (e.key === 'Escape' && isFullscreen) {
          setIsFullscreen(false);
        }
      };

      if (isFullscreen) {
        document.addEventListener('keydown', handleKeyDown);
        return () => document.removeEventListener('keydown', handleKeyDown);
      }
    }, [isFullscreen]);

    /**
     * 全画面切替時にターミナルをリサイズ
     */
    useEffect(() => {
      if (fitAddon.current) {
        setTimeout(() => {
          fitAddon.current?.fit();
        }, 50);
      }
    }, [isFullscreen]);

    /**
     * TerminalOutからのリサイズコールバック
     */
    const handleTerminalOutResize = useCallback(
      (cols: number, rows: number) => {
        if (onResize) {
          onResize(cols, rows);
        }
      },
      [onResize]
    );

    /**
     * TerminalOutからターミナルインスタンスを受け取る
     */
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
            terminalInstance.write(filterTerminalResponses(message.content));
          });
          lastMessageIds.current = messages.map((m) => m.id);
          // メッセージ内容のマッピングを更新
          lastMessageContents.current.clear();
          messages.forEach((m) =>
            lastMessageContents.current.set(m.id, m.content)
          );

          // 初期表示後にスクロール
          requestAnimationFrame(() => {
            scrollToBottom();
          });
        }
      },
      [
        currentProvider,
        messages,
        onResize,
        renderInitialMessages,
        scrollToBottom,
      ]
    );

    /**
     * プロバイダーが変更された時の処理
     */
    useEffect(() => {
      if (!xtermInstance.current) return;

      // プロバイダーが変更された場合、出力をクリアして新しい内容をロード
      if (currentProviderId.current !== currentProvider) {
        // 出力を完全にリセット（スクロールバッファと画面内容の両方をクリア）
        xtermInstance.current.reset();
        // 初期メッセージ表示フラグもリセット
        hasShownInitialMessage.current = false;

        // 現在のメッセージをロード
        if (messages.length > 0) {
          messages.forEach((message) => {
            xtermInstance.current?.write(
              filterTerminalResponses(message.content)
            );
          });
          lastMessageIds.current = messages.map((m) => m.id);
          // メッセージ内容のマッピングを更新
          lastMessageContents.current.clear();
          messages.forEach((m) =>
            lastMessageContents.current.set(m.id, m.content)
          );
        } else {
          // メッセージがない場合は初期メッセージを表示
          renderInitialMessages(xtermInstance.current);
          lastMessageIds.current = [];
          lastMessageContents.current.clear();
        }

        currentProviderId.current = currentProvider;

        // プロバイダー切り替え時は常にスクロール（ユーザー操作による切り替えのため）
        requestAnimationFrame(() => {
          scrollToBottom();
        });
      }
    }, [currentProvider, messages, renderInitialMessages, scrollToBottom]);

    /**
     * 最初のメッセージ到着時（Claudeセッション開始時）にリサイズを実行
     */
    useEffect(() => {
      // 最初のメッセージが到着し、xtermインスタンスが準備完了している場合
      if (
        xtermInstance.current &&
        fitAddon.current &&
        messages.length > 0 &&
        lastMessageIds.current.length === 0 &&
        currentProviderId.current === currentProvider
      ) {
        // DOMレイアウト確定を待ってからリサイズ実行
        setTimeout(() => {
          try {
            fitAddon.current?.fit();
            if (xtermInstance.current && xtermInstance.current.rows > 0) {
              xtermInstance.current.refresh(0, xtermInstance.current.rows - 1);
            }
          } catch (error) {
            console.warn('Failed to fit terminal on first message:', error);
          }
        }, 50);
      }
    }, [messages.length, currentProvider]);

    /**
     * 新しいメッセージが追加されたらXTermに書き込み
     */
    useEffect(() => {
      if (
        !xtermInstance.current ||
        currentProviderId.current !== currentProvider
      ) {
        return;
      }

      // 現在のメッセージIDリストを取得
      const currentMessageIds = messages.map((m) => m.id);

      // メッセージが空になった場合
      if (messages.length === 0) {
        if (
          lastMessageIds.current.length > 0 ||
          !hasShownInitialMessage.current
        ) {
          xtermInstance.current.clear();
          renderInitialMessages(xtermInstance.current);
          lastMessageIds.current = [];
          lastMessageContents.current.clear();
        }
        return;
      }

      // 新しいメッセージまたは内容が更新されたメッセージのみを抽出
      const newMessages: AiOutputLine[] = [];

      for (let i = 0; i < messages.length; i++) {
        const message = messages[i];
        const lastContent = lastMessageContents.current.get(message.id);

        // メッセージIDが新規、または内容が変更された場合
        if (lastContent === undefined || lastContent !== message.content) {
          newMessages.push(message);
        }
      }

      // 変更がない場合はスキップ
      if (newMessages.length === 0) {
        return;
      }

      // 最初のメッセージの場合は初期メッセージをクリア
      if (
        lastMessageIds.current.length === 0 &&
        hasShownInitialMessage.current
      ) {
        xtermInstance.current.clear();
        hasShownInitialMessage.current = false;
      }

      // 新しい/変更されたメッセージを書き込み
      newMessages.forEach((message) => {
        const filtered = filterTerminalResponses(message.content);
        xtermInstance.current?.write(filtered);
        // 書き込んだメッセージの内容を記録
        lastMessageContents.current.set(message.id, message.content);
      });

      // メッセージIDリストを更新
      lastMessageIds.current = currentMessageIds;

      // 一番下にいる場合のみ自動スクロール
      requestAnimationFrame(() => {
        scrollToBottomIfAtBottom();
      });
    }, [
      messages,
      currentProvider,
      renderInitialMessages,
      scrollToBottomIfAtBottom,
    ]);

    return (
      <div className={s.root}>
        {/* ヘッダー */}
        <div className={s.header}>
          <div className={s.headerInner}>
            <div className={s.headerLeft}>
              <div className={s.statusGroup}>
                <div className={s.statusDot}></div>
                <span className={s.headerLabel}>
                  {providerInfo.headerLabel}
                </span>
              </div>
              {/* プロバイダー切り替え */}
              {onProviderChange && (
                <ProviderSwitcher
                  currentProvider={currentProvider}
                  onProviderChange={onProviderChange}
                  disabled={isLoading}
                />
              )}
            </div>
            {/* ボタングループ */}
            <div className={s.headerButtons}>
              {/* 履歴削除ボタン */}
              {onClearHistory && (
                <button
                  onClick={onClearHistory}
                  className={s.iconButton}
                  title="出力履歴をクリア"
                >
                  <svg
                    className={s.iconButtonIcon}
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
                    />
                  </svg>
                </button>
              )}
              {/* リロードボタン */}
              <button
                onClick={reloadTerminal}
                disabled={isReloading}
                className={`${s.iconButton} ${isReloading ? s.reloadSpin : ''}`}
                style={isReloading ? { opacity: 0.5, cursor: 'not-allowed' } : undefined}
                title="リサイズして出力を再取得"
              >
                <svg
                  className={`${s.iconButtonIcon} ${isReloading ? s.reloadSpin : ''}`}
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
              {/* 全画面ボタン */}
              <button
                onClick={() => setIsFullscreen(true)}
                className={s.iconButton}
                title="全画面表示"
              >
                <Maximize2 size={14} />
              </button>
            </div>
          </div>
        </div>

        {/* XTermターミナル出力エリア */}
        <div className={s.terminalArea}>
          <TerminalOut
            onKeyInput={onKeyInput}
            onTerminalReady={handleTerminalReady}
            onResize={handleTerminalOutResize}
            disableStdin={false}
            cursorBlink={false}
            fontSize={fontSize}
          />

          {/* 右下のスクロールボタン */}
          <div className={s.scrollButtonWrapper}>
            <button
              onClick={scrollToBottom}
              className={s.scrollButton}
              title="一番下までスクロール"
            >
              <ArrowDown size={16} />
            </button>
          </div>

          {/* AI CLI専用ローディング表示 */}
          {isLoading && (
            <div className={s.loadingOverlay}>
              <div className={s.loadingContent}>
                <svg
                  className={s.loadingSpinner}
                  xmlns="http://www.w3.org/2000/svg"
                  fill="none"
                  viewBox="0 0 24 24"
                >
                  <circle
                    className={s.loadingSpinnerCircle}
                    cx="12"
                    cy="12"
                    r="10"
                    stroke="currentColor"
                    strokeWidth="4"
                  ></circle>
                  <path
                    className={s.loadingSpinnerPath}
                    fill="currentColor"
                    d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                  ></path>
                </svg>
                <div className={s.loadingText}>
                  <p className={s.loadingMessage}>
                    {providerInfo.loadingMessage}
                  </p>
                  <p className={s.loadingSubmessage}>
                    データを準備しています
                  </p>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* 全画面オーバーレイ */}
        {isFullscreen && (
          <div className={s.fullscreenOverlay}>
            {/* 全画面ヘッダー */}
            <div className={s.fullscreenHeader}>
              <div className={s.fullscreenHeaderLeft}>
                <div className={s.statusDot}></div>
                <span className={s.fullscreenLabel}>
                  {providerInfo.headerLabel} - 全画面表示
                </span>
              </div>
              <button
                onClick={() => setIsFullscreen(false)}
                className={s.fullscreenCloseButton}
                title="全画面を閉じる (ESC)"
              >
                <X size={18} />
              </button>
            </div>
            {/* 全画面ターミナル */}
            <div className={s.fullscreenTerminal}>
              <TerminalOut
                onKeyInput={onKeyInput}
                onTerminalReady={handleTerminalReady}
                onResize={handleTerminalOutResize}
                disableStdin={false}
                cursorBlink={false}
                fontSize={fontSize}
              />
              {/* 全画面時のスクロールボタン */}
              <div className={s.fullscreenScrollWrapper}>
                <button
                  onClick={scrollToBottom}
                  className={s.fullscreenScrollButton}
                  title="一番下までスクロール"
                >
                  <ArrowDown size={20} />
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }
);

export default AiOutput;
