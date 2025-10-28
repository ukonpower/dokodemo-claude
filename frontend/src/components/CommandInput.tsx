import React, {
  useState,
  useRef,
  useEffect,
  useImperativeHandle,
  forwardRef,
  useCallback,
} from 'react';
import type { AiProvider } from '../types';

/**
 * TextInputコンポーネントのプロパティ
 * テキスト入力エリアのみを提供（ボタンは含まない）
 */
interface TextInputProps {
  /** コマンド送信ハンドラ */
  onSendCommand: (command: string) => void;
  /** ESC送信ハンドラ（オプション） */
  onSendEscape?: () => void;
  /** 現在のプロバイダー */
  currentProvider?: AiProvider;
  /** 現在のリポジトリパス（履歴管理用） */
  currentRepository?: string;
  /** 入力無効化フラグ */
  disabled?: boolean;
  /** 自動フォーカスを有効化するか */
  autoFocus?: boolean;
}

/**
 * TextInputの公開メソッド
 */
export interface TextInputRef {
  focus: () => void;
  submit: () => void;
}

/**
 * AIコマンド入力用のテキストエリアコンポーネント
 * 履歴機能とキーボードショートカット対応
 */
const TextInput = forwardRef<TextInputRef, TextInputProps>(
  (
    {
      onSendCommand,
      onSendEscape,
      currentProvider = 'claude',
      currentRepository = '',
      disabled = false,
      autoFocus = true,
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
    const inputRef = useRef<HTMLTextAreaElement>(null);

    // フォーカスイベントのログ
    useEffect(() => {
      const handleFocus = () => {
        console.log('[CommandInput] textarea gained focus');
      };
      const handleBlur = () => {
        console.log('[CommandInput] textarea lost focus');
        console.trace('[CommandInput] Blur stack trace');
      };

      const textarea = inputRef.current;
      if (textarea) {
        textarea.addEventListener('focus', handleFocus);
        textarea.addEventListener('blur', handleBlur);
        return () => {
          textarea.removeEventListener('focus', handleFocus);
          textarea.removeEventListener('blur', handleBlur);
        };
      }
    }, []);

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
        console.warn(
          'プロバイダー変更時のlocalStorage読み込みに失敗しました:',
          error
        );
      }
    }, [currentProvider, getStorageKey]);

    // プロジェクトまたはプロバイダーが変更された時に履歴ナビゲーションをリセット
    useEffect(() => {
      setHistoryIndex(-1);
      setTempCommand('');
    }, [currentProvider, currentRepository]);

    // フォーカスを自動で設定
    useEffect(() => {
      console.log('[CommandInput] autoFocus effect, autoFocus:', autoFocus, 'disabled:', disabled);
      if (!autoFocus || disabled) {
        return;
      }
      if (inputRef.current) {
        console.log('[CommandInput] Setting focus on textarea');
        inputRef.current.focus();
      }
    }, [autoFocus, disabled]);

    // refでフォーカス・送信メソッドを公開
    useImperativeHandle(ref, () => ({
      focus: () => {
        console.log('[CommandInput] focus() called via ref');
        if (inputRef.current) {
          inputRef.current.focus();
        }
      },
      submit: () => {
        sendCommand();
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
      <div className="space-y-2">
        {/* テキスト入力エリア */}
        <form onSubmit={handleSubmit} className="relative">
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
            className="w-full px-3 py-2.5 pb-14 border border-dark-border-light bg-dark-bg-secondary text-dark-text-primary rounded-lg shadow-md focus:outline-none focus:ring-1 focus:ring-dark-accent-blue focus:border-dark-accent-blue hover:border-dark-border-focus resize-none text-sm sm:text-base placeholder-dark-text-muted transition-all duration-150"
            rows={3}
            disabled={disabled}
          />
          {/* 送信ボタン（入力エリア内の右下）- 他のボタンとデザイン統一 */}
          <button
            type="submit"
            disabled={disabled}
            className="absolute bottom-3 right-3 flex items-center justify-center w-8 h-8 bg-dark-bg-secondary border border-dark-accent-blue hover:bg-dark-bg-hover hover:border-dark-accent-blue-hover disabled:opacity-50 disabled:cursor-not-allowed rounded-lg text-dark-text-primary focus:outline-none focus:ring-1 focus:ring-dark-accent-blue touch-manipulation shadow-md transition-all duration-150"
            title="送信 (Ctrl+Enter)"
          >
            <svg
              className="w-4 h-4"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M5 10l7-7m0 0l7 7m-7-7v18"
              />
            </svg>
          </button>
        </form>

        {/* 入力クリアボタン（入力エリアの外）- 他のボタンとデザイン統一 */}
        {command && (
          <button
            type="button"
            onClick={handleClearInput}
            disabled={disabled}
            className="flex items-center justify-center h-9 px-4 bg-dark-bg-secondary border border-gray-500 hover:bg-dark-bg-hover hover:border-gray-400 disabled:opacity-50 disabled:cursor-not-allowed rounded-lg text-xs font-mono text-dark-text-primary focus:outline-none focus:ring-1 focus:ring-gray-400 touch-manipulation shadow-md transition-all duration-150"
            title="入力内容をクリア"
          >
            <svg
              className="w-3 h-3 mr-1.5"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
            クリア
          </button>
        )}
      </div>
    );
  }
);

TextInput.displayName = 'TextInput';

export default TextInput;
