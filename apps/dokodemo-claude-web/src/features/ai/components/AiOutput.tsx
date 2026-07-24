import {
  useEffect,
  useRef,
  useCallback,
  forwardRef,
  useImperativeHandle,
} from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { ArrowDown, RefreshCw, Maximize2, Minimize2, Loader } from 'lucide-react';
import type { AiOutputLine } from '@/types';
import { useRepositoryContext } from '@/features/repo/providers/RepositoryProvider';
import { useAppSettingsContext } from '@/app/providers/AppSettingsProvider';
import { useAiContext } from '@/features/ai/providers/AiProvider';
import TerminalOut from '@/shared/components/TerminalOut';
import { getProviderInfo } from '@/features/ai/utils/ai-provider-info';
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
    // ターミナルの色設定など、表示不要な制御シーケンスを除去。
    // ただし OSC 8 ハイパーリンク（ESC ] 8 ; ... ESC \）は xterm 内蔵の
    // OscLinkProvider にクリック可能リンクとして処理させたいので除外しない。
    .replace(
      new RegExp(`${ESC}\\](?!8;)[^${BEL}${ESC}]*(?:${BEL}|${ESC}\\\\)`, 'g'),
      ''
    );

  return filtered;
};

interface AiOutputProps {
  /** ターミナル上にファイルがドロップされた際のコールバック */
  onFileDrop?: (files: File[]) => void;
  /** 全画面表示中かどうか */
  isFullscreen?: boolean;
  /** 全画面表示の切り替えコールバック */
  onToggleFullscreen?: () => void;
}

/**
 * AiOutputコンポーネントの公開メソッド
 */
export interface AiOutputRef {
  scrollToBottom: () => void;
  /** ターミナルをリサイズ（fit）してサイズを通知 */
  resize: () => void;
}

/**
 * AI CLI出力表示コンポーネント
 * プロバイダー（Claude, Codex等）の出力を統一的に表示
 */
const AiOutput = forwardRef<AiOutputRef, AiOutputProps>(
  (
    {
      onFileDrop,
      isFullscreen = false,
      onToggleFullscreen,
    },
    ref
  ) => {
    // リポジトリ読み込み状態
    const { repository } = useRepositoryContext();
    const { isLoadingRepoData: isLoading } = repository;

    // AI CLI関連（active instance の出力・キー入力・リサイズ）
    const { aiCli } = useAiContext();
    const {
      currentAiMessages: messages,
      activeInstance,
      handleKeyInput: onKeyInput,
      handleResize: onResize,
    } = aiCli;
    const currentProvider = activeInstance?.provider ?? 'claude';

    // 設定関連（カスタムフォントサイズ）
    const { terminalFontSize: fontSize } = useAppSettingsContext();

    // XTerm.js インスタンスとアドオンの参照
    const xtermInstance = useRef<Terminal | null>(null);
    const fitAddon = useRef<FitAddon | null>(null);

    // 状態管理
    const lastMessageIds = useRef<string[]>([]);
    const lastMessageContents = useRef<Map<string, string>>(new Map()); // メッセージIDと内容のマッピング
    const currentProviderId = useRef<string>('');
    const hasShownInitialMessage = useRef<boolean>(false);

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


    /**
     * 条件付き自動スクロール（一番下にいる場合のみスクロール）
     */
    const scrollToBottomIfAtBottom = useCallback(() => {
      if (isAtBottom()) {
        scrollToBottom();
      }
    }, [isAtBottom, scrollToBottom]);

    // ターミナルをリサイズ（fit）してサイズをバックエンドに通知
    const resizeTerminal = useCallback(() => {
      if (fitAddon.current && xtermInstance.current) {
        fitAddon.current.fit();
        const cols = xtermInstance.current.cols;
        const rows = xtermInstance.current.rows;
        if (onResize) {
          onResize(cols, rows);
        }
      }
    }, [onResize]);

    // refを通じてメソッドを公開
    useImperativeHandle(ref, () => ({
      scrollToBottom,
      resize: resizeTerminal,
    }));

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

      // 履歴の全置換を検知（プライマリの provider 切替で別 provider の履歴が
      // 届いた場合など、既描画メッセージと 1 件も重ならない）: 画面を
      // リセットして全メッセージを描き直す
      if (
        lastMessageIds.current.length > 0 &&
        !messages.some((m) => lastMessageContents.current.has(m.id))
      ) {
        xtermInstance.current.reset();
        hasShownInitialMessage.current = false;
        messages.forEach((message) => {
          xtermInstance.current?.write(
            filterTerminalResponses(message.content)
          );
        });
        lastMessageIds.current = currentMessageIds;
        lastMessageContents.current.clear();
        messages.forEach((m) =>
          lastMessageContents.current.set(m.id, m.content)
        );
        requestAnimationFrame(() => {
          scrollToBottom();
        });
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
      scrollToBottom,
      scrollToBottomIfAtBottom,
    ]);

    return (
      <div className={s.root}>
        {/* XTermターミナル出力エリア */}
        <div className={s.terminalArea}>
          <TerminalOut
            onKeyInput={onKeyInput}
            onTerminalReady={handleTerminalReady}
            onResize={handleTerminalOutResize}
            disableStdin={false}
            cursorBlink={false}
            fontSize={fontSize}
            onFileDrop={onFileDrop}
          />

          {/* 右上のツールボタン群（リサイズ・全画面切替） */}
          <div className={s.toolButtonWrapper}>
            <button
              onClick={resizeTerminal}
              className={s.toolButton}
              title="ターミナルをリサイズ"
            >
              <RefreshCw size={12} />
            </button>
            {onToggleFullscreen && (
              <button
                onClick={onToggleFullscreen}
                className={s.toolButton}
                title={isFullscreen ? '全画面を閉じる' : '全画面表示'}
                aria-pressed={isFullscreen}
              >
                {isFullscreen ? (
                  <Minimize2 size={12} />
                ) : (
                  <Maximize2 size={12} />
                )}
              </button>
            )}
          </div>

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
                <Loader className={s.loadingSpinner} size={32} aria-hidden />
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
      </div>
    );
  }
);

export default AiOutput;
