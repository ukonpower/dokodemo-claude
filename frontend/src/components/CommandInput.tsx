import React, {
  useState,
  useRef,
  useEffect,
  useImperativeHandle,
  forwardRef,
  useCallback,
} from 'react';
import type { AiProvider } from '../types';

interface CommandInputProps {
  onSendCommand: (command: string) => void;
  onSendArrowKey?: (direction: 'up' | 'down' | 'left' | 'right') => void;
  onSendTabKey?: (shift?: boolean) => void;
  onSendInterrupt?: () => void;
  onSendEscape?: () => void;
  onClearAi?: () => void;
  onChangeModel?: (model: 'default' | 'Opus' | 'Sonnet' | 'OpusPlan') => void;
  currentProvider?: AiProvider;
  currentRepository?: string; // プロジェクト単位で履歴を管理するために追加
  disabled?: boolean;
}

export interface CommandInputRef {
  focus: () => void;
}

const CommandInput = forwardRef<CommandInputRef, CommandInputProps>(
  (
    {
      onSendCommand,
      onSendArrowKey,
      onSendTabKey,
      onSendInterrupt,
      onSendEscape,
      onClearAi,
      onChangeModel,
      currentProvider = 'claude',
      currentRepository = '',
      disabled = false,
    },
    ref
  ) => {
    // プロバイダー別のローカルストレージキーを生成
    const getStorageKey = useCallback(
      () => `ai-command-input-${currentProvider}`,
      [currentProvider]
    );

    // 履歴管理用のlocalStorageキーを生成（プロジェクト単位）
    const getHistoryStorageKey = useCallback(() => {
      // リポジトリパスをBase64エンコードしてキーに含める（特殊文字対策）
      const encodedRepo = currentRepository
        ? btoa(currentRepository).replace(/[/+=]/g, '_')
        : 'default';
      return `ai-command-history-${currentProvider}-${encodedRepo}`;
    }, [currentProvider, currentRepository]);

    // 履歴の最大保存件数
    const MAX_HISTORY_SIZE = 100;

    // 履歴をlocalStorageから読み込み
    const loadHistory = useCallback((): string[] => {
      try {
        const key = getHistoryStorageKey();
        const stored = localStorage.getItem(key);
        if (stored) {
          const history = JSON.parse(stored);
          return Array.isArray(history) ? history : [];
        }
      } catch (error) {
        console.warn('履歴の読み込みに失敗しました:', error);
      }
      return [];
    }, [getHistoryStorageKey]);

    // 履歴をlocalStorageに保存
    const saveHistory = useCallback(
      (history: string[]) => {
        try {
          const key = getHistoryStorageKey();
          localStorage.setItem(key, JSON.stringify(history));
        } catch (error) {
          console.warn('履歴の保存に失敗しました:', error);
        }
      },
      [getHistoryStorageKey]
    );

    // 履歴に追加（重複を避け、最大件数を維持）
    const addToHistory = useCallback(
      (cmd: string) => {
        // 空白のみやエンターキー送信は履歴に保存しない
        if (!cmd.trim() || cmd === '\r') {
          return;
        }

        const history = loadHistory();

        // 最後のコマンドと同じ場合は追加しない（連続重複を避ける）
        if (history.length > 0 && history[history.length - 1] === cmd) {
          return;
        }

        // 履歴に追加
        const newHistory = [...history, cmd];

        // 最大件数を超えた場合は古いものを削除
        if (newHistory.length > MAX_HISTORY_SIZE) {
          newHistory.shift();
        }

        saveHistory(newHistory);
      },
      [loadHistory, saveHistory]
    );

    // 履歴ナビゲーション用の状態
    const [historyIndex, setHistoryIndex] = useState<number>(-1); // -1は履歴外（最新の入力）
    const [tempCommand, setTempCommand] = useState<string>(''); // 履歴を遡る前の一時入力

    const [command, setCommand] = useState(() => {
      // localStorage から初期値を読み込み（プロバイダー別）
      try {
        const currentKey = `ai-command-input-${currentProvider}`;
        const legacyKey = 'claude-command-input';

        // 新しいキーから読み込み
        let savedCommand = localStorage.getItem(currentKey);

        // 新しいキーが存在しない場合、レガシーキーからフォールバック
        if (!savedCommand && currentProvider === 'claude') {
          savedCommand = localStorage.getItem(legacyKey);
          // レガシーデータが見つかった場合、新しいキーに移行
          if (savedCommand) {
            localStorage.setItem(currentKey, savedCommand);
            localStorage.removeItem(legacyKey);
          }
        }

        return savedCommand || '';
      } catch (error) {
        console.warn('localStorage の読み込みに失敗しました:', error);
        return '';
      }
    });
    const [showModelMenu, setShowModelMenu] = useState(false);
    const [showKeyboardButtons, setShowKeyboardButtons] = useState(false);
    const inputRef = useRef<HTMLTextAreaElement>(null);

    const sendCommand = () => {
      if (disabled) return;

      if (command.trim()) {
        // コマンドが入力されている場合：通常のコマンド送信
        // 履歴に追加
        addToHistory(command);
        // コマンド送信
        onSendCommand(command);
        setCommand('');
        // 履歴ナビゲーションをリセット
        setHistoryIndex(-1);
        setTempCommand('');
        // コマンド送信後にlocalStorageをクリア（プロバイダー別）
        try {
          localStorage.removeItem(getStorageKey());
        } catch (error) {
          console.warn('localStorage のクリアに失敗しました:', error);
        }
      } else {
        // コマンドが入力されていない場合：エンターキーを送信
        onSendCommand('\r');
      }
    };

    const handleSubmit = (e: React.FormEvent) => {
      e.preventDefault();
      sendCommand();
    };

    // 入力内容をクリアするハンドラ
    const handleClearInput = () => {
      setCommand('');
      setHistoryIndex(-1);
      setTempCommand('');
      try {
        localStorage.removeItem(getStorageKey());
      } catch (error) {
        console.warn('localStorage のクリアに失敗しました:', error);
      }
      // クリア後にフォーカスを戻す
      if (inputRef.current) {
        inputRef.current.focus();
      }
    };

    const handleKeyDown = (e: React.KeyboardEvent) => {
      // Ctrl+Enter または Cmd+Enter で送信
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        e.preventDefault();
        sendCommand();
        return;
      }

      // ESCキーでESC送信
      if (e.key === 'Escape' && onSendEscape) {
        e.preventDefault();
        onSendEscape();
        return;
      }

      // 上キーで履歴を遡る
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        const history = loadHistory();
        if (history.length === 0) return;

        // 初めて履歴を遡る場合、現在の入力を一時保存
        if (historyIndex === -1) {
          setTempCommand(command);
          setHistoryIndex(history.length - 1);
          setCommand(history[history.length - 1]);
        } else if (historyIndex > 0) {
          // さらに古い履歴へ
          const newIndex = historyIndex - 1;
          setHistoryIndex(newIndex);
          setCommand(history[newIndex]);
        }
        return;
      }

      // 下キーで履歴を進む
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        const history = loadHistory();
        if (historyIndex === -1) return; // 履歴外の場合は何もしない

        if (historyIndex < history.length - 1) {
          // より新しい履歴へ
          const newIndex = historyIndex + 1;
          setHistoryIndex(newIndex);
          setCommand(history[newIndex]);
        } else {
          // 最新の位置まで来たら、一時保存した入力に戻る
          setHistoryIndex(-1);
          setCommand(tempCommand);
          setTempCommand('');
        }
        return;
      }
    };

    // commandまたはcurrentProviderが変更される度にlocalStorageに保存
    useEffect(() => {
      try {
        localStorage.setItem(getStorageKey(), command);
      } catch (error) {
        console.warn('localStorage への保存に失敗しました:', error);
      }
    }, [command, currentProvider, getStorageKey]);

    // プロバイダー変更時にコマンド入力欄を復元
    useEffect(() => {
      try {
        const currentKey = getStorageKey();
        const savedCommand = localStorage.getItem(currentKey) || '';
        setCommand(savedCommand);
      } catch (error) {
        console.warn('プロバイダー変更時のlocalStorage読み込みに失敗しました:', error);
      }
    }, [currentProvider, getStorageKey]);

    // プロジェクトまたはプロバイダーが変更された時に履歴ナビゲーションをリセット
    useEffect(() => {
      setHistoryIndex(-1);
      setTempCommand('');
    }, [currentProvider, currentRepository]);

    // フォーカスを自動で設定
    useEffect(() => {
      if (!disabled && inputRef.current) {
        inputRef.current.focus();
      }
    }, [disabled]);

    // refでフォーカスメソッドを公開
    useImperativeHandle(ref, () => ({
      focus: () => {
        if (inputRef.current) {
          inputRef.current.focus();
        }
      },
    }));

    // プロバイダー情報を取得
    const getProviderInfo = () => {
      switch (currentProvider) {
        case 'claude':
          return {
            name: 'Claude CLI',
            placeholder: 'Claude CLIへの指示を入力してください',
            clearTitle: 'Claude CLIをクリア (/clear)',
          };
        case 'codex':
          return {
            name: 'Codex CLI',
            placeholder: 'Codex CLIへの指示を入力してください',
            clearTitle: 'Codex CLIをクリア (/clear)',
          };
        default:
          return {
            name: 'AI CLI',
            placeholder: 'AI CLIへの指示を入力してください',
            clearTitle: 'AI CLIをクリア (/clear)',
          };
      }
    };

    const providerInfo = getProviderInfo();

    return (
      <div className="space-y-3 sm:space-y-4">
        <form onSubmit={handleSubmit} className="space-y-3 sm:space-y-4">
          <div className="relative">
            <textarea
              ref={inputRef}
              value={command}
              onChange={(e) => setCommand(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={
                disabled
                  ? 'リポジトリを選択してください...'
                  : providerInfo.placeholder
              }
              className="w-full px-3 py-2.5 sm:py-2 pr-12 border border-dark-border-light bg-dark-bg-secondary text-dark-text-primary rounded-lg shadow-md focus:outline-none focus:ring-1 focus:ring-dark-accent-blue focus:border-dark-accent-blue hover:border-dark-border-focus resize-none text-sm sm:text-base placeholder-dark-text-muted transition-all duration-150"
              rows={3}
              disabled={disabled}
            />
            {/* 入力クリアボタン */}
            {command && (
              <button
                type="button"
                onClick={handleClearInput}
                disabled={disabled}
                className="absolute top-2 right-2 flex items-center justify-center w-8 h-8 bg-dark-bg-tertiary border border-gray-500 hover:bg-dark-bg-hover hover:border-gray-400 disabled:opacity-50 disabled:cursor-not-allowed rounded-md text-xs text-dark-text-secondary hover:text-dark-text-primary focus:outline-none focus:ring-1 focus:ring-gray-400 transition-all duration-150"
                title="入力内容をクリア"
              >
                ✕
              </button>
            )}
          </div>

          <div className="flex flex-col space-y-4">
            {/* 上段: 方向キーとEnterボタン */}
            <div className="flex items-center justify-center space-x-6">
              {/* 方向キーボタン */}
              {onSendArrowKey && (
                <div className="flex flex-col items-center">
                  <div className="grid grid-cols-3 gap-1">
                    <div></div>
                    <button
                      type="button"
                      onClick={() => onSendArrowKey('up')}
                      disabled={disabled}
                      className="flex items-center justify-center w-8 h-8 sm:w-9 sm:h-9 bg-dark-bg-secondary border border-gray-500 hover:bg-dark-bg-hover hover:border-gray-400 disabled:opacity-50 disabled:cursor-not-allowed rounded-lg text-sm font-mono text-dark-text-primary focus:outline-none focus:ring-1 focus:ring-gray-400 touch-manipulation shadow-md transition-all duration-150"
                      title="上キー"
                    >
                      ↑
                    </button>
                    <div></div>
                    <button
                      type="button"
                      onClick={() => onSendArrowKey('left')}
                      disabled={disabled}
                      className="flex items-center justify-center w-8 h-8 sm:w-9 sm:h-9 bg-dark-bg-secondary border border-gray-500 hover:bg-dark-bg-hover hover:border-gray-400 disabled:opacity-50 disabled:cursor-not-allowed rounded-lg text-sm font-mono text-dark-text-primary focus:outline-none focus:ring-1 focus:ring-gray-400 touch-manipulation shadow-md transition-all duration-150"
                      title="左キー"
                    >
                      ←
                    </button>
                    <button
                      type="button"
                      onClick={() => onSendArrowKey('down')}
                      disabled={disabled}
                      className="flex items-center justify-center w-8 h-8 sm:w-9 sm:h-9 bg-dark-bg-secondary border border-gray-500 hover:bg-dark-bg-hover hover:border-gray-400 disabled:opacity-50 disabled:cursor-not-allowed rounded-lg text-sm font-mono text-dark-text-primary focus:outline-none focus:ring-1 focus:ring-gray-400 touch-manipulation shadow-md transition-all duration-150"
                      title="下キー"
                    >
                      ↓
                    </button>
                    <button
                      type="button"
                      onClick={() => onSendArrowKey('right')}
                      disabled={disabled}
                      className="flex items-center justify-center w-8 h-8 sm:w-9 sm:h-9 bg-dark-bg-secondary border border-gray-500 hover:bg-dark-bg-hover hover:border-gray-400 disabled:opacity-50 disabled:cursor-not-allowed rounded-lg text-sm font-mono text-dark-text-primary focus:outline-none focus:ring-1 focus:ring-gray-400 touch-manipulation shadow-md transition-all duration-150"
                      title="右キー"
                    >
                      →
                    </button>
                  </div>
                </div>
              )}

              {/* 送信ボタン */}
              <div className="flex flex-col items-center">
                <button
                  type="submit"
                  disabled={disabled}
                  className="bg-dark-bg-tertiary border border-gray-500 text-dark-text-primary px-8 py-3 sm:px-6 sm:py-2.5 rounded-lg hover:bg-dark-bg-hover hover:border-gray-400 focus:outline-none focus:ring-1 focus:ring-gray-400 focus:ring-offset-2 focus:ring-offset-gray-900 disabled:opacity-50 disabled:cursor-not-allowed text-sm font-semibold min-h-[2.5rem] flex items-center touch-manipulation shadow-lg transition-all duration-150"
                >
                  Enter
                </button>
              </div>
            </div>

            {/* 下段: 制御ボタン群 */}
            <div className="flex items-center justify-center">
              <div className="flex flex-wrap items-center justify-center gap-2 sm:gap-3">
                {onSendInterrupt && (
                  <button
                    type="button"
                    onClick={onSendInterrupt}
                    disabled={disabled}
                    className="flex items-center justify-center w-16 h-9 sm:w-18 sm:h-10 bg-dark-bg-secondary border border-gray-500 hover:bg-dark-bg-hover hover:border-gray-400 disabled:opacity-50 disabled:cursor-not-allowed rounded-lg text-xs font-mono text-dark-text-primary focus:outline-none focus:ring-1 focus:ring-gray-400 touch-manipulation shadow-md transition-all duration-150"
                    title="プロセスを中断 (Ctrl+C)"
                  >
                    Ctrl+C
                  </button>
                )}
                {onSendEscape && (
                  <button
                    type="button"
                    onClick={onSendEscape}
                    disabled={disabled}
                    className="flex items-center justify-center w-14 h-9 sm:w-16 sm:h-10 bg-dark-bg-secondary border border-dark-accent-red hover:bg-dark-bg-hover hover:border-dark-accent-red-hover disabled:opacity-50 disabled:cursor-not-allowed rounded-lg text-xs font-mono text-dark-text-primary focus:outline-none focus:ring-1 focus:ring-dark-accent-red touch-manipulation shadow-md transition-all duration-150"
                    title="エスケープキー (ESC)"
                  >
                    ESC
                  </button>
                )}
                {onClearAi && (
                  <button
                    type="button"
                    onClick={onClearAi}
                    disabled={disabled}
                    className="flex items-center justify-center w-14 h-9 sm:w-16 sm:h-10 bg-dark-bg-secondary border border-dark-accent-cyan hover:bg-dark-bg-hover hover:border-dark-accent-cyan-hover disabled:opacity-50 disabled:cursor-not-allowed rounded-lg text-xs font-mono text-dark-text-primary focus:outline-none focus:ring-1 focus:ring-dark-accent-cyan touch-manipulation shadow-md transition-all duration-150"
                    title={providerInfo.clearTitle}
                  >
                    Clear
                  </button>
                )}
                <div className="w-full"></div>
                {/* Claude Code専用ボタン: Mode */}
                {currentProvider === 'claude' && onSendTabKey && (
                  <button
                    type="button"
                    onClick={() => onSendTabKey(true)}
                    disabled={disabled}
                    className="flex items-center justify-center w-20 h-9 sm:w-24 sm:h-10 bg-dark-bg-secondary border border-dark-accent-orange hover:bg-dark-bg-hover hover:border-dark-accent-orange-hover disabled:opacity-50 disabled:cursor-not-allowed rounded-lg text-xs font-mono text-dark-text-primary focus:outline-none focus:ring-1 focus:ring-dark-accent-orange touch-manipulation shadow-md transition-all duration-150"
                    title="モード切り替え"
                  >
                    Mode
                  </button>
                )}
                {/* Claude Code専用ボタン: Model */}
                {currentProvider === 'claude' && onChangeModel && (
                  <div className="relative">
                    <button
                      type="button"
                      onClick={() => setShowModelMenu(!showModelMenu)}
                      disabled={disabled}
                      className="flex items-center justify-center w-16 h-9 sm:w-18 sm:h-10 bg-dark-bg-secondary border border-dark-accent-purple hover:bg-dark-bg-hover hover:border-dark-accent-purple-hover disabled:opacity-50 disabled:cursor-not-allowed rounded-lg text-xs font-mono text-dark-text-primary focus:outline-none focus:ring-1 focus:ring-dark-accent-purple touch-manipulation shadow-md transition-all duration-150"
                      title="モデルを選択"
                    >
                      Model
                    </button>
                    {showModelMenu && (
                      <div className="absolute bottom-full left-0 mb-2 bg-dark-bg-secondary border border-dark-border-light rounded-lg shadow-2xl z-10 min-w-[100px] overflow-hidden">
                        <button
                          type="button"
                          onClick={() => {
                            onChangeModel('default');
                            setShowModelMenu(false);
                          }}
                          className="block w-full text-left px-3 py-2 text-xs text-dark-text-primary hover:bg-dark-bg-hover transition-colors duration-150"
                        >
                          Default
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            onChangeModel('Opus');
                            setShowModelMenu(false);
                          }}
                          className="block w-full text-left px-3 py-2 text-xs text-dark-text-primary hover:bg-dark-bg-hover transition-colors duration-150"
                        >
                          Opus
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            onChangeModel('Sonnet');
                            setShowModelMenu(false);
                          }}
                          className="block w-full text-left px-3 py-2 text-xs text-dark-text-primary hover:bg-dark-bg-hover transition-colors duration-150"
                        >
                          Sonnet
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            onChangeModel('OpusPlan');
                            setShowModelMenu(false);
                          }}
                          className="block w-full text-left px-3 py-2 text-xs text-dark-text-primary hover:bg-dark-bg-hover transition-colors duration-150"
                        >
                          OpusPlan
                        </button>
                      </div>
                    )}
                  </div>
                )}
                {/* Claude Code専用ボタン: Commit */}
                {currentProvider === 'claude' && (
                  <button
                    type="button"
                    onClick={() => onSendCommand('/commit')}
                    disabled={disabled}
                    className="flex items-center justify-center w-16 h-9 sm:w-18 sm:h-10 bg-dark-bg-secondary border border-dark-accent-green hover:bg-dark-bg-hover hover:border-dark-accent-green-hover disabled:opacity-50 disabled:cursor-not-allowed rounded-lg text-xs font-mono text-dark-text-primary focus:outline-none focus:ring-1 focus:ring-dark-accent-green touch-manipulation shadow-md transition-all duration-150"
                    title="コミット (/commit)"
                  >
                    Commit
                  </button>
                )}

                {/* iOS対応: キーボードボタン表示切替 */}
                <button
                  type="button"
                  onClick={() => setShowKeyboardButtons(!showKeyboardButtons)}
                  disabled={disabled}
                  className="flex items-center justify-center w-12 h-9 sm:w-14 sm:h-10 bg-dark-bg-secondary border border-gray-500 hover:bg-dark-bg-hover hover:border-gray-400 disabled:opacity-50 disabled:cursor-not-allowed rounded-lg text-xs font-mono text-dark-text-primary focus:outline-none focus:ring-1 focus:ring-gray-400 touch-manipulation shadow-md transition-all duration-150"
                  title="iOS向けキーボード表示切替"
                >
                  ⌨️
                </button>
              </div>
            </div>

            {/* iOS向けキーボードボタンパネル */}
            {showKeyboardButtons && (
              <div className="bg-dark-bg-secondary rounded-lg p-3 border border-dark-border-light shadow-xl">
                <div className="space-y-3">
                  <div className="text-xs text-dark-text-secondary text-center font-medium">
                    iOS向けキーボード
                  </div>

                  {/* 矢印キー（追加） */}
                  {onSendArrowKey && (
                    <div className="flex flex-col items-center">
                      <div className="text-xs text-dark-text-secondary mb-2">矢印キー</div>
                      <div className="grid grid-cols-3 gap-2">
                        <div></div>
                        <button
                          type="button"
                          onClick={() => onSendArrowKey('up')}
                          disabled={disabled}
                          className="flex items-center justify-center w-12 h-12 bg-dark-bg-tertiary border border-gray-500 hover:bg-dark-bg-hover hover:border-gray-400 disabled:opacity-50 disabled:cursor-not-allowed rounded-lg text-lg font-mono text-dark-text-primary focus:outline-none focus:ring-1 focus:ring-gray-400 touch-manipulation shadow-md transition-all duration-150"
                          title="上キー"
                        >
                          ↑
                        </button>
                        <div></div>
                        <button
                          type="button"
                          onClick={() => onSendArrowKey('left')}
                          disabled={disabled}
                          className="flex items-center justify-center w-12 h-12 bg-dark-bg-tertiary border border-gray-500 hover:bg-dark-bg-hover hover:border-gray-400 disabled:opacity-50 disabled:cursor-not-allowed rounded-lg text-lg font-mono text-dark-text-primary focus:outline-none focus:ring-1 focus:ring-gray-400 touch-manipulation shadow-md transition-all duration-150"
                          title="左キー"
                        >
                          ←
                        </button>
                        <button
                          type="button"
                          onClick={() => onSendArrowKey('down')}
                          disabled={disabled}
                          className="flex items-center justify-center w-12 h-12 bg-dark-bg-tertiary border border-gray-500 hover:bg-dark-bg-hover hover:border-gray-400 disabled:opacity-50 disabled:cursor-not-allowed rounded-lg text-lg font-mono text-dark-text-primary focus:outline-none focus:ring-1 focus:ring-gray-400 touch-manipulation shadow-md transition-all duration-150"
                          title="下キー"
                        >
                          ↓
                        </button>
                        <button
                          type="button"
                          onClick={() => onSendArrowKey('right')}
                          disabled={disabled}
                          className="flex items-center justify-center w-12 h-12 bg-dark-bg-tertiary border border-gray-500 hover:bg-dark-bg-hover hover:border-gray-400 disabled:opacity-50 disabled:cursor-not-allowed rounded-lg text-lg font-mono text-dark-text-primary focus:outline-none focus:ring-1 focus:ring-gray-400 touch-manipulation shadow-md transition-all duration-150"
                          title="右キー"
                        >
                          →
                        </button>
                      </div>
                    </div>
                  )}

                  {/* その他のキー */}
                  <div className="flex flex-wrap items-center justify-center gap-2">
                    {onSendTabKey && (
                      <button
                        type="button"
                        onClick={() => onSendTabKey(true)}
                        disabled={disabled}
                        className="bg-dark-bg-tertiary border border-dark-accent-orange hover:bg-dark-bg-hover hover:border-dark-accent-orange-hover text-dark-text-primary px-4 py-2.5 rounded-lg disabled:opacity-50 disabled:cursor-not-allowed text-sm font-mono focus:outline-none focus:ring-1 focus:ring-dark-accent-orange touch-manipulation min-h-[2.5rem] shadow-md transition-all duration-150"
                        title="モード切り替え"
                      >
                        Mode
                      </button>
                    )}

                    {onSendEscape && (
                      <button
                        type="button"
                        onClick={onSendEscape}
                        disabled={disabled}
                        className="bg-dark-bg-tertiary border border-dark-accent-red hover:bg-dark-bg-hover hover:border-dark-accent-red-hover text-dark-text-primary px-4 py-2.5 rounded-lg disabled:opacity-50 disabled:cursor-not-allowed text-sm font-mono focus:outline-none focus:ring-1 focus:ring-dark-accent-red touch-manipulation min-h-[2.5rem] shadow-md transition-all duration-150"
                        title="エスケープキー (ESC)"
                      >
                        ESC
                      </button>
                    )}

                    {onSendInterrupt && (
                      <button
                        type="button"
                        onClick={onSendInterrupt}
                        disabled={disabled}
                        className="bg-dark-bg-tertiary border border-gray-500 hover:bg-dark-bg-hover hover:border-gray-400 text-dark-text-primary px-4 py-2.5 rounded-lg disabled:opacity-50 disabled:cursor-not-allowed text-sm font-mono focus:outline-none focus:ring-1 focus:ring-gray-400 touch-manipulation min-h-[2.5rem] shadow-md transition-all duration-150"
                        title="プロセスを中断 (Ctrl+C)"
                      >
                        Ctrl+C
                      </button>
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>
        </form>
      </div>
    );
  }
);

CommandInput.displayName = 'CommandInput';

export default CommandInput;
