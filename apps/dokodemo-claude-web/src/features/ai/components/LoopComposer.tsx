import React, {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from 'react';
import { MessageSquarePlus, Paperclip, Repeat, X } from 'lucide-react';
import type {
  AutoCommitMode,
  CommandSendSettings,
} from '@/app/hooks/useAppSettings';
import { useQueueContext } from '@/features/ai/providers/QueueProvider';
import LoopSettingsFields, {
  DEFAULT_PLANNING_MODEL,
  DEFAULT_PLANNING_EVERY_N,
  DEFAULT_PLANNING_PROMPT,
} from './LoopSettingsFields';
import type { LoopSettingsValue } from './LoopSettingsFields';
import SketchButton from './SketchButton';
import s from './LoopComposer.module.scss';

// ループのプロンプトのサンプル。タップで入力欄に挿入するだけの補助ボタン
// （スキルコマンドを手入力する手間を省く。設定には触らない）
const LOOP_SAMPLE_PROMPTS = [
  { label: 'autopilot', prompt: '/dokodemo-claude-tools:autopilot' },
] as const;

/** 起動前のプロンプト下書きの保存キー（リポジトリ単位） */
function getDraftKey(repository: string): string {
  const encoded = repository
    ? btoa(repository).replace(/[/+=]/g, '_')
    : 'default';
  return `ai-loop-prompt-${encoded}`;
}

export interface LoopComposerRef {
  focus: () => void;
  insertFiles: (files: File[]) => Promise<void>;
}

interface LoopComposerProps {
  /** 送信操作の無効化フラグ（ネットワーク切断時など） */
  disabled?: boolean;
  /** 入力欄自体の無効化フラグ（リポジトリ未選択など） */
  inputDisabled?: boolean;
  /** 現在のリポジトリパス（下書き保存用） */
  currentRepository?: string;
  /** 送信設定（ループ設定はここに保持される） */
  sendSettings?: CommandSendSettings;
  onSendSettingsChange?: (settings: CommandSendSettings) => void;
  /** キュー追加ハンドラ（ループの開始に使う） */
  onAddToQueue?: (
    command: string,
    sendClearBefore: boolean,
    autoCommit: AutoCommitMode,
    model?: string,
    loop?: {
      judge: 'ai' | 'user' | 'none';
      judgeEveryN: number;
      intervalSec: number;
      judgeCriteria?: string;
      reviewBlocking?: 'ai' | 'always' | 'never';
      planning?: { everyN: number; model: string; prompt: string };
    }
  ) => void;
  /** ファイルをアップロードしてパスを返す */
  onPasteFile?: (file: File) => Promise<string | undefined>;
  /** アップロード中フラグ */
  isUploadingFile?: boolean;
}

/**
 * ループ専用の入力欄。
 *
 * 汎用のプロンプト入力欄（CommandInput）とは排他で、送信モードが「ループ」の
 * ときだけ描画される。入力欄はひとつだけで、ループの状態によって役割が入れ替わる：
 *
 * - 起動前: ループのプロンプト（毎周回このプロンプトが送られる）＋ループ設定
 * - 稼働中: ループへの指示（次のサイクル間の反映ターンで計画に反映される）
 *
 * 稼働中ループの設定変更はキューアイテムの編集から行う（ここでは出さない。
 * 出しても稼働中のループには反映されず、次回開始時の設定になるだけのため）。
 */
const LoopComposer = forwardRef<LoopComposerRef, LoopComposerProps>(
  (
    {
      disabled = false,
      inputDisabled,
      currentRepository = '',
      sendSettings,
      onSendSettingsChange,
      onAddToQueue,
      onPasteFile,
      isUploadingFile = false,
    },
    ref
  ) => {
    const { promptQueue, addLoopFeedback, removeLoopFeedback } =
      useQueueContext();

    // ループアイテムは 1 キューに 1 つまで
    const loopItem = promptQueue.find((item) => item.loop);
    const loop = loopItem?.loop;
    const isRunning = !!loopItem && !!loop;

    const isInputDisabled = inputDisabled ?? disabled;

    const [text, setText] = useState('');
    const inputRef = useRef<HTMLTextAreaElement>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);

    // 起動前の下書きはリポジトリ単位で復元する（稼働中の指示は保存しない）
    useEffect(() => {
      if (isRunning) return;
      try {
        setText(localStorage.getItem(getDraftKey(currentRepository)) || '');
      } catch {
        setText('');
      }
    }, [currentRepository, isRunning]);

    useEffect(() => {
      if (isRunning) return;
      try {
        localStorage.setItem(getDraftKey(currentRepository), text);
      } catch {
        // 保存できなくても入力自体は続けられるので無視する
      }
    }, [text, currentRepository, isRunning]);

    // 稼働中へ切り替わったら、起動に使ったプロンプトの残りを消す
    useEffect(() => {
      if (isRunning) setText('');
    }, [isRunning]);

    // アップロードしたファイルのパスをカーソル位置へ挿入する。
    // 前後のテキストと連結されるとパスとして読めなくなるため空白を挟む
    const insertPaths = useCallback((paths: string[]) => {
      if (paths.length === 0) return;
      setText((prev) => {
        const el = inputRef.current;
        const start = el?.selectionStart ?? prev.length;
        const end = el?.selectionEnd ?? prev.length;
        const before = prev.slice(0, start);
        const after = prev.slice(end);
        const prefix = before && !/\s$/.test(before) ? ' ' : '';
        const suffix = after && !/^\s/.test(after) ? ' ' : '';
        return before + prefix + paths.join(' ') + suffix + after;
      });
    }, []);

    const uploadAndInsert = useCallback(
      async (files: File[]) => {
        if (files.length === 0 || !onPasteFile) return;

        const paths: string[] = [];
        for (const file of files) {
          const p = await onPasteFile(file);
          if (p) paths.push(p);
        }
        insertPaths(paths);
      },
      [onPasteFile, insertPaths]
    );

    useImperativeHandle(ref, () => ({
      focus: () => inputRef.current?.focus(),
      insertFiles: async (files: File[]) => {
        inputRef.current?.focus();
        await uploadAndInsert(files);
      },
    }));

    // クリップボードから画像をペーストしたらアップロードしてパスを挿入する
    const handlePaste = useCallback(
      async (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
        const items = e.clipboardData?.items;
        if (!items || !onPasteFile) return;

        for (const item of Array.from(items)) {
          if (item.type.startsWith('image/')) {
            e.preventDefault();
            const file = item.getAsFile();
            if (file) {
              const path = await onPasteFile(file);
              if (path) insertPaths([path]);
            }
            return;
          }
        }
      },
      [onPasteFile, insertPaths]
    );

    const handleFileSelected = useCallback(
      (e: React.ChangeEvent<HTMLInputElement>) => {
        const files = Array.from(e.target.files ?? []);
        e.target.value = '';
        void uploadAndInsert(files);
      },
      [uploadAndInsert]
    );

    // --- 設定値（sendSettings から展開） ---
    const sendClearBefore = sendSettings?.sendClear ?? false;
    const autoCommit: AutoCommitMode = sendSettings?.autoCommit ?? 'off';
    const model = sendSettings?.model ?? '';
    const loopSettings: LoopSettingsValue = {
      judge: sendSettings?.loopJudge ?? 'none',
      judgeEveryN: Math.max(1, sendSettings?.loopJudgeEveryN ?? 1),
      intervalSec: Math.max(0, sendSettings?.loopIntervalMin ?? 0) * 60,
      judgeCriteria: sendSettings?.loopJudgeCriteria ?? '',
      reviewBlocking: sendSettings?.loopReviewBlocking ?? 'ai',
      planningEnabled: sendSettings?.loopPlanningEnabled ?? false,
      planningEveryN: Math.max(
        1,
        sendSettings?.loopPlanningEveryN ?? DEFAULT_PLANNING_EVERY_N
      ),
      planningModel: sendSettings?.loopPlanningModel || DEFAULT_PLANNING_MODEL,
      planningPrompt: sendSettings?.loopPlanningPrompt ?? '',
    };

    const handleSettingChange = <K extends keyof CommandSendSettings>(
      key: K,
      value: CommandSendSettings[K]
    ) => {
      if (onSendSettingsChange && sendSettings) {
        onSendSettingsChange({ ...sendSettings, [key]: value });
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
          loopJudgeCriteria: next.judgeCriteria,
          loopReviewBlocking: next.reviewBlocking,
          loopPlanningEnabled: next.planningEnabled,
          loopPlanningEveryN: next.planningEveryN,
          loopPlanningModel: next.planningModel,
          loopPlanningPrompt: next.planningPrompt,
        });
      }
    };

    // 起動: 入力をループ付きでキューへ積む
    const startLoop = () => {
      const trimmed = text.trim();
      if (!trimmed || !onAddToQueue || disabled) return;

      onAddToQueue(trimmed, sendClearBefore, autoCommit, model || undefined, {
        judge: loopSettings.judge,
        judgeEveryN: loopSettings.judgeEveryN,
        intervalSec: loopSettings.intervalSec,
        judgeCriteria: loopSettings.judgeCriteria.trim() || undefined,
        reviewBlocking: loopSettings.reviewBlocking,
        planning: loopSettings.planningEnabled
          ? {
              everyN: loopSettings.planningEveryN,
              model: loopSettings.planningModel,
              // 空欄ならデフォルトの計画プロンプトを使う
              prompt:
                loopSettings.planningPrompt.trim() || DEFAULT_PLANNING_PROMPT,
            }
          : undefined,
      });

      setText('');
      try {
        localStorage.removeItem(getDraftKey(currentRepository));
      } catch {
        // 消せなくても次の入力で上書きされるため無視する
      }
    };

    // 稼働中: 指示を未反映リストへ積む
    const submitInstruction = () => {
      const trimmed = text.trim();
      if (!trimmed || !loopItem) return;
      addLoopFeedback(loopItem.id, trimmed);
      setText('');
    };

    const submit = () => {
      if (isRunning) submitInstruction();
      else startLoop();
    };

    const instructions = loop?.feedback ?? [];
    const sentCount = loop?.feedbackActive ?? 0;
    const canSubmit = !!text.trim() && !isUploadingFile && !disabled;

    return (
      <div className={s.root}>
        <div className={s.header}>
          {isRunning ? (
            <>
              <MessageSquarePlus size={14} />
              <span className={s.headerTitle}>ループへの指示</span>
              <span className={s.headerHint}>次のサイクル間で計画に反映</span>
              {instructions.length > 0 && (
                <span className={s.count}>{instructions.length}</span>
              )}
            </>
          ) : (
            <>
              <Repeat size={14} />
              <span className={s.headerTitle}>ループのプロンプト</span>
              <span className={s.headerHint}>毎周回このプロンプトを送信</span>
            </>
          )}
        </div>

        {/* サンプルプロンプト（タップで入力欄に挿入） */}
        <div className={s.sampleRow}>
          {LOOP_SAMPLE_PROMPTS.map((sample) => (
            <button
              key={sample.label}
              type="button"
              onClick={() => setText(sample.prompt)}
              disabled={isInputDisabled}
              className={s.sampleChip}
              title={`「${sample.prompt}」を入力欄に挿入`}
            >
              {sample.label}
            </button>
          ))}
        </div>

        <div className={s.inputRow}>
          <textarea
            ref={inputRef}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onPaste={handlePaste}
            onKeyDown={(e) => {
              // 起動は誤爆すると周回が始まるため Ctrl/Cmd+Enter のみ。
              // 指示の追加は軽い操作なので Enter でも送れる
              if (
                e.key === 'Enter' &&
                (e.ctrlKey || e.metaKey) &&
                !e.nativeEvent.isComposing
              ) {
                e.preventDefault();
                submit();
                return;
              }
              if (
                isRunning &&
                e.key === 'Enter' &&
                !e.shiftKey &&
                !e.nativeEvent.isComposing
              ) {
                e.preventDefault();
                submit();
              }
            }}
            placeholder={
              isInputDisabled
                ? 'リポジトリを選択してください...'
                : isRunning
                  ? 'ループへの指示（画像はペースト / 鉛筆・クリップで添付）'
                  : '繰り返し送信するプロンプトを入力してください'
            }
            className={s.input}
            rows={isRunning ? 2 : 3}
            disabled={isInputDisabled || isUploadingFile}
          />
        </div>

        <div className={s.actionRow}>
          {/* 添付（スケッチ / ファイル）。入力欄と同じ行には置かず操作行にまとめる */}
          {onPasteFile && (
            <div className={s.iconRow}>
              <input
                ref={fileInputRef}
                type="file"
                multiple
                onChange={handleFileSelected}
                className={s.hiddenFileInput}
              />
              <SketchButton
                onComplete={(file) => void uploadAndInsert([file])}
                disabled={disabled || isUploadingFile}
                className={s.uploadButton}
                size="sm"
              />
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={disabled || isUploadingFile}
                className={s.uploadButton}
                title="ファイルをアップロード（入力欄にパスを挿入）"
                aria-label="ファイルをアップロード"
              >
                <Paperclip size={14} />
              </button>
            </div>
          )}

          {/* 周回ごとの修飾（起動前のみ。稼働中の変更はキュー編集から） */}
          {!isRunning && (
            <div className={s.optionGroup}>
              <button
                type="button"
                onClick={() =>
                  handleSettingChange('sendClear', !sendClearBefore)
                }
                disabled={disabled}
                className={`${s.optionButton} ${sendClearBefore ? s.active : ''}`}
                title="/clear: 各周回の送信前にコンテキストをクリア"
              >
                <span className={s.optLabel}>前</span>/clear
              </button>
              <button
                type="button"
                onClick={() =>
                  handleSettingChange(
                    'autoCommit',
                    autoCommit === 'off'
                      ? 'commit'
                      : autoCommit === 'commit'
                        ? 'commit-push'
                        : 'off'
                  )
                }
                disabled={disabled}
                className={`${s.optionButton} ${autoCommit !== 'off' ? s.active : ''}`}
                title="各周回の完了後: なし → /commit（push しない） → /commit+push"
              >
                <span className={s.optLabel}>後</span>
                {autoCommit === 'commit-push' ? '/commit+push' : '/commit'}
              </button>
            </div>
          )}

          <button
            type="button"
            onClick={submit}
            disabled={!canSubmit}
            className={`${s.submitButton} ${isRunning ? s.submitSecondary : ''}`}
            title={
              isRunning
                ? '指示を追加 (Enter)'
                : 'ループを開始 (Ctrl+Enter)'
            }
          >
            {!isRunning && <Repeat size={14} className={s.submitIcon} />}
            {isRunning ? '指示を追加' : 'ループ開始'}
          </button>
        </div>

        {/* 未反映の指示一覧（稼働中のみ） */}
        {isRunning &&
          (instructions.length > 0 ? (
            <div className={s.list}>
              {instructions.map((item, index) => {
                const isSent = index < sentCount;
                return (
                  <div
                    key={`${index}-${item}`}
                    className={`${s.item} ${isSent ? s.itemSent : ''}`}
                  >
                    <span className={s.itemText}>{item}</span>
                    {isSent ? (
                      <span className={s.itemStatus}>反映中</span>
                    ) : (
                      <button
                        type="button"
                        onClick={() => removeLoopFeedback(loopItem.id, index)}
                        className={s.itemRemove}
                        title="この指示を削除"
                      >
                        <X size={12} />
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          ) : (
            <p className={s.emptyText}>未反映の指示はありません</p>
          ))}

        {/* ループ設定（起動前のみ。稼働中は反映先が無いので出さない） */}
        {!isRunning && (
          <div className={s.settings}>
            <LoopSettingsFields
              value={loopSettings}
              disabled={disabled}
              onChange={handleLoopSettingsChange}
              workModel={model}
              onWorkModelChange={(v) => handleSettingChange('model', v)}
              twoColumnOnPc
            />
          </div>
        )}
      </div>
    );
  }
);

LoopComposer.displayName = 'LoopComposer';

export default LoopComposer;
