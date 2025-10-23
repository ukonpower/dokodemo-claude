import React, { useEffect, useRef, useCallback } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
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
   * アクティブかどうか（フォーカス制御用）
   */
  isActive?: boolean;

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
  isActive = false,
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
    if (!terminal.current) {
      return;
    }
    terminal.current.focus();
    const textarea = (terminal.current as TerminalWithTextarea).textarea;
    textarea?.focus?.();
  }, []);

  const fitTerminal = useCallback(() => {
    if (!fitAddon.current || !terminal.current) {
      return;
    }
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
  }, [onResize]);

  // ターミナルを初期化
  useEffect(() => {
    if (!terminalRef.current) return;

    // FitAddonを作成
    fitAddon.current = new FitAddon();

    // フォントサイズを決定（カスタム指定がなければ画面サイズで自動設定）
    const isLargeScreen = window.innerWidth >= 1024; // lg breakpoint
    const finalFontSize = fontSize ?? (isLargeScreen ? 10 : 8);

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

    // ターミナルをDOMに接続
    terminal.current.open(terminalRef.current);

    // xterm.jsのonDataを使ってキー入力を受け取る
    terminal.current.onData((data) => {
      // キー入力をコールバックに送信
      if (onKeyInputRef.current) {
        onKeyInputRef.current(data);
      }
    });

    // サイズを自動調整してフォーカス
    setTimeout(() => {
      fitTerminal();
      // アクティブな場合はフォーカスを当てる
      if (isActive) {
        focusTerminal();
      }

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

  // アクティブ状態が変更されたらフォーカスを当てる
  useEffect(() => {
    if (isActive && terminal.current) {
      fitTerminal();
      focusTerminal();
    }
  }, [isActive, focusTerminal, fitTerminal]);

  // ターミナルエリアクリックでフォーカスする
  const handleTerminalClick = useCallback(() => {
    focusTerminal();
    if (onClick) {
      onClick();
    }
  }, [focusTerminal, onClick]);

  return (
    <div
      ref={terminalRef}
      className="h-full w-full bg-dark-bg-primary"
      onClick={handleTerminalClick}
      style={{
        background: '#0a0a0a', // dark-bg-primary
      }}
    />
  );
};

export default TerminalOut;
