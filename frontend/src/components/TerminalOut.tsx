import React, { useEffect, useRef, useCallback } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import '@xterm/xterm/css/xterm.css';

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
}) => {
  const terminalRef = useRef<HTMLDivElement>(null);
  const terminal = useRef<Terminal | null>(null);
  const fitAddon = useRef<FitAddon | null>(null);
  const resizeObserver = useRef<ResizeObserver | null>(null);
  const onKeyInputRef = useRef<typeof onKeyInput>(onKeyInput);
  const mouseDownPos = useRef<{ x: number; y: number } | null>(null);

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
    const isLargeScreen = window.innerWidth >= 1024; // lg breakpoint
    const finalFontSize = fontSize ?? (isLargeScreen ? 10 : 8);

    // iOS環境の検出
    const isIOS = /iPhone|iPad|iPod/.test(navigator.userAgent) ||
                  (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

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
        '"Fira Code", "SF Mono", Monaco, Inconsolata, "Roboto Mono", "Source Code Pro", monospace',
      fontSize: finalFontSize,
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
      scrollSensitivity: 3,
      // 横スクロール対応の設定
      cols: 600, // 適度な列数を設定
      allowProposedApi: true, // 横スクロール機能に必要
    });

    // FitAddonを読み込み
    terminal.current.loadAddon(fitAddon.current);

    // WebLinksAddonを読み込み（リンク処理を有効化）
    const webLinksAddon = new WebLinksAddon((event, uri) => {
      // iOS環境では修飾キー不要でタップのみでリンクを開く
      // デスクトップ環境ではCtrl（macOSではCmd）キーが必要
      if (isIOS || event.ctrlKey || event.metaKey) {
        window.open(uri, '_blank', 'noopener,noreferrer');
      }
    });
    terminal.current.loadAddon(webLinksAddon);

    // ターミナルをDOMに接続
    terminal.current.open(terminalRef.current);

    // iOSタッチスクロール対応: CSS設定を追加
    const terminalElement = terminalRef.current.querySelector('.xterm') as HTMLElement;
    const viewportElement = terminalRef.current.querySelector('.xterm-viewport') as HTMLElement;
    const screenElement = terminalRef.current.querySelector('.xterm-screen') as HTMLElement;

    if (terminalElement) {
      // 縦スクロールをネイティブに任せる
      terminalElement.style.touchAction = 'pan-y';
      (terminalElement.style as unknown as Record<string, string>).webkitOverflowScrolling = 'touch';
      terminalElement.style.overscrollBehavior = 'contain';

      // スクロール優先：長押し選択を無効化
      if (screenElement) {
        (screenElement.style as unknown as Record<string, string>).webkitUserSelect = 'none';
        screenElement.style.userSelect = 'none';
      }
    }

    if (viewportElement) {
      viewportElement.style.touchAction = 'pan-y';
      (viewportElement.style as unknown as Record<string, string>).webkitOverflowScrolling = 'touch';
      viewportElement.style.overscrollBehavior = 'contain';
    }

    // xterm.jsのonDataを使ってキー入力を受け取る
    terminal.current.onData((data) => {
      // Focus In/Focus Outイベントをフィルタリング
      // \x1b[I = Focus In, \x1b[O = Focus Out
      if (data === '\x1b[I' || data === '\x1b[O') {
        return; // これらのイベントは送信しない
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

    return () => {
      if (resizeObserver.current) {
        resizeObserver.current.disconnect();
        resizeObserver.current = null;
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

  // マウスダウン位置を記録
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    mouseDownPos.current = { x: e.clientX, y: e.clientY };
  }, []);

  // ターミナルエリアクリックでフォーカスする（disableStdinの場合やドラッグの場合はフォーカスしない）
  const handleTerminalClick = useCallback((e: React.MouseEvent) => {
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
  }, [disableStdin, focusTerminal, onClick]);

  return (
    <div
      ref={terminalRef}
      className="h-full w-full bg-dark-bg-primary"
      onMouseDown={handleMouseDown}
      onClick={handleTerminalClick}
      style={{
        background: '#0a0a0a', // dark-bg-primary
        overflow: 'auto', // スクロールを有効化
        WebkitOverflowScrolling: 'touch', // iOSの慣性スクロール
        touchAction: 'pan-y', // 縦スクロールをネイティブに任せる
        overscrollBehavior: 'contain', // 親ページへの伝播を抑制
      }}
    />
  );
};

export default TerminalOut;
