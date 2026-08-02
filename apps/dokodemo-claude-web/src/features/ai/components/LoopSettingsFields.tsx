import React, { useState } from 'react';
import { Minus, Plus } from 'lucide-react';
import { useModelOptions } from '@/features/ai/hooks/useModelOptions';
import Collapse from '@/shared/components/Collapse';
import HintTooltip from '@/shared/components/HintTooltip';
import s from './LoopSettingsFields.module.scss';

// ループ設定の値（判断方式・判断間隔・再送待機秒数・AI 判定基準・定期プランニング）
export interface LoopSettingsValue {
  judge: 'ai' | 'user' | 'none';
  judgeEveryN: number;
  intervalSec: number;
  judgeCriteria: string;
  // 評価リクエスト発行時にループを停止するかのポリシー
  reviewBlocking: 'ai' | 'always' | 'never';
  // 定期プランニング（N 周ごとに強いモデルで計画ターンを 1 回差し込む）
  planningEnabled: boolean;
  planningEveryN: number;
  planningModel: string;
  planningPrompt: string;
}

// プランニングのデフォルト値（UI 初期値として使用）
export const DEFAULT_PLANNING_MODEL = 'claude-opus-4-8';
export const DEFAULT_PLANNING_EVERY_N = 5;
export const DEFAULT_PLANNING_PROMPT =
  'ここまでのループの進捗と現状の課題を整理してください。そのうえで残りの作業の優先順位と進め方を見直し、以降の周回が従うべき方針を簡潔にまとめてください。';

// プランニングプロンプトのサンプル。タップで入力欄に挿入するだけの補助ボタン
const PLANNING_SAMPLE_PROMPTS = [
  { label: 'autopilot-plan', prompt: '/dokodemo-claude-tools:autopilot-plan' },
] as const;

// 評価リクエスト発行時の停止ポリシーの選択肢
const REVIEW_BLOCKING_OPTIONS: {
  value: LoopSettingsValue['reviewBlocking'];
  label: string;
}[] = [
  { value: 'ai', label: 'AIに任せる' },
  { value: 'always', label: '常に停止' },
  { value: 'never', label: '停止しない' },
];

// 継続判断が有効なときの方式（トグル OFF = 'none' は選択肢に出さない）
const JUDGE_MODE_OPTIONS: {
  value: Exclude<LoopSettingsValue['judge'], 'none'>;
  label: string;
  caption: string;
}[] = [
  { value: 'ai', label: 'AI 判断', caption: 'AI が継続するか判断します' },
  { value: 'user', label: '確認', caption: '周回ごとに継続確認を求めます' },
];

interface StepperProps {
  value: number;
  min: number;
  suffix: string;
  disabled?: boolean;
  onChange: (value: number) => void;
}

/**
 * タッチ操作向けの数値ステッパー
 * 中央の数値は直接入力も可能（確定はフォーカスアウト / Enter 時）
 */
const Stepper: React.FC<StepperProps> = ({
  value,
  min,
  suffix,
  disabled,
  onChange,
}) => {
  // 入力中の一時文字列（null なら value をそのまま表示）
  const [draft, setDraft] = useState<string | null>(null);

  const commitDraft = () => {
    if (draft === null) return;
    const parsed = parseInt(draft, 10);
    onChange(Number.isNaN(parsed) ? min : Math.max(min, parsed));
    setDraft(null);
  };

  return (
    <div className={s.stepper}>
      <button
        type="button"
        onClick={() => onChange(Math.max(min, value - 1))}
        disabled={disabled || value <= min}
        className={s.stepperButton}
        aria-label="減らす"
      >
        <Minus size={14} />
      </button>
      <div className={s.stepperValue}>
        <input
          type="text"
          inputMode="numeric"
          value={draft ?? String(value)}
          onChange={(e) => setDraft(e.target.value.replace(/[^0-9]/g, ''))}
          onBlur={commitDraft}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              commitDraft();
            }
          }}
          disabled={disabled}
          className={s.stepperInput}
        />
        <span className={s.stepperSuffix}>{suffix}</span>
      </div>
      <button
        type="button"
        onClick={() => onChange(value + 1)}
        disabled={disabled}
        className={s.stepperButton}
        aria-label="増やす"
      >
        <Plus size={14} />
      </button>
    </div>
  );
};

interface ToggleFieldProps {
  label: string;
  checked: boolean;
  disabled?: boolean;
  onToggle: () => void;
  /** ラベル横の「?」で出す説明文 */
  hint: string;
}

/**
 * ラベル＋トグルの 1 セクション見出し（継続の判断・定期プランニング共通）。
 * 「?」ボタンを内側に置くためラベル行自体はボタンにせず、
 * トグル本体だけをボタンにする（button の入れ子は不正なため）
 */
const ToggleField: React.FC<ToggleFieldProps> = ({
  label,
  checked,
  disabled,
  onToggle,
  hint,
}) => (
  <div className={s.toggleRow}>
    <span className={`${s.fieldLabel} ${s.sectionLabel}`}>
      {label}
      <HintTooltip text={hint} />
    </span>
    <button
      type="button"
      onClick={onToggle}
      disabled={disabled}
      aria-pressed={checked}
      aria-label={label}
      className={s.toggleButton}
    >
      <span className={`${s.toggleTrack} ${checked ? s.on : s.off}`}>
        <span className={`${s.toggleThumb} ${checked ? s.on : s.off}`} />
      </span>
    </button>
  </div>
);

interface LoopSettingsFieldsProps {
  value: LoopSettingsValue;
  disabled?: boolean;
  onChange: (next: LoopSettingsValue) => void;
  /**
   * 作業ターン（通常周回）のモデル。キューアイテムの「モデル」設定と同一の値を
   * 共有し、ここでの変更はキュー側のモデル設定にも反映される。
   */
  workModel?: string;
  onWorkModelChange?: (model: string) => void;
  /**
   * PC（lg-up）でフィールドを 2 カラムに並べる。
   * 横幅が取れる送信バー直下のアコーディオン用。狭いキューアイテム編集では渡さない。
   */
  twoColumnOnPc?: boolean;
}

/**
 * ループ設定の編集フィールド（判断方式・判断間隔・再送待機）
 * 新規追加ポップオーバーとキューアイテム編集の両方から使う共通 UI
 */
const LoopSettingsFields: React.FC<LoopSettingsFieldsProps> = ({
  value,
  disabled,
  onChange,
  workModel,
  onWorkModelChange,
  twoColumnOnPc,
}) => {
  const selectedJudgeMode = JUDGE_MODE_OPTIONS.find(
    (o) => o.value === value.judge
  );
  const intervalMin = Math.floor(value.intervalSec / 60);
  // プランニングのモデル選択肢（「未指定」は除外。モデル指定が本機能の目的のため）
  const { options: modelOptions } = useModelOptions();
  const planningModelOptions = modelOptions.filter((o) => o.value);
  // 2 カラム指定時のみグリッド化するクラス（既定は縦積みのまま）
  const twoColumnClass = twoColumnOnPc ? s.twoColumnOnPc : '';

  return (
    <div
      className={`${s.root} ${twoColumnOnPc ? s.wideOnPc : ''} ${
        disabled ? s.disabled : ''
      }`}
    >
      {/* 基本設定（PC 2 カラム時はここがグリッドになる） */}
      <div className={`${s.section} ${s.fieldGroup} ${twoColumnClass}`}>
        {/* 作業モデル（各周回で使うモデル。キューの「モデル」設定と共有） */}
        {onWorkModelChange && (
          <div className={s.field}>
            {/* 2 カラム時は隣の「継続の判断」と入力の上端を揃えるため 1 行に並べる */}
            <div className={twoColumnOnPc ? s.rowFieldOnPc : ''}>
              <div className={s.fieldLabel}>
                作業モデル
                <HintTooltip text="周回ごとの作業ターンで使うモデル。未指定なら現在のモデルのまま" />
              </div>
              <select
                value={workModel ?? ''}
                onChange={(e) => onWorkModelChange(e.target.value)}
                disabled={disabled}
                className={s.selectInput}
              >
                {/* 選択肢に無い値（削除済みカスタムモデル等）もそのまま表示する */}
                {workModel &&
                  !modelOptions.some((o) => o.value === workModel) && (
                    <option value={workModel}>{workModel}</option>
                  )}
                {modelOptions.map((opt) => (
                  <option key={opt.value || 'unset'} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>
          </div>
        )}

        {/* 再送までの待機時間 */}
        <div className={s.rowField}>
          <div className={s.fieldLabel}>再送待機</div>
          <Stepper
            value={intervalMin}
            min={0}
            suffix="分"
            disabled={disabled}
            onChange={(n) => onChange({ ...value, intervalSec: n * 60 })}
          />
        </div>

        {/* 評価リクエスト発行時にループを停止するか */}
        <div className={s.rowField}>
          <div className={s.fieldLabel}>
            評価での停止
            <HintTooltip text="AIが評価リクエスト（受信箱への確認依頼）を出したとき、回答が届くまでループを止めるか。「AIに任せる」は後続が評価結果に依存するとAIが判断したときだけ止まります" />
          </div>
          <select
            value={value.reviewBlocking}
            onChange={(e) =>
              onChange({
                ...value,
                reviewBlocking: e.target
                  .value as LoopSettingsValue['reviewBlocking'],
              })
            }
            disabled={disabled}
            className={`${s.selectInput} ${s.selectSlim}`}
          >
            {REVIEW_BLOCKING_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* 継続の判断（トグルで有効化。OFF = 停止するまで無限に繰り返し） */}
      <div className={s.section}>
        <ToggleField
          label="継続の判断"
          checked={value.judge !== 'none'}
          disabled={disabled}
          onToggle={() =>
            onChange({
              ...value,
              judge: value.judge === 'none' ? 'ai' : 'none',
            })
          }
          hint="オフの間は停止するまで繰り返し送信します"
        />

        <Collapse open={value.judge !== 'none'}>
          <div className={`${s.subGroup} ${twoColumnClass}`}>
            <div className={s.field}>
              <div className={s.rowField}>
                <div className={s.fieldLabel}>
                  方式
                  {selectedJudgeMode && (
                    <HintTooltip text={selectedJudgeMode.caption} />
                  )}
                </div>
                <select
                  value={value.judge}
                  onChange={(e) =>
                    onChange({
                      ...value,
                      judge: e.target.value as LoopSettingsValue['judge'],
                    })
                  }
                  disabled={disabled}
                  className={`${s.selectInput} ${s.selectSlim}`}
                >
                  {JUDGE_MODE_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className={s.rowField}>
              <div className={s.fieldLabel}>判断間隔</div>
              <Stepper
                value={value.judgeEveryN}
                min={1}
                suffix="周ごと"
                disabled={disabled}
                onChange={(n) => onChange({ ...value, judgeEveryN: n })}
              />
            </div>

            {/* AI 判断の判定基準（任意・2 カラム時は全幅） */}
            {value.judge === 'ai' && (
              <div className={`${s.field} ${s.fullSpan}`}>
                <div className={s.fieldLabel}>判定基準（任意）</div>
                <textarea
                  value={value.judgeCriteria}
                  onChange={(e) =>
                    onChange({ ...value, judgeCriteria: e.target.value })
                  }
                  disabled={disabled}
                  placeholder="例: 全テストが通ったら終了。空欄ならループプロンプト自体を目標として判定"
                  rows={2}
                  className={s.criteriaTextarea}
                />
              </div>
            )}
          </div>
        </Collapse>
      </div>

      {/* 定期プランニング（トグルで有効化、子設定はラベル色でネスト） */}
      <div className={s.section}>
        <ToggleField
          label="定期プランニング"
          checked={value.planningEnabled}
          disabled={disabled}
          onToggle={() =>
            onChange({ ...value, planningEnabled: !value.planningEnabled })
          }
          hint="N 周ごとに指定モデルで計画ターンを 1 回挟み、進め方を見直します"
        />

        <Collapse open={value.planningEnabled}>
          <div className={`${s.subGroup} ${twoColumnClass}`}>
            <div className={s.rowField}>
              <div className={s.fieldLabel}>間隔</div>
              <Stepper
                value={value.planningEveryN}
                min={1}
                suffix="周ごと"
                disabled={disabled}
                onChange={(n) => onChange({ ...value, planningEveryN: n })}
              />
            </div>

            <div className={s.rowField}>
              <div className={s.fieldLabel}>モデル</div>
              <select
                value={value.planningModel}
                onChange={(e) =>
                  onChange({ ...value, planningModel: e.target.value })
                }
                disabled={disabled}
                className={`${s.selectInput} ${s.selectSlim}`}
              >
                {/* 選択肢に無い値（削除済みカスタムモデル等）もそのまま表示する */}
                {value.planningModel &&
                  !planningModelOptions.some(
                    (o) => o.value === value.planningModel
                  ) && (
                    <option value={value.planningModel}>
                      {value.planningModel}
                    </option>
                  )}
                {planningModelOptions.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>

            <div className={`${s.field} ${s.fullSpan}`}>
              <div className={s.fieldLabel}>プロンプト</div>
              {/* サンプルプロンプト（タップで入力欄に挿入） */}
              <div className={s.sampleRow}>
                {PLANNING_SAMPLE_PROMPTS.map((sample) => (
                  <button
                    key={sample.label}
                    type="button"
                    onClick={() =>
                      onChange({ ...value, planningPrompt: sample.prompt })
                    }
                    disabled={disabled}
                    className={s.sampleChip}
                    title={`「${sample.prompt}」を入力欄に挿入`}
                  >
                    {sample.label}
                  </button>
                ))}
              </div>
              <textarea
                value={value.planningPrompt}
                onChange={(e) =>
                  onChange({ ...value, planningPrompt: e.target.value })
                }
                disabled={disabled}
                placeholder={DEFAULT_PLANNING_PROMPT}
                rows={3}
                className={s.criteriaTextarea}
              />
            </div>
          </div>
        </Collapse>
      </div>
    </div>
  );
};

export default LoopSettingsFields;
