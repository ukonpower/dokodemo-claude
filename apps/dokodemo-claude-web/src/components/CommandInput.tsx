import React, {
  useState,
  useRef,
  useEffect,
  useImperativeHandle,
  forwardRef,
  useCallback,
} from 'react';
import { Repeat } from 'lucide-react';
import type { AiProvider } from '../types';
import { useModelOptions } from '../hooks/useModelOptions';
import { resolveModelLabel } from '../utils/models';
import LoopSettingsFields from './LoopSettingsFields';
import type { LoopSettingsValue } from './LoopSettingsFields';
import s from './CommandInput.module.scss';

/** fixed 配置のドロップダウンが画面外にはみ出さないよう left を収める */
const clampDropdownLeft = (left: number, width: number) =>
  Math.max(8, Math.min(left, window.innerWidth - width - 8));

// --- インデント / リスト継続ヘルパー ---
const INDENT = '  '; // 2 スペース

/** value 内の [start, end) 区間がカバーする全行の [行頭, 行末) を算出 */
function getLineRange(
  value: string,
  start: number,
  end: number
): { lineStart: number; lineEnd: number } {
  const lineStart = value.lastIndexOf('\n', start - 1) + 1;
  const lineEndRaw = value.indexOf('\n', end);
  const lineEnd = lineEndRaw === -1 ? value.length : lineEndRaw;
  return { lineStart, lineEnd };
}

/** 複数行のブロックに対してインデント/アウトデントを適用 */
function applyBlockIndent(
  block: string,
  direction: 'indent' | 'outdent'
): { next: string; deltaFirst: number; deltaTotal: number } {
  const lines = block.split('\n');
  let deltaFirst = 0;
  let deltaTotal = 0;
  const out = lines.map((line, i) => {
    if (direction === 'indent') {
      const d = INDENT.length;
      if (i === 0) deltaFirst = d;
      deltaTotal += d;
      return INDENT + line;
    } else {
      const match = line.match(/^ {1,2}/);
      const d = match ? match[0].length : 0;
      if (i === 0) deltaFirst = -d;
      deltaTotal -= d;
      return line.slice(d);
    }
  });
  return { next: out.join('\n'), deltaFirst, deltaTotal };
}

type BulletContinuation =
  | { kind: 'continue'; insert: string }
  | { kind: 'terminate'; removeStart: number; removeEnd: number }
  | null;

/** Enter 直前の行にリスト prefix があれば継続/終了情報を返す */
function computeBulletContinuation(
  value: string,
  caret: number
): BulletContinuation {
  const lineStart = value.lastIndexOf('\n', caret - 1) + 1;
  const line = value.slice(lineStart, caret);
  const m = line.match(/^(\s*)- (.*)$/);
  if (!m) return null;
  const [, leading, body] = m;
  if (body.length === 0) {
    return { kind: 'terminate', removeStart: lineStart, removeEnd: caret };
  }
  return { kind: 'continue', insert: `\n${leading}- ` };
}

/**
 * TextInputコンポーネントのプロパティ
 * テキスト入力エリアのみを提供（ボタンは含まない）
 */
interface TextInputProps {
  /** コマンド送信ハンドラ */
  onSendCommand: (command: string) => void;
  /** ESC送信ハンドラ（オプション） */
  onSendEscape?: () => void;
  /** キュー追加ハンドラ（オプション） */
  onAddToQueue?: (
    command: string,
    sendClearBefore: boolean,
    sendCommitAfter: boolean,
    model?: string,
    loop?: {
      judge: 'ai' | 'user' | 'none';
      judgeEveryN: number;
      intervalSec: number;
    }
  ) => void;
  /** 現在のプロバイダー */
  currentProvider?: AiProvider;
  /** 現在のリポジトリパス（履歴管理用） */
  currentRepository?: string;
  /** プライマリインスタンスかどうか（false の場合はキュー/Auto ワークフロー非表示） */
  isPrimary?: boolean;
  /** 送信操作の無効化フラグ（ネットワーク切断時など、送信できない状態） */
  disabled?: boolean;
  /** 入力欄自体の無効化フラグ（リポジトリ未選択など、入力する意味がない状態） */
  inputDisabled?: boolean;
  /** 自動フォーカスを有効化するか */
  autoFocus?: boolean;
  /** 送信設定の状態 */
  sendSettings?: {
    addToQueue: boolean;
    sendClear: boolean;
    sendCommit: boolean;
    model?: string;
    workflowSkill?: string;
    autoTarget?: 'plan' | 'implement';
    autoReview?: boolean;
    autoClear?: boolean;
    loopEnabled?: boolean;
    loopJudge?: 'ai' | 'user' | 'none';
    loopJudgeEveryN?: number;
    loopIntervalMin?: number;
  };
  /** 送信設定の更新ハンドラ */
  onSendSettingsChange?: (settings: {
    addToQueue: boolean;
    sendClear: boolean;
    sendCommit: boolean;
    model?: string;
    workflowSkill?: string;
    autoTarget?: 'plan' | 'implement';
    autoReview?: boolean;
    autoClear?: boolean;
    loopEnabled?: boolean;
    loopJudge?: 'ai' | 'user' | 'none';
    loopJudgeEveryN?: number;
    loopIntervalMin?: number;
  }) => void;
  /** クリップボードから画像をペーストした時のハンドラ（オプション）。成功時にパスを返す */
  onPasteFile?: (file: File) => Promise<string | undefined>;
  /** ファイルアップロード中フラグ（オプション） */
  isUploadingFile?: boolean;
  /** ワークフローファイルを開くハンドラ（オプション） */
  onOpenWorkflowFile?: (path: string) => void;
  /** ワークフローコントロール（research/plan/Auto 等）とファイルリンクを非表示にする */
  hideWorkflowControls?: boolean;
}

// ワークフロースキルの定義
const WORKFLOW_SKILLS = [
  { value: '', label: 'なし' },
  { value: 'research', label: 'Research', command: '/dokodemo-claude-tools:workflow-research', file: '.workflow-tools/research.md' },
  { value: 'plan', label: 'Plan', command: '/dokodemo-claude-tools:workflow-plan', file: '.workflow-tools/plan.md' },
  { value: 'codex-review', label: 'Review', command: '/dokodemo-claude-tools:workflow-plan-codexreview', file: '.workflow-tools/plan-review.md' },
  { value: 'implement', label: 'Implement', command: '/dokodemo-claude-tools:workflow-implement' },
  { value: 'worktree', label: 'Worktree', command: '/dokodemo-claude-tools:worktree-manage' },
] as const;

// Worktree スキルはワークフローパイプライン（research→plan→...）とは別枠として
// Auto の右側に独立配置するため、メインのスキルグループとは分けて扱う
const WORKTREE_SKILL = WORKFLOW_SKILLS.find(
  (s): s is Extract<(typeof WORKFLOW_SKILLS)[number], { command: string }> =>
    s.value === 'worktree'
);

/**
 * TextInputの公開メソッド
 */
export interface TextInputRef {
  focus: () => void;
  submit: () => void;
  insertFiles: (files: File[]) => Promise<void>;
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
      onAddToQueue,
      currentProvider = 'claude',
      currentRepository = '',
      isPrimary = true,
      disabled = false,
      inputDisabled,
      autoFocus = true,
      sendSettings,
      onSendSettingsChange,
      onPasteFile,
      isUploadingFile = false,
      onOpenWorkflowFile,
      hideWorkflowControls = false,
    },
    ref
  ) => {
    // 入力欄の無効化条件。未指定なら disabled をそのまま使う。
    const isInputDisabled = inputDisabled ?? disabled;

    // プロバイダー・リポジトリ別のローカルストレージキーを生成
    const getStorageKey = useCallback(() => {
      // リポジトリパスをBase64エンコードしてキーに含める（特殊文字対策）
      const encodedRepo = currentRepository
        ? btoa(currentRepository).replace(/[/+=]/g, '_')
        : 'default';
      return `ai-command-input-${currentProvider}-${encodedRepo}`;
    }, [currentProvider, currentRepository]);

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

    // sendSettingsの値を使用（propsが渡されていない場合はローカルstate）
    // 非プライマリではキュー機能を使えないため、addToQueue を強制的に false 扱いにする
    const addToQueue = isPrimary ? (sendSettings?.addToQueue ?? false) : false;
    const sendClearBefore = sendSettings?.sendClear ?? false;
    const sendCommitAfter = sendSettings?.sendCommit ?? false;
    const model = sendSettings?.model ?? '';
    const rawWorkflowSkill = sendSettings?.workflowSkill ?? '';

    // ループ設定（キュー ON 時のみ有効）
    const loopEnabled = addToQueue && (sendSettings?.loopEnabled ?? false);
    const loopJudge = sendSettings?.loopJudge ?? 'none';
    const loopJudgeEveryN = Math.max(1, sendSettings?.loopJudgeEveryN ?? 1);
    const loopIntervalMin = Math.max(0, sendSettings?.loopIntervalMin ?? 0);
    // 非プライマリでは Auto ワークフローを使えないため、auto を空に丸める
    const workflowSkill =
      !isPrimary && rawWorkflowSkill === 'auto' ? '' : rawWorkflowSkill;

    // モデル選択肢（組み込み + API 取得 + カスタム）
    const { options: modelOptions, anthropicStatus, addCustomModel, removeCustomModel } =
      useModelOptions();

    // モデル選択のドロップダウン開閉状態
    const [isModelDropdownOpen, setIsModelDropdownOpen] = useState(false);
    // ループ設定アコーディオンの開閉状態
    const [isLoopExpanded, setIsLoopExpanded] = useState(false);
    // 送信セクション（アコーディオン展開時に画面内へスクロールするため）
    const sendSectionRef = useRef<HTMLDivElement>(null);
    // カスタムモデル追加フォームの開閉と入力値
    const [isAddModelOpen, setIsAddModelOpen] = useState(false);
    const [newModelId, setNewModelId] = useState('');
    const [newModelName, setNewModelName] = useState('');
    const modelDropdownRef = useRef<HTMLDivElement>(null);
    const modelButtonRef = useRef<HTMLButtonElement>(null);
    const [dropdownPosition, setDropdownPosition] = useState({
      top: 0,
      left: 0,
    });

    // チェックボックスの状態変更ハンドラ
    const handleSettingChange = (
      key:
        | 'addToQueue'
        | 'sendClear'
        | 'sendCommit'
        | 'model'
        | 'workflowSkill'
        | 'autoTarget'
        | 'autoReview'
        | 'autoClear'
        | 'loopEnabled'
        | 'loopJudge'
        | 'loopJudgeEveryN'
        | 'loopIntervalMin',
      value: boolean | string | number
    ) => {
      if (onSendSettingsChange && sendSettings) {
        onSendSettingsChange({
          ...sendSettings,
          [key]: value,
        });
      }
    };

    // ループ設定フィールドの変更を送信設定のキーへ展開して反映
    const handleLoopSettingsChange = (next: LoopSettingsValue) => {
      if (onSendSettingsChange && sendSettings) {
        onSendSettingsChange({
          ...sendSettings,
          loopJudge: next.judge,
          loopJudgeEveryN: next.judgeEveryN,
          loopIntervalMin: Math.round(next.intervalSec / 60),
        });
      }
    };

    // カスタムモデル追加フォームの送信
    const handleAddCustomModel = () => {
      const id = newModelId.trim();
      if (!id) return;
      addCustomModel(id, newModelName.trim() || undefined);
      // 追加したモデルを選択状態にする
      handleSettingChange('model', id);
      setNewModelId('');
      setNewModelName('');
      setIsAddModelOpen(false);
    };

    // モデルドロップダウン外クリックで閉じる & 位置計算
    useEffect(() => {
      const updatePosition = () => {
        if (modelButtonRef.current) {
          const rect = modelButtonRef.current.getBoundingClientRect();
          setDropdownPosition({
            top: rect.top - 4, // ボタンの上に表示（余白4px）
            left: clampDropdownLeft(rect.left, 192), // 12rem
          });
        }
      };

      const handleClickOutside = (event: MouseEvent) => {
        if (
          modelDropdownRef.current &&
          !modelDropdownRef.current.contains(event.target as Node)
        ) {
          setIsModelDropdownOpen(false);
          setIsAddModelOpen(false);
        }
      };

      if (isModelDropdownOpen) {
        updatePosition();
        document.addEventListener('mousedown', handleClickOutside);
        window.addEventListener('scroll', updatePosition, true);
        window.addEventListener('resize', updatePosition);
      }

      return () => {
        document.removeEventListener('mousedown', handleClickOutside);
        window.removeEventListener('scroll', updatePosition, true);
        window.removeEventListener('resize', updatePosition);
      };
    }, [isModelDropdownOpen]);

    // ループアコーディオンを開いたら送信バーごと画面内へスクロール
    // （このモバイルレイアウトはページ全体がスクロールするため）
    useEffect(() => {
      if (isLoopExpanded) {
        sendSectionRef.current?.scrollIntoView({
          block: 'end',
          behavior: 'smooth',
        });
      }
    }, [isLoopExpanded]);

    const [command, setCommand] = useState(() => {
      // localStorage から初期値を読み込み（プロバイダー・リポジトリ別）
      try {
        // リポジトリパスをBase64エンコード
        const encodedRepo = currentRepository
          ? btoa(currentRepository).replace(/[/+=]/g, '_')
          : 'default';
        const currentKey = `ai-command-input-${currentProvider}-${encodedRepo}`;

        // 新しいキーから読み込み
        const savedCommand = localStorage.getItem(currentKey);

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
        // Textarea gained focus
      };
      const handleBlur = () => {
        // Textarea lost focus
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

    const formatSkillCommand = (cmd: string) => {
      if (currentProvider === 'codex' && cmd.startsWith('/')) {
        return cmd.slice(1);
      }
      return cmd;
    };

    const sendCommand = () => {
      if (disabled) return;

      if (command.trim()) {
        // コマンドが入力されている場合
        // 履歴に追加（プレフィックスなしの元コマンドを保存）
        addToHistory(command);

        // Auto ワークフローモード（research → plan [→ review] [→ implement]）
        if (workflowSkill === 'auto' && onAddToQueue) {
          const autoTarget = sendSettings?.autoTarget ?? 'plan';
          const autoReview = sendSettings?.autoReview ?? false;
          const autoClear = sendSettings?.autoClear ?? false;
          handleSettingChange('addToQueue', true);
          onAddToQueue(
            formatSkillCommand(`/workflow-research ${command}`),
            autoClear,
            false,
            undefined
          );
          onAddToQueue(
            formatSkillCommand(`/workflow-plan ${command}`),
            false,
            false,
            undefined
          );
          if (autoReview) {
            onAddToQueue(
              formatSkillCommand(`/dokodemo-claude-tools:workflow-plan-codexreview`),
              false,
              false,
              undefined
            );
          }
          if (autoTarget === 'implement') {
            onAddToQueue(
              formatSkillCommand(`/workflow-implement`),
              autoClear,
              false,
              undefined
            );
          }

          setCommand('');
          handleSettingChange('workflowSkill', '');
          setHistoryIndex(-1);
          setTempCommand('');
          try {
            localStorage.removeItem(getStorageKey());
          } catch (error) {
            console.warn('localStorage のクリアに失敗しました:', error);
          }
          return;
        }

        // workflowSkill が選択されている場合、プレフィックスを付与
        const skillDef = workflowSkill
          ? WORKFLOW_SKILLS.find(s => s.value === workflowSkill)
          : undefined;
        const finalCommand = skillDef && 'command' in skillDef
          ? `${formatSkillCommand(skillDef.command)} ${command}`
          : command;

        // キュー追加モードの場合
        if (addToQueue && onAddToQueue) {
          const loopArg = loopEnabled
            ? {
                judge: loopJudge,
                judgeEveryN: loopJudgeEveryN,
                intervalSec: loopIntervalMin * 60,
              }
            : undefined;
          onAddToQueue(
            finalCommand,
            sendClearBefore,
            sendCommitAfter,
            model || undefined,
            loopArg
          );
        } else {
          // 通常のコマンド送信
          onSendCommand(finalCommand);
        }

        setCommand('');
        // ワークフロースキルをリセット
        if (workflowSkill) {
          handleSettingChange('workflowSkill', '');
        }
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

    const isComposingRef = useRef(false);

    const handleCompositionStart = useCallback(() => {
      isComposingRef.current = true;
    }, []);

    const handleCompositionEnd = useCallback(() => {
      isComposingRef.current = false;
    }, []);

    const autoResize = useCallback(() => {
      const el = inputRef.current;
      if (!el) return;
      el.style.height = 'auto';
      el.style.height = `${el.scrollHeight}px`;
    }, []);

    /**
     * textarea の現在選択範囲を text で置換する。
     * execCommand('insertText') が使えれば undo スタックを維持する。
     */
    const insertAtSelection = useCallback(
      (text: string, selection?: { start: number; end: number }) => {
        const el = inputRef.current;
        if (!el) return;

        if (selection) {
          el.setSelectionRange(selection.start, selection.end);
        }

        const ok =
          typeof document.execCommand === 'function' &&
          document.execCommand('insertText', false, text);

        if (ok) return;

        const start = el.selectionStart;
        const end = el.selectionEnd;
        const nextValue =
          el.value.slice(0, start) + text + el.value.slice(end);
        setCommand(nextValue);
        const nextCaret = start + text.length;
        setTimeout(() => {
          const node = inputRef.current;
          if (!node) return;
          node.focus();
          node.selectionStart = node.selectionEnd = nextCaret;
        }, 0);
      },
      []
    );

    /**
     * 指定範囲を置換し、カーソル/選択範囲を明示的に復元する。
     */
    const replaceRangeKeepSelection = useCallback(
      (
        start: number,
        end: number,
        next: string,
        selStart: number,
        selEnd: number
      ) => {
        const el = inputRef.current;
        if (!el) return;
        el.focus();
        el.setSelectionRange(start, end);

        const ok =
          typeof document.execCommand === 'function' &&
          document.execCommand('insertText', false, next);

        if (ok) {
          el.setSelectionRange(selStart, selEnd);
          return;
        }

        const value = el.value;
        const updated = value.slice(0, start) + next + value.slice(end);
        setCommand(updated);
        setTimeout(() => {
          const node = inputRef.current;
          if (!node) return;
          node.focus();
          node.setSelectionRange(selStart, selEnd);
        }, 0);
      },
      []
    );

    const handleTabKey = useCallback(
      (direction: 'indent' | 'outdent') => {
        const el = inputRef.current;
        if (!el) return;

        const value = el.value;
        const selStart = el.selectionStart;
        const selEnd = el.selectionEnd;
        const isRange = selStart !== selEnd;
        const hasNewlineInSelection =
          isRange && value.slice(selStart, selEnd).includes('\n');

        // ケース A: collapsed
        if (!isRange) {
          if (direction === 'indent') {
            // カーソル行が箇条書きの場合は行全体をインデントする
            const lineStart = value.lastIndexOf('\n', selStart - 1) + 1;
            const lineEndRaw = value.indexOf('\n', selStart);
            const lineEnd = lineEndRaw === -1 ? value.length : lineEndRaw;
            const line = value.slice(lineStart, lineEnd);
            if (/^\s*- /.test(line)) {
              replaceRangeKeepSelection(
                lineStart,
                lineStart,
                INDENT,
                selStart + INDENT.length,
                selEnd + INDENT.length
              );
              return;
            }
            insertAtSelection(INDENT);
          } else {
            const lineStart = value.lastIndexOf('\n', selStart - 1) + 1;
            const head = value.slice(lineStart, lineStart + INDENT.length);
            const removable = head.match(/^ {1,2}/)?.[0].length ?? 0;
            if (removable === 0) return;
            replaceRangeKeepSelection(
              lineStart,
              lineStart + removable,
              '',
              Math.max(lineStart, selStart - removable),
              Math.max(lineStart, selEnd - removable)
            );
          }
          return;
        }

        // ケース B: 単一行の範囲選択（改行を含まない）
        if (isRange && !hasNewlineInSelection && direction === 'indent') {
          insertAtSelection(INDENT);
          return;
        }

        // ケース C: 複数行選択 または 単一行 outdent
        const { lineStart, lineEnd } = getLineRange(value, selStart, selEnd);
        const block = value.slice(lineStart, lineEnd);
        const { next, deltaFirst, deltaTotal } = applyBlockIndent(
          block,
          direction
        );

        const newSelStart = Math.max(lineStart, selStart + deltaFirst);
        const newSelEnd = Math.max(lineStart, selEnd + deltaTotal);

        replaceRangeKeepSelection(
          lineStart,
          lineEnd,
          next,
          newSelStart,
          newSelEnd
        );
      },
      [insertAtSelection, replaceRangeKeepSelection]
    );

    useEffect(() => {
      autoResize();
    }, [command, autoResize]);

    // クリップボードから画像をペーストした時のハンドラ
    const handlePaste = useCallback(
      async (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
        const items = e.clipboardData?.items;
        if (!items) return;

        for (const item of Array.from(items)) {
          if (item.type.startsWith('image/')) {
            e.preventDefault();
            const file = item.getAsFile();
            if (file && onPasteFile) {
              const filePath = await onPasteFile(file);
              if (filePath) {
                insertAtSelection(filePath);
              }
            }
            return;
          }
        }
      },
      [onPasteFile, insertAtSelection]
    );

    // ドラッグオーバー中のスタイル制御用 state
    const [isDragOver, setIsDragOver] = useState(false);

    const handleDragOver = useCallback(
      (e: React.DragEvent<HTMLTextAreaElement>) => {
        e.preventDefault();
        if (!e.dataTransfer.types.includes('Files')) return;
        setIsDragOver(true);
      },
      []
    );

    const handleDragLeave = useCallback(
      (e: React.DragEvent<HTMLTextAreaElement>) => {
        e.preventDefault();
        setIsDragOver(false);
      },
      []
    );

    const insertFilesAsPaths = useCallback(
      async (files: File[]) => {
        if (files.length === 0) return;
        if (!onPasteFile) return;

        inputRef.current?.focus();

        const paths: string[] = [];
        for (const file of files) {
          const p = await onPasteFile(file);
          if (p) paths.push(p);
        }
        if (paths.length === 0) return;

        insertAtSelection(paths.join(' '));
      },
      [onPasteFile, insertAtSelection]
    );

    const handleDrop = useCallback(
      async (e: React.DragEvent<HTMLTextAreaElement>) => {
        e.preventDefault();
        setIsDragOver(false);

        const droppedFiles = Array.from(e.dataTransfer.files);
        await insertFilesAsPaths(droppedFiles);
      },
      [insertFilesAsPaths]
    );

    // ファイルアップロード用 input の ref
    const fileInputRef = useRef<HTMLInputElement>(null);

    // ファイル選択ボタン押下時：ネイティブの file picker を開く
    const handleUploadClick = useCallback(() => {
      fileInputRef.current?.click();
    }, []);

    // 末尾にパス文字列を追記（必要に応じてスペース区切り）
    const appendPathsToEnd = useCallback((paths: string[]) => {
      if (paths.length === 0) return;
      const joined = paths.join(' ');
      setCommand((prev) => {
        if (!prev) return joined;
        const needsSeparator = !/\s$/.test(prev);
        return needsSeparator ? `${prev} ${joined}` : `${prev}${joined}`;
      });
      // 追記後にフォーカスを戻し、末尾にカーソルを置く
      setTimeout(() => {
        const node = inputRef.current;
        if (!node) return;
        node.focus();
        const end = node.value.length;
        node.setSelectionRange(end, end);
      }, 0);
    }, []);

    // ファイル選択時：アップロードして末尾にパスを追記
    const handleFileSelected = useCallback(
      async (e: React.ChangeEvent<HTMLInputElement>) => {
        const selected = Array.from(e.target.files ?? []);
        e.target.value = '';
        if (selected.length === 0 || !onPasteFile) return;

        const paths: string[] = [];
        for (const file of selected) {
          const p = await onPasteFile(file);
          if (p) paths.push(p);
        }
        appendPathsToEnd(paths);
      },
      [onPasteFile, appendPathsToEnd]
    );

    const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      // IME 変換中は一切フック処理しない
      if (
        isComposingRef.current ||
        e.nativeEvent.isComposing ||
        e.keyCode === 229
      ) {
        return;
      }

      // Ctrl+Enter または Cmd+Enter で送信
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        e.preventDefault();
        sendCommand();
        return;
      }

      // Cmd/Ctrl + ↑ で前の履歴へ、Cmd/Ctrl + ↓ で次の履歴へ
      if ((e.metaKey || e.ctrlKey) && e.key === 'ArrowUp') {
        e.preventDefault();
        navigateHistoryUp();
        return;
      }
      if ((e.metaKey || e.ctrlKey) && e.key === 'ArrowDown') {
        e.preventDefault();
        navigateHistoryDown();
        return;
      }

      // Alt+T でAlt+tキーを送信
      if (e.altKey && e.key === 't') {
        e.preventDefault();
        onSendCommand('\x1bt'); // Alt+t (ESC + t)
        return;
      }

      // ESCキーでESC送信
      if (e.key === 'Escape' && onSendEscape) {
        e.preventDefault();
        onSendEscape();
        return;
      }

      // Tab / Shift+Tab でインデント/アウトデント
      if (e.key === 'Tab') {
        e.preventDefault();
        handleTabKey(e.shiftKey ? 'outdent' : 'indent');
        return;
      }

      // 修飾キーなし Enter で箇条書き自動継続
      if (
        e.key === 'Enter' &&
        !e.shiftKey &&
        !e.ctrlKey &&
        !e.metaKey &&
        !e.altKey
      ) {
        const el = inputRef.current;
        if (!el) return;
        const result = computeBulletContinuation(el.value, el.selectionStart);
        if (!result) return;

        e.preventDefault();
        if (result.kind === 'continue') {
          insertAtSelection(result.insert);
        } else {
          replaceRangeKeepSelection(
            result.removeStart,
            result.removeEnd,
            '\n',
            result.removeStart + 1,
            result.removeStart + 1
          );
        }
        return;
      }
    };

    // 履歴を遡る（古い方へ）
    const navigateHistoryUp = () => {
      const history = loadHistory();
      if (history.length === 0) return;

      if (historyIndex === -1) {
        setTempCommand(command);
        setHistoryIndex(history.length - 1);
        setCommand(history[history.length - 1]);
      } else if (historyIndex > 0) {
        const newIndex = historyIndex - 1;
        setHistoryIndex(newIndex);
        setCommand(history[newIndex]);
      }
    };

    // 履歴を進む（新しい方へ）
    const navigateHistoryDown = () => {
      const history = loadHistory();
      if (historyIndex === -1) return;

      if (historyIndex < history.length - 1) {
        const newIndex = historyIndex + 1;
        setHistoryIndex(newIndex);
        setCommand(history[newIndex]);
      } else {
        setHistoryIndex(-1);
        setCommand(tempCommand);
        setTempCommand('');
      }
    };

    // commandが変更される度にlocalStorageに保存（プロバイダー・リポジトリ別）
    useEffect(() => {
      try {
        localStorage.setItem(getStorageKey(), command);
      } catch (error) {
        console.warn('localStorage への保存に失敗しました:', error);
      }
    }, [command, currentProvider, currentRepository, getStorageKey]);

    // プロバイダーまたはリポジトリ変更時にコマンド入力欄を復元
    useEffect(() => {
      try {
        const currentKey = getStorageKey();
        const savedCommand = localStorage.getItem(currentKey) || '';
        setCommand(savedCommand);
      } catch (error) {
        console.warn(
          'プロバイダー/リポジトリ変更時のlocalStorage読み込みに失敗しました:',
          error
        );
      }
    }, [currentProvider, currentRepository, getStorageKey]);

    // プロジェクトまたはプロバイダーが変更された時に履歴ナビゲーションをリセット
    useEffect(() => {
      setHistoryIndex(-1);
      setTempCommand('');
    }, [currentProvider, currentRepository]);

    // 注: チェックボックスの状態（addToQueue, sendClearBefore, sendCommitAfter）は
    // 親コンポーネント（App.tsx）でリポジトリ単位でlocalStorageに保存されるため、
    // ここでの個別保存は不要

    // フォーカスを自動で設定
    useEffect(() => {
      if (!autoFocus || isInputDisabled) {
        return;
      }
      if (inputRef.current) {
        inputRef.current.focus();
      }
    }, [autoFocus, isInputDisabled]);

    // refでフォーカス・送信メソッドを公開
    useImperativeHandle(ref, () => ({
      focus: () => {
        if (inputRef.current) {
          inputRef.current.focus();
        }
      },
      submit: () => {
        sendCommand();
      },
      insertFiles: async (files: File[]) => {
        await insertFilesAsPaths(files);
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
      <div className={s.root}>
        {/* ワークフローコントロール */}
        {onAddToQueue && !hideWorkflowControls && (
          <div className={s.workflowControls}>
            {/* 行1: スキル選択 + Auto */}
            <div className={s.skillRow}>
              <div className={s.skillGroup}>
                {WORKFLOW_SKILLS.filter((skill) => skill.value !== 'worktree').map((skill) => (
                  <button
                    key={skill.value}
                    type="button"
                    onClick={() => {
                      if (workflowSkill === skill.value && 'command' in skill) {
                        onSendCommand(formatSkillCommand(skill.command));
                        handleSettingChange('workflowSkill', '');
                      } else {
                        handleSettingChange('workflowSkill', skill.value);
                      }
                    }}
                    disabled={disabled}
                    className={`${s.skillButton} ${workflowSkill === skill.value ? s.active : ''}`}
                    title={`Workflow: ${skill.label}${'command' in skill && workflowSkill === skill.value ? '（もう一度クリックで実行）' : ''}`}
                  >
                    {skill.label}
                  </button>
                ))}
                {isPrimary && (
                  <>
                    <div className={s.skillDivider} />
                    <button
                      type="button"
                      onClick={() => handleSettingChange('workflowSkill', workflowSkill === 'auto' ? '' : 'auto')}
                      disabled={disabled}
                      className={`${s.skillButton} ${workflowSkill === 'auto' ? s.active : ''}`}
                    >
                      Auto
                    </button>
                  </>
                )}
              </div>
              {/* Worktree: パイプラインとは別枠として Auto の右側に独立配置 */}
              {WORKTREE_SKILL && (
                <div className={s.worktreeGroup}>
                  <button
                    type="button"
                    onClick={() => {
                      if (workflowSkill === WORKTREE_SKILL.value) {
                        onSendCommand(formatSkillCommand(WORKTREE_SKILL.command));
                        handleSettingChange('workflowSkill', '');
                      } else {
                        handleSettingChange('workflowSkill', WORKTREE_SKILL.value);
                      }
                    }}
                    disabled={disabled}
                    className={`${s.skillButton} ${s.worktreeButton} ${workflowSkill === WORKTREE_SKILL.value ? s.active : ''}`}
                    title={`Workflow: ${WORKTREE_SKILL.label}${workflowSkill === WORKTREE_SKILL.value ? '（もう一度クリックで実行）' : ''}`}
                  >
                    {WORKTREE_SKILL.label}
                  </button>
                </div>
              )}
            </div>

            {/* Autoオプション（Auto選択時のみ展開、プライマリ限定） */}
            {isPrimary && workflowSkill === 'auto' && (
              <div className={s.autoOptions}>
                <div className={s.autoTargetGroup}>
                  <span className={s.autoTargetLabel}>到達</span>
                  {(['plan', 'implement'] as const).map((target) => (
                    <button
                      key={target}
                      type="button"
                      onClick={() => handleSettingChange('autoTarget', target)}
                      disabled={disabled}
                      className={`${s.autoTargetButton} ${(sendSettings?.autoTarget ?? 'plan') === target ? s.active : ''}`}
                    >
                      {target === 'plan' ? 'Plan' : 'Impl'}
                    </button>
                  ))}
                </div>
                <button
                  type="button"
                  onClick={() => handleSettingChange('autoReview', !sendSettings?.autoReview)}
                  disabled={disabled}
                  className={`${s.autoCheckButton} ${sendSettings?.autoReview ? s.active : ''}`}
                  title="Plan後にCodex Reviewを実行"
                >
                  <span className={`${s.checkIcon} ${sendSettings?.autoReview ? s.checked : ''}`}>
                    {sendSettings?.autoReview && '✓'}
                  </span>
                  Review
                </button>
                <button
                  type="button"
                  onClick={() => handleSettingChange('autoClear', !sendSettings?.autoClear)}
                  disabled={disabled}
                  className={`${s.autoCheckButton} ${sendSettings?.autoClear ? s.active : ''}`}
                  title="各ステップ前に /clear を実行"
                >
                  <span className={`${s.checkIcon} ${sendSettings?.autoClear ? s.checked : ''}`}>
                    {sendSettings?.autoClear && '✓'}
                  </span>
                  /clear
                </button>
              </div>
            )}

          </div>
        )}
        {/* ファイルリンク（右寄せ・ワークフローコンテナの外） */}
        {onAddToQueue && onOpenWorkflowFile && !hideWorkflowControls && (
          <div className={s.fileLinks}>
            {WORKFLOW_SKILLS.filter((sk): sk is typeof sk & { file: string } => 'file' in sk).map((skill) => (
              <button
                key={`file-${skill.value}`}
                type="button"
                onClick={() => onOpenWorkflowFile(skill.file)}
                disabled={disabled}
                className={s.fileLink}
                title={`${skill.label.toLowerCase()}.md を開く`}
              >
                <svg className={s.fileLinkIcon} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
                {skill.label.toLowerCase()}.md
              </button>
            ))}
          </div>
        )}

        {/* テキスト入力エリア */}
        <form onSubmit={handleSubmit} className={s.formWrapper}>
          <div className={s.textareaWrapper}>
            <textarea
              ref={inputRef}
              value={command}
              onChange={(e) => setCommand(e.target.value)}
              onKeyDown={handleKeyDown}
              onPaste={handlePaste}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
              onCompositionStart={handleCompositionStart}
              onCompositionEnd={handleCompositionEnd}
              placeholder={
                isInputDisabled
                  ? 'リポジトリを選択してください...'
                  : providerInfo.placeholder
              }
              className={`${s.textarea} ${isDragOver ? s.dragOver : ''}`}
              disabled={isInputDisabled || isUploadingFile}
            />
            {isUploadingFile && (
              <div className={s.uploadOverlay}>
                <div className={s.uploadContent}>
                  <svg
                    className={s.spinner}
                    xmlns="http://www.w3.org/2000/svg"
                    fill="none"
                    viewBox="0 0 24 24"
                  >
                    <circle
                      className={s.spinnerCircle}
                      cx="12"
                      cy="12"
                      r="10"
                      stroke="currentColor"
                      strokeWidth="4"
                    ></circle>
                    <path
                      className={s.spinnerPath}
                      fill="currentColor"
                      d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                    ></path>
                  </svg>
                  <span className={s.uploadText}>ファイルをアップロード中...</span>
                </div>
              </div>
            )}
            {/* 入力クリアボタン（右上） */}
            {command && (
              <button
                type="button"
                onClick={handleClearInput}
                disabled={isInputDisabled}
                className={s.clearInputButton}
                title="入力内容をクリア"
              >
                <svg
                  className={s.clearInputIcon}
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
              </button>
            )}
          </div>
          {/* 履歴ナビ（テキストエリア右側に縦並び） */}
          <div className={s.historySide}>
            <button
              type="button"
              onClick={navigateHistoryUp}
              disabled={isInputDisabled || loadHistory().length === 0}
              className={s.historyButton}
              title="前の履歴"
              aria-label="前の履歴"
            >
              <svg className={s.historyIcon} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 15l7-7 7 7" />
              </svg>
            </button>
            <button
              type="button"
              onClick={navigateHistoryDown}
              disabled={isInputDisabled || historyIndex === -1}
              className={s.historyButton}
              title="次の履歴"
              aria-label="次の履歴"
            >
              <svg className={s.historyIcon} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
            </button>
          </div>
        </form>

        {/* テキストエリア下のツールバー（インデント / ファイルアップロード） */}
        <div className={s.inputToolbar}>
          <div className={s.toolbarLeft}>
            <button
              type="button"
              onPointerDown={(e) => e.preventDefault()}
              onClick={() => handleTabKey('outdent')}
              disabled={isInputDisabled}
              className={`${s.historyButton} ${s.mobileOnly}`}
              title="アウトデント (Shift+Tab)"
              aria-label="アウトデント"
            >
              <svg
                className={s.historyIcon}
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M11 19l-7-7 7-7M20 19l-7-7 7-7"
                />
              </svg>
            </button>
            <button
              type="button"
              onPointerDown={(e) => e.preventDefault()}
              onClick={() => handleTabKey('indent')}
              disabled={isInputDisabled}
              className={`${s.historyButton} ${s.mobileOnly}`}
              title="インデント (Tab)"
              aria-label="インデント"
            >
              <svg
                className={s.historyIcon}
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M4 5l7 7-7 7M13 5l7 7-7 7"
                />
              </svg>
            </button>
          </div>
          <div className={s.toolbarRight}>
            {onPasteFile && (
              <>
                <input
                  ref={fileInputRef}
                  type="file"
                  multiple
                  onChange={handleFileSelected}
                  className={s.hiddenFileInput}
                />
                <button
                  type="button"
                  onClick={handleUploadClick}
                  disabled={disabled || isUploadingFile}
                  className={s.historyButton}
                  title="ファイルをアップロード（末尾にパスを追加）"
                  aria-label="ファイルをアップロード"
                >
                  <svg
                    className={s.historyIcon}
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13"
                    />
                  </svg>
                </button>
              </>
            )}
          </div>
        </div>

        {/* ループ設定アコーディオン（送信バーの直上に展開） */}
        {onAddToQueue && isPrimary && addToQueue && isLoopExpanded && (
          <div className={s.loopAccordion}>
            <button
              type="button"
              onClick={() => handleSettingChange('loopEnabled', !loopEnabled)}
              className={s.loopToggleRow}
            >
              <span className={s.loopToggleText}>
                <Repeat size={13} />
                ループ送信
              </span>
              <div className={`${s.toggleTrack} ${loopEnabled ? s.on : s.off}`}>
                <div
                  className={`${s.toggleThumb} ${loopEnabled ? s.on : s.off}`}
                />
              </div>
            </button>
            <div className={s.loopAccordionHint}>
              完了後に同じプロンプトを繰り返し送信します
            </div>

            <div className={s.loopAccordionBody}>
              <LoopSettingsFields
                value={{
                  judge: loopJudge,
                  judgeEveryN: loopJudgeEveryN,
                  intervalSec: loopIntervalMin * 60,
                }}
                disabled={!loopEnabled}
                onChange={handleLoopSettingsChange}
              />
            </div>
          </div>
        )}

        {/* 送信セクション（プライマリのみキューUIあり） */}
        {onAddToQueue && isPrimary && (
          <div className={s.sendSection} ref={sendSectionRef}>
            <div className={s.sendOptionsBar}>
              {/* キュートグル（/clear などと同じく押すとハイライトするトグル） */}
              <button
                type="button"
                onClick={() => handleSettingChange('addToQueue', !addToQueue)}
                disabled={disabled}
                className={`${s.queueToggle} ${addToQueue ? s.active : ''}`}
                title={
                  addToQueue
                    ? 'キューに追加モード: ON'
                    : 'キューに追加モード: OFF'
                }
              >
                <svg
                  className={s.queueIcon}
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M4 6h16M4 12h16M4 18h16"
                  />
                </svg>
                キュー
              </button>

              {/* キューオプション（キューON時のみ表示） */}
              {addToQueue && (
                <>
                  <div className={s.optionDivider} />

                  {/* モデル選択（頻繁に使うため先頭に配置） */}
                  <div className={s.modelDropdownWrapper} ref={modelDropdownRef}>
                    <button
                      ref={modelButtonRef}
                      type="button"
                      onClick={() =>
                        setIsModelDropdownOpen(!isModelDropdownOpen)
                      }
                      disabled={disabled}
                      className={`${s.modelButton} ${model ? s.active : ''}`}
                      title="モデル選択"
                    >
                      {resolveModelLabel(model, modelOptions)}
                      <svg
                        className={`${s.modelDropdownIcon} ${isModelDropdownOpen ? s.open : ''}`}
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2}
                          d="M19 9l-7 7-7-7"
                        />
                      </svg>
                    </button>

                    {isModelDropdownOpen && (
                      <div
                        className={s.modelDropdown}
                        style={{
                          top: `${dropdownPosition.top}px`,
                          left: `${dropdownPosition.left}px`,
                          transform: 'translateY(-100%)',
                        }}
                      >
                        {modelOptions.map((opt) => (
                          <div
                            key={opt.value || 'unset'}
                            className={s.modelOptionRow}
                          >
                            <button
                              type="button"
                              onClick={() => {
                                handleSettingChange('model', opt.value);
                                setIsModelDropdownOpen(false);
                                setIsAddModelOpen(false);
                              }}
                              className={`${s.modelOption} ${
                                model === opt.value ? s.selected : ''
                              }`}
                              title={opt.value || '未指定'}
                            >
                              {opt.label}
                            </button>
                            {opt.source === 'custom' && (
                              <button
                                type="button"
                                onClick={() => removeCustomModel(opt.value)}
                                className={s.modelOptionDelete}
                                title="このカスタムモデルを削除"
                                aria-label="カスタムモデルを削除"
                              >
                                <svg
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
                              </button>
                            )}
                          </div>
                        ))}

                        {/* API 取得状態の注記 */}
                        {anthropicStatus === 'unconfigured' && (
                          <div className={s.modelHint}>API未設定</div>
                        )}
                        {anthropicStatus === 'error' && (
                          <div className={s.modelHint}>API取得失敗</div>
                        )}

                        <div className={s.modelDropdownSeparator} />

                        {/* カスタムモデル追加 */}
                        {isAddModelOpen ? (
                          <div className={s.modelAddForm}>
                            <input
                              type="text"
                              value={newModelId}
                              onChange={(e) => setNewModelId(e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') {
                                  e.preventDefault();
                                  handleAddCustomModel();
                                }
                              }}
                              placeholder="モデルID（必須）"
                              className={s.modelAddInput}
                              autoFocus
                            />
                            <input
                              type="text"
                              value={newModelName}
                              onChange={(e) => setNewModelName(e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') {
                                  e.preventDefault();
                                  handleAddCustomModel();
                                }
                              }}
                              placeholder="表示名（任意）"
                              className={s.modelAddInput}
                            />
                            <div className={s.modelAddActions}>
                              <button
                                type="button"
                                onClick={() => {
                                  setIsAddModelOpen(false);
                                  setNewModelId('');
                                  setNewModelName('');
                                }}
                                className={s.modelAddCancel}
                              >
                                キャンセル
                              </button>
                              <button
                                type="button"
                                onClick={handleAddCustomModel}
                                disabled={!newModelId.trim()}
                                className={s.modelAddSubmit}
                              >
                                追加
                              </button>
                            </div>
                          </div>
                        ) : (
                          <button
                            type="button"
                            onClick={() => setIsAddModelOpen(true)}
                            className={s.modelAddTrigger}
                          >
                            ＋ カスタムモデルを追加…
                          </button>
                        )}
                      </div>
                    )}
                  </div>

                  {/* /clear */}
                  <button
                    type="button"
                    onClick={() =>
                      handleSettingChange('sendClear', !sendClearBefore)
                    }
                    disabled={disabled}
                    className={`${s.optionButton} ${sendClearBefore ? s.active : ''}`}
                    title="/clear: 送信前にコンテキストをクリア"
                  >
                    /clear
                  </button>

                  {/* /commit */}
                  <button
                    type="button"
                    onClick={() =>
                      handleSettingChange('sendCommit', !sendCommitAfter)
                    }
                    disabled={disabled}
                    className={`${s.optionButton} ${sendCommitAfter ? s.active : ''}`}
                    title="/commit: 完了後に自動コミット"
                  >
                    /commit
                  </button>

                  {/* ループ（タップで下のアコーディオンを開閉） */}
                  <button
                    type="button"
                    onClick={() => setIsLoopExpanded(!isLoopExpanded)}
                    disabled={disabled}
                    className={`${s.optionButton} ${loopEnabled ? s.active : ''}`}
                    title="ループ: 完了後に同じプロンプトを繰り返し送信"
                  >
                    <Repeat size={12} />
                    {loopEnabled
                      ? loopJudge === 'none'
                        ? '無限'
                        : `${loopJudge === 'ai' ? 'AI' : '確認'}・${loopJudgeEveryN}周`
                      : 'ループ'}
                    <svg
                      className={`${s.modelDropdownIcon} ${isLoopExpanded ? s.open : ''}`}
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M19 9l-7 7-7-7"
                      />
                    </svg>
                  </button>
                </>
              )}
            </div>

            {/* 送信ボタン */}
            <button
              type="button"
              onClick={sendCommand}
              disabled={disabled}
              className={s.submitButton}
              title={
                addToQueue ? 'キューに追加 (Ctrl+Enter)' : '送信 (Ctrl+Enter)'
              }
            >
              {/* 常に矢印アイコンを表示 */}
              <svg
                className={s.submitIcon}
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
              <span className={s.submitText}>
                {addToQueue ? '追加' : '送信'}
              </span>
            </button>
          </div>
        )}

        {/* キュー機能がない場合 or 非プライマリのシンプルな送信セクション */}
        {(!onAddToQueue || !isPrimary) && (
          <div className={s.simpleSendSection}>
            <div className={s.simpleSendSpacer} />
            <button
              type="button"
              onClick={sendCommand}
              disabled={disabled}
              className={s.submitButton}
              title="送信 (Ctrl+Enter)"
            >
              <svg
                className={s.simpleSubmitIcon}
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
              送信
            </button>
          </div>
        )}
      </div>
    );
  }
);

TextInput.displayName = 'TextInput';

export default TextInput;
