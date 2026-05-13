import React, { useEffect, useRef, useCallback, useState, useMemo } from 'react';
import { Terminal, IDisposable, ILink } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import s from './TerminalOut.module.scss';

// URL とみなす連続文字。空白・引用符・括弧類のほか、Box drawing 罫線や CJK 範囲も
// 終端扱いにすることで、罫線に囲まれた URL や日本語が続く URL でも URL 部分だけ
// 綺麗に切り出せる。
// U+2500-U+257F: Box drawing（罫線）
// U+3000-U+303F: CJK 記号と句読点（全角空白含む）
// U+3040-U+30FF: ひらがな/カタカナ
// U+3400-U+9FFF: CJK 統合漢字
// U+FF00-U+FFEF: 全角英数・記号
const URL_REGEX =
  /https?:\/\/[^\s<>"'`\u2500-\u257f\u3000-\u303f\u3040-\u30ff\u3400-\u9fff\uff00-\uffef]+/g;
// \u884c\u672b\u306b\u300chttps?://\u2026 \u304c EOL \u307e\u3067\u4f38\u3073\u3066\u3044\u308b\u300d\u72b6\u614b\u304b\u3092\u5224\u5b9a\u3059\u308b\u6b63\u898f\u8868\u73fe\u3002
// \u8a72\u5f53\u884c\u304c URL \u6539\u884c\u306e START \u884c\u3067\u3042\u308b\u3053\u3068\u3092\u793a\u3059\u5f37\u3044\u624b\u304c\u304b\u308a\u306b\u306a\u308b\u3002
const URL_LINE_TAIL =
  /https?:\/\/[^\s<>"'`\u2500-\u257f\u3000-\u303f\u3040-\u30ff\u3400-\u9fff\uff00-\uffef]*$/;
const TRAILING_PUNCTUATION = /[.,;:!?)\]}>'"`]+$/;
// 論理行連結のヒューリスティック判定で使う、URL を構成しうる ASCII 文字
const URL_TAIL_CHAR = /[A-Za-z0-9/?#&%=._~+\-:@]$/;
const URL_HEAD_CHAR = /^[A-Za-z0-9/?#&%=._~+\-:@]/;

/**
 * TerminalOutコンポーネントのProps
 */
interface TerminalOutProps {
  /**
   * ターミナルにキー入力があった際のコールバック
   * @param data - 入力されたデータ（ANSIエスケープシーケンス含む）
   */
  onKeyInput?: (data: string) => void;

  /**
   * ターミナルがクリックされた際のコールバック
   */
  onClick?: () => void;

  /**
   * ターミナルインスタンスが初期化された際のコールバック
   * 親コンポーネントでターミナルインスタンスを直接操作したい場合に使用
   */
  onTerminalReady?: (
    terminal: Terminal,
    fitAddon: FitAddon,
    initialSize?: { cols: number; rows: number }
  ) => void;

  /**
   * ターミナルがリサイズされた際のコールバック
   */
  onResize?: (cols: number, rows: number) => void;

  /**
   * カスタムフォントサイズ（省略時は画面サイズで自動設定）
   */
  fontSize?: number;

  /**
   * カーソルを点滅させるか（デフォルト: true）
   */
  cursorBlink?: boolean;

  /**
   * 標準入力を無効化するか（デフォルト: false）
   */
  disableStdin?: boolean;

  /**
   * ユーザー入力時にスクロールするか（デフォルト: false）
   */
  scrollOnUserInput?: boolean;

  /**
   * このターミナルがアクティブ（表示状態）かどうか
   * タブ切り替え時の再描画に使用
   */
  isActive?: boolean;
}

/**
 * TerminalOut - xterm.jsを使用したターミナル表示コンポーネント
 *
 * AiOutputとTerminalで共通利用されるターミナル表示とキー入力処理を提供します。
 * xterm.jsの初期化、リサイズ対応、キー入力ハンドリングを内部で行います。
 */
const TerminalOut: React.FC<TerminalOutProps> = ({
  onKeyInput,
  onClick,
  onTerminalReady,
  onResize,
  fontSize,
  cursorBlink = true,
  disableStdin = false,
  scrollOnUserInput = false,
  isActive,
}) => {
  const terminalRef = useRef<HTMLDivElement>(null);
  const terminal = useRef<Terminal | null>(null);
  const fitAddon = useRef<FitAddon | null>(null);
  const linkProviderDisposable = useRef<IDisposable | null>(null);
  const resizeObserver = useRef<ResizeObserver | null>(null);
  const onKeyInputRef = useRef<typeof onKeyInput>(onKeyInput);
  const mouseDownPos = useRef<{ x: number; y: number } | null>(null);
  const lastTouchY = useRef<number>(0);
  const isTwoFingerScroll = useRef<boolean>(false);
  const isScrollHandleDrag = useRef<boolean>(false);
  const scrollHandleStartY = useRef<number>(0);
  const isComposing = useRef<boolean>(false);
  const compositionEndTime = useRef<number>(0);

  // iOS検出（コンポーネントスコープで共有）
  const isIOS = useMemo(
    () =>
      /iPhone|iPad|iPod/.test(navigator.userAgent) ||
      (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1),
    []
  );

  // iOS長押しテキスト選択用
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const longPressTouchPos = useRef<{ x: number; y: number } | null>(null);
  const [showTextOverlay, setShowTextOverlay] = useState(false);
  const [overlayText, setOverlayText] = useState('');

  // onKeyInputの最新値を保持（useEffectの依存関係に含めないため）
  useEffect(() => {
    onKeyInputRef.current = onKeyInput;
  }, [onKeyInput]);

  // textareaへのアクセス用の型拡張
  type TerminalWithTextarea = Terminal & {
    textarea?: HTMLTextAreaElement | null;
  };

  // ターミナルにフォーカスを当てる関数
  const focusTerminal = useCallback(() => {
    if (!terminal.current || disableStdin) {
      return;
    }
    terminal.current.focus();
    const textarea = (terminal.current as TerminalWithTextarea).textarea;
    textarea?.focus?.();
  }, [disableStdin]);

  const fitTerminal = useCallback(() => {
    if (!fitAddon.current || !terminal.current) {
      return;
    }

    // ターミナルが完全に初期化されているかチェック
    if (!terminal.current.element) {
      return;
    }

    try {
      const beforeCols = terminal.current.cols;
      const beforeRows = terminal.current.rows;
      fitAddon.current.fit();
      const afterCols = terminal.current.cols;
      const afterRows = terminal.current.rows;
      if (terminal.current.rows > 0) {
        terminal.current.refresh(0, terminal.current.rows - 1);
      }

      // サイズが変更された場合、onResizeコールバックを呼び出す
      if (onResize && (beforeCols !== afterCols || beforeRows !== afterRows)) {
        onResize(afterCols, afterRows);
      }
    } catch (error) {
      // fit()中にdimensionsが未定義の場合などのエラーをキャッチ
      console.warn('Failed to fit terminal:', error);
    }
  }, [onResize]);

  // ターミナルを初期化
  useEffect(() => {
    if (!terminalRef.current) return;

    // FitAddonを作成
    fitAddon.current = new FitAddon();

    // フォントサイズを決定（カスタム指定がなければ画面サイズで自動設定）
    const isLargeScreen = window.innerWidth >= 860; // lg breakpoint
    const finalFontSize = fontSize ?? (isLargeScreen ? 11 : 9);

    // ターミナルインスタンスを作成（横スクロール対応の設定）
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
        '"Share Tech Mono", "JetBrains Mono", "Fira Code", "SF Mono", Monaco, "Cascadia Code", monospace',
      fontSize: finalFontSize,
      letterSpacing: -0.5,
      lineHeight: 1.0,
      cursorBlink: cursorBlink,
      cursorStyle: 'block',
      scrollback: 10000,
      convertEol: false, // 改行の自動変換を無効化して横スクロールを有効
      allowTransparency: false,
      disableStdin: disableStdin, // 標準入力の有効/無効
      smoothScrollDuration: 0,
      scrollOnUserInput: scrollOnUserInput,
      fastScrollModifier: 'shift',
      scrollSensitivity: 1.5,
      // 横スクロール対応の設定
      cols: 600, // 適度な列数を設定
      allowProposedApi: true, // 横スクロール機能に必要
    });

    // FitAddonを読み込み
    terminal.current.loadAddon(fitAddon.current);

    // 折り返し（isWrapped）と PTY 由来の \r\n 改行の双方を考慮したカスタム
    // リンクプロバイダを登録。xterm の auto-wrap でしか isWrapped は立たないため、
    // 「行末まで URL が伸びている／継続行は（インデント除去後）空白なしの URL 風文字のみ」を
    // 手がかりに論理行を連結することで、Claude Code 等が narrower wrap で打つ明示改行
    // （しかも継続行に "  " のぶら下がりインデントが付く）でも URL が切れずに全行
    // クリック可能になるようにする。
    const MAX_BACK = 20;
    const MAX_FWD = 20;

    linkProviderDisposable.current = terminal.current.registerLinkProvider({
      provideLinks: (bufferLineNumber, callback) => {
        const term = terminal.current;
        if (!term) {
          callback(undefined);
          return;
        }
        const buf = term.buffer.active;
        const cols = term.cols;

        // idx 行が次の行へ URL として継続するかを判定する。
        // 継続行（next）の先頭インデントは除去してから判定する（Claude Code の
        // ぶら下がりインデント対策）。
        // 連結条件:
        //   (a) xterm auto-wrap (next.isWrapped)、または
        //   (b) cur が cols まで埋まっている auto-wrap、または
        //   (c) cur 行末が「https?://…」で終わる START 行、または
        //   (d) cur が（先頭インデント除去後）空白を含まない MIDDLE 行で、遡った先に
        //       START 行が存在する
        const continuesToNext = (idx: number): boolean => {
          const next = buf.getLine(idx + 1);
          if (!next) return false;
          if (next.isWrapped) return true;
          const cur = buf.getLine(idx);
          if (!cur) return false;
          const curT = cur.translateToString(true);
          if (curT.length === 0) return false;
          const nextT = next.translateToString(true);
          if (nextT.length === 0) return false;
          if (!URL_TAIL_CHAR.test(curT)) return false;
          // 継続行の先頭インデントは除去して URL 連続性を判定する
          const nextStripped = nextT.replace(/^\s+/, '');
          if (nextStripped.length === 0) return false;
          if (!URL_HEAD_CHAR.test(nextStripped)) return false;
          // 次行（先頭インデント除去後）に空白が含まれる場合、URL 継続行では
          // なく別項目の行と見なして連結を打ち切る。"- Network:  http://..."
          // のように先頭が URL_HEAD_CHAR（"-"）でも URL の続きではない行を弾く。
          // narrower wrap の URL 継続行は URL 文字のみで空白を含まない前提。
          if (/\s/.test(nextStripped)) return false;

          // (b) auto-wrap が isWrapped を立てない一部ケース
          if (curT.length >= cols - 2) return true;

          // (c) START 行: 行末まで https?://… が伸びている
          if (URL_LINE_TAIL.test(curT)) return true;

          // (d) MIDDLE 行: 先頭インデント除去後に空白が一切なく、遡って START 行に到達できる
          const curStripped = curT.replace(/^\s+/, '');
          if (/\s/.test(curStripped)) return false;
          for (
            let prev = idx - 1;
            prev >= Math.max(0, idx - MAX_BACK);
            prev--
          ) {
            const prevLine = buf.getLine(prev);
            if (!prevLine) return false;
            const prevT = prevLine.translateToString(true);
            if (prevT.length === 0) return false;
            if (URL_LINE_TAIL.test(prevT)) return true;
            const prevStripped = prevT.replace(/^\s+/, '');
            if (/\s/.test(prevStripped)) return false;
          }
          return false;
        };

        const targetY = bufferLineNumber - 1; // 0-based

        // 論理行の先頭行を遡って探す
        let startY = targetY;
        while (
          startY > 0 &&
          startY > targetY - MAX_BACK &&
          continuesToNext(startY - 1)
        ) {
          startY--;
        }

        // 論理行の終端を前方に探す
        let endY = targetY;
        while (
          endY < buf.length - 1 &&
          endY < targetY + MAX_FWD &&
          continuesToNext(endY)
        ) {
          endY++;
        }

        // [startY, endY] の範囲を、各行の末尾空白を除去して連結する。
        // cols 幅でパディングしてしまうと URL 連続文字の間に空白が入って
        // URL_REGEX が分断されるため、パディングなしで結合する。
        // 加えて継続行（startY 以外）は先頭インデントも除去して URL を再構成する。
        // offset→座標は各行の (開始 offset, 取り除いた先頭文字数=xOffset) を保持して
        // マップする。
        const rows: {
          y: number;
          text: string;
          offset: number;
          xOffset: number;
        }[] = [];
        let fullText = '';
        for (let y = startY; y <= endY; y++) {
          const line = buf.getLine(y);
          if (!line) break;
          let text = line.translateToString(false).replace(/\s+$/, '');
          let xOffset = 0;
          if (y > startY) {
            const m = text.match(/^\s+/);
            if (m) {
              xOffset = m[0].length;
              text = text.slice(xOffset);
            }
          }
          rows.push({ y, text, offset: fullText.length, xOffset });
          fullText += text;
        }

        if (rows.length === 0) {
          callback(undefined);
          return;
        }

        const offsetToPos = (offset: number) => {
          for (let i = rows.length - 1; i >= 0; i--) {
            if (offset >= rows[i].offset) {
              return {
                y: rows[i].y + 1,
                x: rows[i].xOffset + (offset - rows[i].offset) + 1,
              };
            }
          }
          return { y: rows[0].y + 1, x: rows[0].xOffset + 1 };
        };

        const links: ILink[] = [];
        URL_REGEX.lastIndex = 0;
        let match: RegExpExecArray | null;
        while ((match = URL_REGEX.exec(fullText)) !== null) {
          const raw = match[0].replace(TRAILING_PUNCTUATION, '');
          if (!raw) continue;
          const startOffset = match.index;
          const endOffset = startOffset + raw.length - 1;
          const start = offsetToPos(startOffset);
          const end = offsetToPos(endOffset);

          // この行に該当するリンクのみ返す（xterm はホバーされた行に対して呼ぶ）
          if (bufferLineNumber < start.y || bufferLineNumber > end.y) continue;

          const url = raw;
          links.push({
            text: url,
            range: { start, end },
            activate: () => {
              window.open(url, '_blank', 'noopener,noreferrer');
            },
          });
        }

        callback(links.length > 0 ? links : undefined);
      },
    });

    // ターミナルをDOMに接続
    terminal.current.open(terminalRef.current);

    // マウスホイールイベントの親への伝播を防止
    terminal.current.attachCustomWheelEventHandler((event: WheelEvent) => {
      event.stopPropagation();
      return true; // xterm.jsに通常のスクロール処理を任せる
    });

    // カスタムキーイベントハンドラ（コピー/ペースト対応）
    terminal.current.attachCustomKeyEventHandler((event) => {
      // Ctrl+C または Cmd+C: 選択テキストがあればコピー
      if (
        (event.ctrlKey || event.metaKey) &&
        event.key === 'c' &&
        event.type === 'keydown'
      ) {
        if (terminal.current?.hasSelection()) {
          const selectedText = terminal.current.getSelection();
          navigator.clipboard.writeText(selectedText);
          // 選択をクリアしない（コピー後も選択を維持する方が自然なUX）
          return false; // デフォルト動作（SIGINT送信）を抑止
        }
        // 選択がなければ通常通りSIGINTを送信（metaKeyの場合は何もしない）
        if (event.metaKey) {
          return false; // macOSのCmd+Cは選択なしでも通さない
        }
      }

      // Ctrl+V または Cmd+V: クリップボードから貼り付け（disableStdinがfalseの場合のみ）
      // ブラウザのネイティブペースト処理に任せて二重ペーストを防ぐ
      if ((event.ctrlKey || event.metaKey) && event.key === 'v') {
        return false; // xterm.jsでの処理をスキップ
      }

      return true; // その他のキーは通常処理
    });

    // IME composition状態を追跡
    const textarea = (terminal.current as TerminalWithTextarea).textarea;
    if (textarea) {
      textarea.addEventListener('compositionstart', () => {
        isComposing.current = true;
      });
      textarea.addEventListener('compositionend', () => {
        isComposing.current = false;
        compositionEndTime.current = Date.now();
      });
    }

    // iOSタッチスクロール対応: CSS設定を追加
    const terminalElement = terminalRef.current.querySelector(
      '.xterm'
    ) as HTMLElement;
    const viewportElement = terminalRef.current.querySelector(
      '.xterm-viewport'
    ) as HTMLElement;
    const screenElement = terminalRef.current.querySelector(
      '.xterm-screen'
    ) as HTMLElement;

    if (terminalElement) {
      // 縦スクロールをネイティブに任せる
      terminalElement.style.touchAction = 'pan-y';
      (
        terminalElement.style as unknown as Record<string, string>
      ).webkitOverflowScrolling = 'touch';
      terminalElement.style.overscrollBehavior = 'contain';

      // スクロール優先：長押し選択を無効化
      if (screenElement) {
        (
          screenElement.style as unknown as Record<string, string>
        ).webkitUserSelect = 'none';
        screenElement.style.userSelect = 'none';
      }
    }

    if (viewportElement) {
      viewportElement.style.touchAction = 'pan-y';
      (
        viewportElement.style as unknown as Record<string, string>
      ).webkitOverflowScrolling = 'touch';
      viewportElement.style.overscrollBehavior = 'contain';
    }

    // xterm.jsのonDataを使ってキー入力を受け取る
    terminal.current.onData((data) => {
      // Focus In/Focus Outイベントをフィルタリング
      // \x1b[I = Focus In, \x1b[O = Focus Out
      if (data === '\x1b[I' || data === '\x1b[O') {
        return; // これらのイベントは送信しない
      }

      // IME変換中のEnterキーは無視（日本語入力の変換確定を誤送信しない）
      if (isComposing.current && data === '\r') {
        return;
      }

      // IME変換確定直後（100ms以内）のESCキーを無視
      // 一部のIMEでは変換確定時にESCキーが送られることがあるため
      const timeSinceCompositionEnd = Date.now() - compositionEndTime.current;
      if (timeSinceCompositionEnd < 100 && data === '\x1b') {
        // ESCキーを無視（IME変換確定直後）
        return;
      }

      // キー入力をコールバックに送信
      if (onKeyInputRef.current) {
        onKeyInputRef.current(data);
      }
    });

    // サイズを自動調整
    setTimeout(() => {
      fitTerminal();

      // 親コンポーネントにターミナルインスタンスと初期サイズを通知
      if (onTerminalReady && terminal.current && fitAddon.current) {
        const initialSize = {
          cols: terminal.current.cols,
          rows: terminal.current.rows,
        };
        onTerminalReady(terminal.current, fitAddon.current, initialSize);
      }
    }, 100);

    if (typeof ResizeObserver !== 'undefined' && terminalRef.current) {
      resizeObserver.current = new ResizeObserver(() => {
        fitTerminal();
      });
      resizeObserver.current.observe(terminalRef.current);
    }

    // フォーカス時にリサイズイベントを送信
    const terminalTextarea = (terminal.current as TerminalWithTextarea)
      .textarea;
    const handleTerminalFocus = () => {
      fitTerminal();
    };
    terminalTextarea?.addEventListener('focus', handleTerminalFocus);

    return () => {
      terminalTextarea?.removeEventListener('focus', handleTerminalFocus);
      if (resizeObserver.current) {
        resizeObserver.current.disconnect();
        resizeObserver.current = null;
      }
      if (linkProviderDisposable.current) {
        linkProviderDisposable.current.dispose();
        linkProviderDisposable.current = null;
      }
      if (terminal.current) {
        terminal.current.dispose();
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ウィンドウサイズ変更時に再調整
  useEffect(() => {
    const handleResize = () => {
      fitTerminal();
    };

    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [fitTerminal]);

  // フォントサイズが変更されたときに動的に更新
  useEffect(() => {
    if (!terminal.current || !fitAddon.current || fontSize === undefined) {
      return;
    }

    // xterm.js のフォントサイズを更新
    terminal.current.options.fontSize = fontSize;

    // レイアウトを再調整
    setTimeout(() => {
      fitAddon.current?.fit();
      if (terminal.current && terminal.current.rows > 0) {
        terminal.current.refresh(0, terminal.current.rows - 1);
      }
    }, 0);
  }, [fontSize]);

  // isActive が true になったときに xterm を再初期化
  useEffect(() => {
    if (
      isActive &&
      terminal.current &&
      fitAddon.current &&
      terminalRef.current
    ) {
      // 少し遅延させて DOM が完全に表示されてからリサイズ
      const timeoutId = setTimeout(() => {
        try {
          fitAddon.current?.fit();
          if (terminal.current && terminal.current.rows > 0) {
            terminal.current.refresh(0, terminal.current.rows - 1);
          }
        } catch {
          // fit() が失敗した場合は無視
        }
      }, 50);
      return () => clearTimeout(timeoutId);
    }
  }, [isActive]);

  // バッファからテキストを取得（isWrapped を考慮して論理行を連結）
  const getVisibleText = useCallback(() => {
    if (!terminal.current) return '';
    const buf = terminal.current.buffer.active;
    let result = '';
    for (let i = 0; i < buf.length; i++) {
      const line = buf.getLine(i);
      if (!line) continue;
      if (i > 0 && !line.isWrapped) {
        result += '\n';
      }
      result += line.translateToString(true);
    }
    return result;
  }, []);

  // 長押しタイマーをキャンセル
  const cancelLongPress = useCallback(() => {
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
    longPressTouchPos.current = null;
  }, []);

  // テキストオーバーレイを閉じる
  const closeTextOverlay = useCallback(() => {
    setShowTextOverlay(false);
    setOverlayText('');
  }, []);

  // マウスダウン位置を記録
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    mouseDownPos.current = { x: e.clientX, y: e.clientY };
  }, []);

  // ターミナルエリアクリックでフォーカスする（disableStdinの場合やドラッグの場合はフォーカスしない）
  const handleTerminalClick = useCallback(
    (e: React.MouseEvent) => {
      // マウスダウン位置と比較して、移動していたらドラッグと判定してフォーカスしない
      if (mouseDownPos.current) {
        const dx = Math.abs(e.clientX - mouseDownPos.current.x);
        const dy = Math.abs(e.clientY - mouseDownPos.current.y);
        const isDrag = dx > 5 || dy > 5; // 5px以上移動したらドラッグ

        if (isDrag) {
          mouseDownPos.current = null;
          return;
        }
      }

      mouseDownPos.current = null;

      if (!disableStdin) {
        focusTerminal();
      }
      if (onClick) {
        onClick();
      }
    },
    [disableStdin, focusTerminal, onClick]
  );

  // 二本指スクロールの開始を検出 & iOS長押し検出
  const handleTouchStart = useCallback(
    (e: React.TouchEvent) => {
      if (e.touches.length === 2) {
        // 二本指タッチを検出
        cancelLongPress();
        isTwoFingerScroll.current = true;
        lastTouchY.current =
          (e.touches[0].clientY + e.touches[1].clientY) / 2;
      } else if (e.touches.length === 1) {
        isTwoFingerScroll.current = false;

        // iOS: 長押し検出開始
        if (isIOS) {
          longPressTouchPos.current = {
            x: e.touches[0].clientX,
            y: e.touches[0].clientY,
          };
          longPressTimer.current = setTimeout(() => {
            const text = getVisibleText();
            setOverlayText(text);
            setShowTextOverlay(true);
            navigator.vibrate?.(10);
          }, 500);
        }
      }
    },
    [isIOS, cancelLongPress, getVisibleText]
  );

  // 二本指スクロールの移動を処理 & 長押しキャンセル
  const handleTouchMove = useCallback((e: React.TouchEvent) => {
    // 1本指の移動で長押しをキャンセル
    if (longPressTouchPos.current && e.touches.length === 1) {
      const dx = Math.abs(
        e.touches[0].clientX - longPressTouchPos.current.x
      );
      const dy = Math.abs(
        e.touches[0].clientY - longPressTouchPos.current.y
      );
      if (dx > 10 || dy > 10) cancelLongPress();
    }

    if (isTwoFingerScroll.current && e.touches.length === 2) {
      // 二本指の中点のY座標を計算
      const currentY = (e.touches[0].clientY + e.touches[1].clientY) / 2;
      const deltaY = lastTouchY.current - currentY;
      lastTouchY.current = currentY;

      // ターミナル要素を直接スクロール
      if (terminalRef.current) {
        const viewportElement = terminalRef.current.querySelector(
          '.xterm-viewport'
        ) as HTMLElement;
        if (viewportElement) {
          viewportElement.scrollTop += deltaY;
        }
      }

      // デフォルト動作を防止
      e.preventDefault();
    }
  }, [cancelLongPress]);

  // 二本指スクロールの終了を検出
  const handleTouchEnd = useCallback(() => {
    cancelLongPress();
    isTwoFingerScroll.current = false;
    isScrollHandleDrag.current = false;
  }, [cancelLongPress]);

  // スクロールハンドルのタッチ開始
  const handleScrollHandleTouchStart = useCallback((e: React.TouchEvent) => {
    e.stopPropagation(); // イベント伝播を止める
    isScrollHandleDrag.current = true;
    scrollHandleStartY.current = e.touches[0].clientY;
  }, []);

  // スクロールハンドルのタッチ移動
  const handleScrollHandleTouchMove = useCallback((e: React.TouchEvent) => {
    if (isScrollHandleDrag.current) {
      e.preventDefault(); // デフォルト動作を防止
      e.stopPropagation();

      const currentY = e.touches[0].clientY;
      const deltaY = currentY - scrollHandleStartY.current;
      scrollHandleStartY.current = currentY;

      // ターミナル要素を直接スクロール
      if (terminalRef.current) {
        const viewportElement = terminalRef.current.querySelector(
          '.xterm-viewport'
        ) as HTMLElement;
        if (viewportElement) {
          viewportElement.scrollTop -= deltaY; // 逆方向にスクロール（自然な動き）
        }
      }
    }
  }, []);

  // スクロールハンドルのタッチ終了
  const handleScrollHandleTouchEnd = useCallback((e: React.TouchEvent) => {
    e.stopPropagation();
    isScrollHandleDrag.current = false;
  }, []);

  return (
    <div className={s.root}>
      <div
        ref={terminalRef}
        className={s.terminalContainer}
        onMouseDown={handleMouseDown}
        onClick={handleTerminalClick}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        style={{
          background: '#0a0a0a', // dark-bg-primary
          overflow: 'auto', // スクロールを有効化
          WebkitOverflowScrolling: 'touch', // iOSの慣性スクロール
          touchAction: 'pan-y', // 縦スクロールをネイティブに任せる
          overscrollBehavior: 'contain', // 親ページへの伝播を抑制
        }}
      />

      {/* スクロールハンドルエリア（右端） */}
      <div
        className={s.scrollHandle}
        onTouchStart={handleScrollHandleTouchStart}
        onTouchMove={handleScrollHandleTouchMove}
        onTouchEnd={handleScrollHandleTouchEnd}
        style={{
          background:
            'linear-gradient(to left, rgba(30, 41, 59, 0.2), transparent)',
          touchAction: 'none', // タッチ操作を完全に制御
          zIndex: 10,
        }}
      >
        {/* スクロールハンドルのビジュアル表示（3つのドット） */}
        <div
          className={s.scrollDots}
          style={{
            pointerEvents: 'none',
          }}
        >
          <div
            style={{
              width: '6px',
              height: '6px',
              background: 'rgba(148, 163, 184, 0.5)',
              borderRadius: '50%',
            }}
          />
          <div
            style={{
              width: '6px',
              height: '6px',
              background: 'rgba(148, 163, 184, 0.5)',
              borderRadius: '50%',
            }}
          />
          <div
            style={{
              width: '6px',
              height: '6px',
              background: 'rgba(148, 163, 184, 0.5)',
              borderRadius: '50%',
            }}
          />
        </div>
      </div>

      {/* iOS長押しテキスト選択オーバーレイ */}
      {showTextOverlay && (
        <div
          className={s.textOverlay}
          style={{
            background: 'rgba(10, 10, 10, 0.95)',
            WebkitUserSelect: 'text',
            userSelect: 'text',
            fontFamily:
              '"JetBrains Mono", "Fira Code", "SF Mono", Monaco, "Cascadia Code", monospace',
            fontSize: terminal.current?.options.fontSize ?? 9,
            lineHeight: '1.2',
            color: '#d1d5db',
            whiteSpace: 'pre',
            padding: '4px',
            WebkitOverflowScrolling: 'touch',
            zIndex: 30,
          }}
        >
          <button
            onClick={closeTextOverlay}
            style={{
              position: 'sticky',
              top: 4,
              float: 'right',
              background: 'rgba(75, 85, 99, 0.8)',
              color: '#e5e7eb',
              border: 'none',
              borderRadius: '50%',
              width: 28,
              height: 28,
              fontSize: 16,
              lineHeight: '28px',
              textAlign: 'center',
              cursor: 'pointer',
              zIndex: 31,
              marginRight: 4,
            }}
            aria-label="閉じる"
          >
            ×
          </button>
          {overlayText}
        </div>
      )}
    </div>
  );
};

export default TerminalOut;
