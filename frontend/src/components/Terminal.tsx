import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Terminal as XTerm } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import type { Terminal, TerminalMessage, TerminalOutputLine } from '../types';
import TerminalOut from './TerminalOut';

interface TerminalProps {
  terminal: Terminal;
  messages: TerminalMessage[];
  history: TerminalOutputLine[];
  isActive: boolean;
  onInput: (terminalId: string, input: string) => void;
  onSignal: (terminalId: string, signal: string) => void;
}

const TerminalComponent: React.FC<TerminalProps> = ({
  terminal,
  messages,
  history,
  isActive,
  onInput,
  onSignal,
}) => {
  const [input, setInput] = useState('');
  const [showKeyboardButtons, setShowKeyboardButtons] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const xtermInstance = useRef<XTerm | null>(null);
  const fitAddon = useRef<FitAddon | null>(null);
  const lastMessageCount = useRef<number>(0);
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

  // ペースト処理（useCallbackでメモ化）
  const handlePaste = useCallback(async () => {
    try {
      // Clipboard APIを使用してクリップボードからテキストを取得
      const text = await navigator.clipboard.readText();
      if (text) {
        // xtermに直接書き込み（表示用）とPTYに送信（実行用）
        onInput(terminal.id, text);
      }
    } catch (error) {
      console.error('クリップボードの読み取りに失敗しました:', error);
      // フォールバック: ブラウザの標準ペースト動作に任せる
    }
  }, [terminal.id, onInput]);

  // キー入力ハンドラ
  const handleKeyInput = useCallback(
    (data: string) => {
      onInput(terminal.id, data);
    },
    [terminal.id, onInput]
  );

  // TerminalOutからターミナルインスタンスを受け取る
  const handleTerminalReady = useCallback(
    (terminalInstance: XTerm, fitAddonInstance: FitAddon) => {
      xtermInstance.current = terminalInstance;
      fitAddon.current = fitAddonInstance;
    },
    []
  );

  // ターミナルが変更された時の処理
  useEffect(() => {
    if (!xtermInstance.current) return;

    // ターミナルが変更された場合、または初回表示の場合、出力をクリアして新しい内容をロード
    if (currentTerminalId.current !== terminal.id) {
      // 出力をクリア
      xtermInstance.current.clear();

      // 履歴をロード
      if (history && history.length > 0) {
        history.forEach((historyLine) => {
          if (historyLine.content) {
            xtermInstance.current?.write(historyLine.content);
          }
        });
      }

      // 現在のメッセージをロード
      const terminalMessages = messages.filter(
        (msg) => msg.terminalId === terminal.id
      );
      terminalMessages.forEach((message) => {
        if (message.type !== 'input') {
          xtermInstance.current?.write(message.data);
        }
      });

      lastMessageCount.current = terminalMessages.length;
      currentTerminalId.current = terminal.id;
      xtermInstance.current.scrollToBottom();
    }
    // 初回表示で履歴が空だった場合、後から履歴が読み込まれた時の対応
    else if (
      currentTerminalId.current === terminal.id &&
      history &&
      history.length > 0
    ) {
      // 既に表示されているコンテンツと履歴を比較して、履歴が新しく追加されていれば表示
      const terminalMessages = messages.filter(
        (msg) => msg.terminalId === terminal.id
      );
      const totalExpectedLines =
        history.length +
        terminalMessages.filter((msg) => msg.type !== 'input').length;

      // 現在の表示内容より履歴が多い場合は再描画
      if (totalExpectedLines > lastMessageCount.current) {
        // 出力をクリア
        xtermInstance.current.clear();

        // 履歴をロード
        history.forEach((historyLine) => {
          if (historyLine.content) {
            xtermInstance.current?.write(historyLine.content);
          }
        });

        // 現在のメッセージをロード
        terminalMessages.forEach((message) => {
          if (message.type !== 'input') {
            xtermInstance.current?.write(message.data);
          }
        });

        lastMessageCount.current = terminalMessages.length;
        xtermInstance.current.scrollToBottom();
      }
    }
  }, [terminal.id, history, messages]);

  // 新しいメッセージが追加されたらXTermに書き込み
  useEffect(() => {
    if (!xtermInstance.current || currentTerminalId.current !== terminal.id)
      return;

    const terminalMessages = messages.filter(
      (msg) => msg.terminalId === terminal.id
    );
    const newMessages = terminalMessages.slice(lastMessageCount.current);

    // 新しいメッセージがある場合のみ処理
    if (newMessages.length > 0) {
      newMessages.forEach((message) => {
        if (message.type === 'input') return; // 入力メッセージは表示しない

        // ANSIエスケープシーケンスをそのまま出力（XTermが処理）
        xtermInstance.current?.write(message.data);
      });

      lastMessageCount.current = terminalMessages.length;

      // 最下部にスクロール
      xtermInstance.current.scrollToBottom();
    }
  }, [messages]);


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
    <div className="h-full flex flex-col">
      {/* ターミナルヘッダー */}
      <div className="bg-dark-bg-tertiary px-2 sm:px-3 py-2 flex items-center justify-between border-b border-dark-border-DEFAULT">
        <div className="flex items-center space-x-1 sm:space-x-2 min-w-0">
          <div
            className={`w-2 h-2 rounded-full flex-shrink-0 ${
              terminal.status === 'active'
                ? 'bg-dark-accent-green'
                : terminal.status === 'exited'
                  ? 'bg-dark-accent-red'
                  : 'bg-dark-accent-orange'
            }`}
          ></div>
          <span className="text-gray-300 text-xs truncate">
            {terminal.name}
          </span>
          <span className="text-gray-500 text-xs truncate hidden sm:inline">
            ({terminal.cwd})
          </span>
          {terminal.pid && (
            <span className="text-gray-500 text-xs hidden sm:inline">
              PID: {terminal.pid}
            </span>
          )}
        </div>

        <div className="flex items-center space-x-1 sm:space-x-2">
          {/* Ctrl+Cボタン（常時表示） */}
          <button
            onClick={handleCtrlC}
            className="px-2 py-1 text-xs bg-dark-bg-secondary hover:bg-dark-bg-hover text-white rounded-lg border border-gray-500 hover:border-gray-400 transition-all duration-150 shadow-sm"
            title="Ctrl+C"
          >
            Ctrl+C
          </button>

          {/* ESCボタン（常時表示） */}
          <button
            onClick={handleEscKey}
            className="px-2 py-1 text-xs bg-dark-bg-secondary hover:bg-dark-bg-hover text-dark-text-primary rounded-lg border border-gray-500 hover:border-gray-400 transition-all duration-150 shadow-sm"
            title="ESC"
          >
            ESC
          </button>

          {/* ペーストボタン（モバイル・iOS向け） */}
          <button
            onClick={handlePaste}
            className="px-2 py-1 text-xs bg-dark-bg-secondary hover:bg-dark-bg-hover text-dark-text-primary rounded-lg border border-gray-500 hover:border-gray-400 transition-all duration-150 shadow-sm"
            title="ペースト (Ctrl+V)"
          >
            📋
          </button>

          {/* キーボードボタン表示切替 */}
          <button
            onClick={() => setShowKeyboardButtons(!showKeyboardButtons)}
            className="px-2 py-1 text-xs bg-dark-bg-secondary hover:bg-dark-bg-hover text-dark-text-primary rounded-lg border border-gray-500 hover:border-gray-400 transition-all duration-150 shadow-sm"
            title="キーボードボタンの表示/非表示"
          >
            ⌨️
          </button>
        </div>
      </div>

      {/* キーボードボタンパネル（iOS向け） */}
      {showKeyboardButtons && (
        <div className="bg-dark-bg-secondary px-2 py-2 border-b border-dark-border-DEFAULT">
          <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:gap-2">
            {/* 矢印キー */}
            <div className="flex space-x-1">
              <button
                onClick={() => handleArrowKey('up')}
                className="px-2 py-1 text-xs bg-dark-bg-tertiary hover:bg-dark-bg-hover text-dark-text-primary rounded-lg border border-gray-500 hover:border-gray-400 transition-all duration-150 shadow-sm"
                title="↑"
              >
                ↑
              </button>
              <button
                onClick={() => handleArrowKey('down')}
                className="px-2 py-1 text-xs bg-dark-bg-tertiary hover:bg-dark-bg-hover text-dark-text-primary rounded-lg border border-gray-500 hover:border-gray-400 transition-all duration-150 shadow-sm"
                title="↓"
              >
                ↓
              </button>
              <button
                onClick={() => handleArrowKey('left')}
                className="px-2 py-1 text-xs bg-dark-bg-tertiary hover:bg-dark-bg-hover text-dark-text-primary rounded-lg border border-gray-500 hover:border-gray-400 transition-all duration-150 shadow-sm"
                title="←"
              >
                ←
              </button>
              <button
                onClick={() => handleArrowKey('right')}
                className="px-2 py-1 text-xs bg-dark-bg-tertiary hover:bg-dark-bg-hover text-dark-text-primary rounded-lg border border-gray-500 hover:border-gray-400 transition-all duration-150 shadow-sm"
                title="→"
              >
                →
              </button>
            </div>

            {/* 特殊キー */}
            <div className="flex space-x-1">
              <button
                onClick={handleTabKey}
                className="px-2 py-1 text-xs bg-dark-bg-tertiary hover:bg-dark-bg-hover text-dark-text-primary rounded-lg border border-gray-500 hover:border-gray-400 transition-all duration-150 shadow-sm"
                title="Tab"
              >
                Tab
              </button>
              <button
                onClick={handleEnterKey}
                className="px-2 py-1 text-xs bg-dark-bg-tertiary hover:bg-dark-bg-hover text-dark-text-primary rounded-lg border border-gray-500 hover:border-gray-400 transition-all duration-150 shadow-sm"
                title="Enter"
              >
                Enter
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ターミナルメイン表示 */}
      <div className="flex-1 min-h-0 bg-dark-bg-primary overflow-auto relative">
        <TerminalOut
          onKeyInput={handleKeyInput}
          isActive={isActive}
          onTerminalReady={handleTerminalReady}
          cursorBlink={false}
          scrollOnUserInput={true}
        />
      </div>

      {/* 入力フィールド（フォールバック用、通常はXTermの直接入力を使用） */}
      <div className="bg-dark-bg-tertiary px-2 sm:px-3 py-2 border-t border-dark-border-DEFAULT">
        <form onSubmit={handleSubmit} className="flex space-x-2">
          <input
            ref={inputRef}
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            className="flex-1 bg-dark-bg-secondary text-white px-2 py-1 rounded-lg border border-dark-border-light text-xs focus:outline-none focus:ring-1 focus:ring-dark-accent-blue hover:border-dark-border-focus transition-all duration-150"
            placeholder="コマンド入力（フォールバック用）"
          />
          <button
            type="submit"
            className="px-3 py-1 bg-dark-accent-blue hover:bg-dark-accent-blue-hover text-white rounded-lg text-xs transition-all duration-150 shadow-sm"
          >
            送信
          </button>
        </form>
      </div>
    </div>
  );
};

export default TerminalComponent;
