import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Terminal as XTerm } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { ArrowDown, Maximize2, X } from 'lucide-react';
import type { Terminal, TerminalMessage, TerminalOutputLine } from '../types';
import TerminalOut from './TerminalOut';
import s from './Terminal.module.scss';

interface TerminalProps {
  terminal: Terminal;
  messages: TerminalMessage[];
  history: TerminalOutputLine[];
  isActive?: boolean;
  onInput: (terminalId: string, input: string) => void;
  onSignal: (terminalId: string, signal: string) => void;
  onResize?: (terminalId: string, cols: number, rows: number) => void;
  /** カスタムフォントサイズ */
  fontSize?: number;
}

const TerminalComponent: React.FC<TerminalProps> = ({
  terminal,
  messages,
  history,
  isActive,
  onInput,
  onSignal,
  onResize,
  fontSize,
}) => {
  const [input, setInput] = useState('');
  const [isFullscreen, setIsFullscreen] = useState<boolean>(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const xtermInstance = useRef<XTerm | null>(null);
  const fitAddon = useRef<FitAddon | null>(null);
  // ターミナルIDごとの処理済みメッセージ数を管理（シーケンスベース重複排除）
  const processedMessageCount = useRef<Map<string, number>>(new Map());
  const historyLengthByTerminal = useRef<Map<string, number>>(new Map());
  const currentTerminalId = useRef<string>('');

  // 矢印キーハンドラ
  const handleArrowKey = (direction: 'up' | 'down' | 'left' | 'right') => {
    const arrowKeys = {
      up: '\x1b[A',
      down: '\x1b[B',
      right: '\x1b[C',
      left: '\x1b[D',
    };
    onInput(terminal.id, arrowKeys[direction]);
  };

  // タブキー送信
  const handleTabKey = () => {
    onInput(terminal.id, '\t');
  };

  // Ctrl+C送信
  const handleCtrlC = () => {
    onSignal(terminal.id, 'SIGINT');
  };

  // ESCキー送信
  const handleEscKey = () => {
    onInput(terminal.id, '\x1b');
  };

  // Enterキー送信
  const handleEnterKey = () => {
    onInput(terminal.id, '\r');
  };

  // 一番下までスクロール
  const scrollToBottom = () => {
    if (xtermInstance.current) {
      // 確実にスクロールするために、少し遅延させて実行
      requestAnimationFrame(() => {
        if (xtermInstance.current && xtermInstance.current.buffer) {
          // バッファの一番下の行番号を取得してスクロール
          const buffer = xtermInstance.current.buffer.active;
          const scrollToLine = buffer.baseY + buffer.length;
          xtermInstance.current.scrollToLine(scrollToLine);
        }
      });
    }
  };

  // キー入力ハンドラ
  const handleKeyInput = useCallback(
    (data: string) => {
      onInput(terminal.id, data);
    },
    [terminal.id, onInput]
  );

  // ESCキーで全画面解除
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

  // 全画面切替時にターミナルをリサイズ
  useEffect(() => {
    if (fitAddon.current) {
      setTimeout(() => {
        fitAddon.current?.fit();
      }, 50);
    }
  }, [isFullscreen]);

  // TerminalOutからのリサイズコールバック
  const handleTerminalOutResize = useCallback(
    (cols: number, rows: number) => {
      if (onResize) {
        onResize(terminal.id, cols, rows);
      }
    },
    [terminal.id, onResize]
  );

  // TerminalOutからターミナルインスタンスを受け取る
  const handleTerminalReady = useCallback(
    (
      terminalInstance: XTerm,
      fitAddonInstance: FitAddon,
      initialSize?: { cols: number; rows: number }
    ) => {
      xtermInstance.current = terminalInstance;
      fitAddon.current = fitAddonInstance;

      // 初期サイズをバックエンドに通知
      if (initialSize && onResize) {
        onResize(terminal.id, initialSize.cols, initialSize.rows);
      }

      // ターミナルのリサイズイベントをリッスン
      if (onResize) {
        terminalInstance.onResize(({ cols, rows }) => {
          onResize(terminal.id, cols, rows);
        });
      }
    },
    [terminal.id, onResize]
  );

  // アクティブになった時にxtermをリフレッシュ
  useEffect(() => {
    if (isActive && xtermInstance.current && fitAddon.current) {
      // 少し遅延させて、DOMが完全に表示された後にリフレッシュ
      requestAnimationFrame(() => {
        fitAddon.current?.fit();
        xtermInstance.current?.refresh(0, xtermInstance.current.rows - 1);
        scrollToBottom();
      });
    }
  }, [isActive]);

  // ターミナル変更と新メッセージ処理を統合（競合状態防止）
  useEffect(() => {
    if (!xtermInstance.current) return;

    const terminalId = terminal.id;
    const isTerminalChanged = currentTerminalId.current !== terminalId;

    // ターミナルが変更された場合、出力をクリアして新しい内容をロード
    if (isTerminalChanged) {
      xtermInstance.current.clear();
      currentTerminalId.current = terminalId;

      // 履歴を一括結合
      const historyData = (history || [])
        .filter((line) => line.content)
        .map((line) => line.content)
        .join('');

      // 現在のメッセージを取得して一括結合
      const terminalMessages = messages.filter(
        (msg) => msg.terminalId === terminalId
      );
      const messageData = terminalMessages
        .filter((msg) => msg.type !== 'input')
        .map((msg) => msg.data)
        .join('');

      // 処理済みメッセージ数を更新
      processedMessageCount.current.set(terminalId, terminalMessages.length);
      historyLengthByTerminal.current.set(terminalId, history?.length || 0);

      // 一括書き込みとコールバックでスクロール
      const allData = historyData + messageData;
      if (allData) {
        xtermInstance.current?.write(allData, () => {
          scrollToBottom();
        });
      }
      return;
    }

    // 同じターミナルでの処理
    const currentHistoryLength = history?.length || 0;
    const lastHistoryLength =
      historyLengthByTerminal.current.get(terminalId) || 0;

    // 履歴が新しく到着した場合（長さが変わった場合）
    if (currentHistoryLength > 0 && currentHistoryLength !== lastHistoryLength) {
      xtermInstance.current.clear();

      // 履歴を一括結合
      const historyData = history
        .filter((line) => line.content)
        .map((line) => line.content)
        .join('');

      // 現在のメッセージを取得して一括結合
      const terminalMessages = messages.filter(
        (msg) => msg.terminalId === terminalId
      );
      const messageData = terminalMessages
        .filter((msg) => msg.type !== 'input')
        .map((msg) => msg.data)
        .join('');

      processedMessageCount.current.set(terminalId, terminalMessages.length);
      historyLengthByTerminal.current.set(terminalId, currentHistoryLength);

      // 一括書き込みとコールバックでスクロール
      const allData = historyData + messageData;
      if (allData) {
        xtermInstance.current?.write(allData, () => {
          scrollToBottom();
        });
      }
      return;
    }

    // 新しいメッセージの追加処理（シーケンスベース）
    const terminalMessages = messages.filter(
      (msg) => msg.terminalId === terminalId
    );
    const lastCount = processedMessageCount.current.get(terminalId) || 0;

    // クリーンアップにより配列が縮小した場合を検出して再同期
    if (terminalMessages.length < lastCount) {
      processedMessageCount.current.set(terminalId, terminalMessages.length);
      return;
    }

    const newMessages = terminalMessages.slice(lastCount);

    if (newMessages.length > 0) {
      const combinedData = newMessages
        .filter((msg) => msg.type !== 'input')
        .map((msg) => msg.data)
        .join('');

      processedMessageCount.current.set(terminalId, terminalMessages.length);

      if (combinedData) {
        xtermInstance.current?.write(combinedData, () => {
          scrollToBottom();
        });
      }
    }
  }, [terminal.id, history, messages]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (input.trim()) {
      onInput(terminal.id, input + '\n');
      setInput('');
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.ctrlKey) {
      if (e.key === 'c') {
        e.preventDefault();
        onSignal(terminal.id, 'SIGINT');
      }
    } else if (e.key === 'Escape') {
      e.preventDefault();
      onSignal(terminal.id, 'ESC');
    }
  };

  return (
    <div className={s.root}>
      {/* ターミナルヘッダー */}
      <div className={s.header}>
        {/* ターミナル情報 */}
        <div className={s.headerInfo}>
          <div className={s.terminalInfo}>
            <div
              className={`${s.statusDot} ${
                terminal.status === 'active'
                  ? s.active
                  : terminal.status === 'exited'
                    ? s.exited
                    : s.other
              }`}
            ></div>
            <span className={s.terminalName}>
              {terminal.name}
            </span>
            <span className={s.terminalCwd}>
              ({terminal.cwd})
            </span>
            {terminal.pid && (
              <span className={s.terminalPid}>
                PID: {terminal.pid}
              </span>
            )}
          </div>

          {/* スクロールダウンボタン */}
          <div className={s.headerButtons}>
            <button
              onClick={scrollToBottom}
              className={s.iconButton}
              title="一番下までスクロール"
            >
              <ArrowDown size={14} />
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

      {/* ターミナルメイン表示 */}
      <div className={s.terminalMain}>
        <TerminalOut
          onKeyInput={handleKeyInput}
          onTerminalReady={handleTerminalReady}
          onResize={handleTerminalOutResize}
          cursorBlink={false}
          scrollOnUserInput={true}
          fontSize={fontSize}
          isActive={isActive}
        />
      </div>

      {/* キーボードコントロール */}
      <div className={s.keyboardControls}>
        <div className={s.controlsInner}>
          {/* 左グループ: 矢印キー + Enter */}
          <div className={s.arrowGroup}>
            {/* 矢印十字 */}
            <div className={s.arrowGrid}>
              <div></div>
              <button onClick={() => handleArrowKey('up')} className={s.arrowKey} title="↑">↑</button>
              <div></div>
              <button onClick={() => handleArrowKey('left')} className={s.arrowKey} title="←">←</button>
              <button onClick={() => handleArrowKey('down')} className={s.arrowKey} title="↓">↓</button>
              <button onClick={() => handleArrowKey('right')} className={s.arrowKey} title="→">→</button>
            </div>
            {/* Enter: 矢印2段分の高さ */}
            <button onClick={handleEnterKey} className={s.enterKey} title="Enter">Enter</button>
          </div>

          {/* 区切り線 */}
          <div className={s.divider}></div>

          {/* 右グループ: Tab / Esc / Ctrl+C */}
          <div className={s.rightGroup}>
            <div className={s.rightTopRow}>
              <button onClick={handleTabKey} className={s.funcKey} title="Tab">Tab</button>
              <button onClick={handleEscKey} className={`${s.funcKey} ${s.escKey}`} title="ESC">Esc</button>
            </div>
            <button onClick={handleCtrlC} className={s.ctrlCKey} title="Ctrl+C">Ctrl+C</button>
          </div>
        </div>
      </div>

      {/* 入力フィールド（フォールバック用、通常はXTermの直接入力を使用） */}
      <div className={s.inputArea}>
        <form onSubmit={handleSubmit} className={s.inputForm}>
          <input
            ref={inputRef}
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            className={s.textInput}
            placeholder="コマンド入力（フォールバック用）"
          />
          <button type="submit" className={s.submitButton}>
            送信
          </button>
        </form>
      </div>

      {/* 全画面オーバーレイ */}
      {isFullscreen && (
        <div className={s.fullscreenOverlay}>
          {/* 全画面ヘッダー */}
          <div className={s.fullscreenHeader}>
            <div className={s.fullscreenHeaderLeft}>
              <div
                className={`${s.statusDot} ${
                  terminal.status === 'active'
                    ? s.active
                    : terminal.status === 'exited'
                      ? s.exited
                      : s.other
                }`}
              ></div>
              <span className={s.fullscreenLabel}>
                {terminal.name} - 全画面表示
              </span>
              <span className={s.fullscreenCwd}>({terminal.cwd})</span>
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
              onKeyInput={handleKeyInput}
              onTerminalReady={handleTerminalReady}
              onResize={handleTerminalOutResize}
              cursorBlink={false}
              scrollOnUserInput={true}
              fontSize={fontSize}
              isActive={isActive}
            />
          </div>

          {/* キーボードコントロール */}
          <div className={s.keyboardControls}>
            <div className={s.controlsInner}>
              {/* 左グループ: 矢印キー + Enter */}
              <div className={s.arrowGroup}>
                {/* 矢印十字 */}
                <div className={s.arrowGrid}>
                  <div></div>
                  <button onClick={() => handleArrowKey('up')} className={s.arrowKey} title="↑">↑</button>
                  <div></div>
                  <button onClick={() => handleArrowKey('left')} className={s.arrowKey} title="←">←</button>
                  <button onClick={() => handleArrowKey('down')} className={s.arrowKey} title="↓">↓</button>
                  <button onClick={() => handleArrowKey('right')} className={s.arrowKey} title="→">→</button>
                </div>
                {/* Enter: 矢印2段分の高さ */}
                <button onClick={handleEnterKey} className={s.enterKey} title="Enter">Enter</button>
              </div>

              {/* 区切り線 */}
              <div className={s.divider}></div>

              {/* 右グループ: Tab / Esc / Ctrl+C */}
              <div className={s.rightGroup}>
                <div className={s.rightTopRow}>
                  <button onClick={handleTabKey} className={s.funcKey} title="Tab">Tab</button>
                  <button onClick={handleEscKey} className={`${s.funcKey} ${s.escKey}`} title="ESC">Esc</button>
                </div>
                <button onClick={handleCtrlC} className={s.ctrlCKey} title="Ctrl+C">Ctrl+C</button>
              </div>

              {/* 区切り線 */}
              <div className={s.divider}></div>

              {/* スクロールボタン */}
              <button onClick={scrollToBottom} className={s.fullscreenScrollButton} title="一番下までスクロール">
                <ArrowDown size={12} />
                Scroll
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default TerminalComponent;
