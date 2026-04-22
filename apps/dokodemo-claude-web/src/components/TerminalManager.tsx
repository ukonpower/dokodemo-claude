import React, { useState, useEffect } from 'react';
import type {
  Terminal,
  TerminalMessage,
  TerminalOutputLine,
  CommandShortcut,
} from '../types';
import TerminalComponent from './Terminal';
import s from './TerminalManager.module.scss';

interface TerminalManagerProps {
  terminals: Terminal[];
  messages: TerminalMessage[];
  histories: Map<string, TerminalOutputLine[]>;
  shortcuts: CommandShortcut[];
  currentRepo: string;
  isConnected: boolean;
  isTerminalsLoaded: boolean;
  onCreateTerminal: (cwd: string, name?: string) => void;
  onTerminalInput: (terminalId: string, input: string) => void;
  onTerminalSignal: (terminalId: string, signal: string) => void;
  onTerminalResize: (terminalId: string, cols: number, rows: number) => void;
  onCloseTerminal: (terminalId: string) => void;
  onCreateShortcut: (name: string, command: string) => void;
  onDeleteShortcut: (shortcutId: string) => void;
  onExecuteShortcut: (shortcutId: string, terminalId: string) => void;
  onActiveTerminalChange?: (terminalId: string) => void;
  /** カスタムフォントサイズ */
  fontSize?: number;
}

const TerminalManager: React.FC<TerminalManagerProps> = ({
  terminals,
  messages,
  histories,
  shortcuts,
  currentRepo,
  isConnected,
  // isTerminalsLoaded は使用されていないため受け取らない
  onCreateTerminal,
  onTerminalInput,
  onTerminalSignal,
  onTerminalResize,
  onCloseTerminal,
  onCreateShortcut,
  onDeleteShortcut,
  onExecuteShortcut,
  onActiveTerminalChange,
  fontSize,
}) => {
  const [activeTerminalId, setActiveTerminalId] = useState<string>('');
  const [showCreateShortcut, setShowCreateShortcut] = useState(false);
  const [shortcutName, setShortcutName] = useState('');
  const [shortcutCommand, setShortcutCommand] = useState('');
  const [previousTerminalCount, setPreviousTerminalCount] = useState(0);

  // activeTerminalIdを更新し、親コンポーネントに通知する関数
  const updateActiveTerminalId = (newId: string) => {
    setActiveTerminalId(newId);
    if (onActiveTerminalChange) {
      onActiveTerminalChange(newId);
    }
  };

  // 最初のターミナルを自動的にアクティブにする
  useEffect(() => {
    if (terminals.length > 0 && !activeTerminalId) {
      updateActiveTerminalId(terminals[0].id);
    }
  }, [terminals, activeTerminalId]);

  // 新しいターミナルが作成された時に自動的にアクティブにする
  useEffect(() => {
    // ターミナル数が増えた場合のみ最新のターミナルをアクティブにする
    if (terminals.length > previousTerminalCount && terminals.length > 0) {
      const latestTerminal = terminals[terminals.length - 1];
      updateActiveTerminalId(latestTerminal.id);
    }
    // ターミナル数を更新
    setPreviousTerminalCount(terminals.length);
  }, [terminals, previousTerminalCount]);

  // アクティブなターミナルが削除された場合の処理
  useEffect(() => {
    if (activeTerminalId && !terminals.find((t) => t.id === activeTerminalId)) {
      const newActiveId = terminals.length > 0 ? terminals[0].id : '';
      updateActiveTerminalId(newActiveId);
    }
  }, [terminals, activeTerminalId]);

  const handleCreateTerminal = () => {
    if (!currentRepo) {
      return;
    }
    const terminalName = `Terminal ${terminals.length + 1}`;
    onCreateTerminal(currentRepo, terminalName);
  };

  const handleCreateShortcut = () => {
    if (!shortcutCommand.trim()) {
      return;
    }
    onCreateShortcut(shortcutName, shortcutCommand.trim());
    setShortcutName('');
    setShortcutCommand('');
    setShowCreateShortcut(false);
  };

  const handleExecuteShortcut = (shortcutId: string) => {
    if (!activeTerminalId) {
      return;
    }
    onExecuteShortcut(shortcutId, activeTerminalId);
  };

  return (
    <div className={s.root}>
      {/* ターミナルタブ（ターミナルがある場合のみ表示） */}
      {terminals.length > 0 && (
        <div className={s.tabBar}>
          {terminals.map((terminal) => (
            <div
              key={terminal.id}
              className={`${s.tab} ${activeTerminalId === terminal.id ? s.active : ''}`}
              onClick={() => updateActiveTerminalId(terminal.id)}
            >
              <div
                className={`${s.tabDot} ${
                  terminal.status === 'active'
                    ? s.active
                    : terminal.status === 'exited'
                      ? s.exited
                      : s.other
                }`}
              ></div>
              <span className={s.tabName}>
                {terminal.name}
              </span>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onCloseTerminal(terminal.id);
                }}
                className={s.tabClose}
              >
                ×
              </button>
            </div>
          ))}

          {/* 新しいターミナル作成ボタン */}
          <button
            onClick={handleCreateTerminal}
            disabled={!isConnected || !currentRepo}
            className={s.newTerminalButton}
          >
            <span>+</span>
            <span className={s.newTerminalLabel}>新規</span>
          </button>
        </div>
      )}

      {/* ターミナル本体 */}
      <div className={s.terminalBody}>
        <div className={s.terminalContentArea}>
          {terminals.length === 0 ? (
            <div className={s.emptyState}>
              <button
                onClick={handleCreateTerminal}
                disabled={!isConnected || !currentRepo}
                className={s.createTerminalButton}
              >
                <span className={s.createTerminalPrompt}>$</span>
                <span>ターミナルを作成</span>
              </button>
            </div>
          ) : (
            terminals.map((terminal) => (
              <div
                key={terminal.id}
                className={s.terminalPane}
                style={{
                  display: activeTerminalId === terminal.id ? 'block' : 'none',
                }}
              >
                <TerminalComponent
                  terminal={terminal}
                  messages={messages}
                  history={histories.get(terminal.id) || []}
                  isActive={activeTerminalId === terminal.id}
                  onInput={onTerminalInput}
                  onSignal={onTerminalSignal}
                  onResize={onTerminalResize}
                  fontSize={fontSize}
                />
              </div>
            ))
          )}
        </div>

        {/* コマンドショートカットセクション */}
        {terminals.length > 0 && (
          <div className={s.shortcutsSection}>
            <div className={s.shortcutsHeader}>
              <div className={s.shortcutsHeaderInner}>
                <h3 className={s.shortcutsTitle}>
                  <svg
                    className={s.shortcutsIcon}
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M13 10V3L4 14h7v7l9-11h-7z"
                    />
                  </svg>
                  コマンドショートカット
                </h3>
                <button
                  onClick={() => setShowCreateShortcut(!showCreateShortcut)}
                  disabled={!isConnected || !currentRepo || !activeTerminalId}
                  className={s.addShortcutButton}
                >
                  <span>+</span>
                  <span className={s.addShortcutLabel}>追加</span>
                </button>
              </div>
            </div>

            <div className={s.shortcutsContent}>
              {/* ショートカット作成フォーム */}
              {showCreateShortcut && (
                <div className={s.shortcutForm}>
                  <div className={s.shortcutFormInner}>
                    <input
                      type="text"
                      placeholder="ショートカット名（省略可）"
                      value={shortcutName}
                      onChange={(e) => setShortcutName(e.target.value)}
                      className={s.shortcutInput}
                    />
                    <input
                      type="text"
                      placeholder="コマンド (例: npm run dev)"
                      value={shortcutCommand}
                      onChange={(e) => setShortcutCommand(e.target.value)}
                      className={s.shortcutInput}
                    />
                    <div className={s.shortcutFormButtons}>
                      <button
                        onClick={handleCreateShortcut}
                        disabled={!shortcutCommand.trim()}
                        className={s.shortcutCreateButton}
                      >
                        作成
                      </button>
                      <button
                        onClick={() => {
                          setShowCreateShortcut(false);
                          setShortcutName('');
                          setShortcutCommand('');
                        }}
                        className={s.shortcutCancelButton}
                      >
                        キャンセル
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {/* ショートカットボタン一覧 */}
              {shortcuts.length > 0 ? (
                <div className={s.shortcutsList}>
                  {shortcuts.map((shortcut) => (
                    <div
                      key={shortcut.id}
                      className={s.shortcutItem}
                    >
                      <button
                        onClick={() => handleExecuteShortcut(shortcut.id)}
                        disabled={!activeTerminalId}
                        className={s.shortcutExecuteButton}
                        title={`実行: ${shortcut.command}`}
                      >
                        <svg
                          className={s.shortcutExecIcon}
                          fill="none"
                          stroke="currentColor"
                          viewBox="0 0 24 24"
                        >
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth={2}
                            d="M14.828 14.828a4 4 0 01-5.656 0M9 10h1m4 0h1m-6 4h1m4 0h1m6-6L10 2l-5 5v6l5 5z"
                          />
                        </svg>
                        <span className={s.shortcutName}>
                          {shortcut.name || shortcut.command}
                        </span>
                        {shortcut.name && (
                          <span className={s.shortcutCommand}>
                            ({shortcut.command})
                          </span>
                        )}
                      </button>
                      {/* デフォルトショートカットは削除不可 */}
                      {!shortcut.isDefault && (
                        <button
                          onClick={() => onDeleteShortcut(shortcut.id)}
                          className={s.shortcutDeleteButton}
                          title="削除"
                        >
                          ×
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              ) : (
                <div className={s.emptyShortcuts}>
                  <p className={s.emptyShortcutsText}>
                    コマンドショートカットがありません
                  </p>
                  <p className={s.emptyShortcutsHint}>
                    よく使うコマンドを登録して素早く実行できます
                  </p>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default TerminalManager;
