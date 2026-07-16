import React, { useState } from 'react';
import { Minus, Plus } from 'lucide-react';
import { useModelOptions } from '../hooks/useModelOptions';
import s from './LoopSettingsFields.module.scss';

// ループ設定の値（判断方式・判断間隔・再送待機秒数・AI 判定基準・定期プランニング）
export interface LoopSettingsValue {
  judge: 'ai' | 'user' | 'none';
  judgeEveryN: number;
  intervalSec: number;
  judgeCriteria: string;
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

// 判断方式の選択肢とキャプション
const JUDGE_OPTIONS: {
  value: LoopSettingsValue['judge'];
  label: string;
  caption: string;
}[] = [
  { value: 'none', label: '無限', caption: '停止するまで繰り返し送信します' },
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
}) => {
  const selectedOption = JUDGE_OPTIONS.find((o) => o.value === value.judge);
  const intervalMin = Math.floor(value.intervalSec / 60);
  // プランニングのモデル選択肢（「未指定」は除外。モデル指定が本機能の目的のため）
  const { options: modelOptions } = useModelOptions();
  const planningModelOptions = modelOptions.filter((o) => o.value);

  return (
    <div className={`${s.root} ${disabled ? s.disabled : ''}`}>
      {/* 作業モデル（各周回で使うモデル。キューの「モデル」設定と共有） */}
      {onWorkModelChange && (
        <div className={s.field}>
          <div className={s.fieldLabel}>作業モデル</div>
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
          <div className={s.fieldCaption}>
            周回ごとの作業ターンで使うモデル。未指定なら現在のモデルのまま
          </div>
        </div>
      )}

      {/* 継続の判断（プルダウン） */}
      <div className={s.field}>
        <div className={s.rowField}>
          <div className={s.fieldLabel}>継続の判断</div>
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
            {JUDGE_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>
        {selectedOption && (
          <div className={s.fieldCaption}>{selectedOption.caption}</div>
        )}
      </div>

      {/* 判断間隔（判断ありの場合のみ） */}
      {value.judge !== 'none' && (
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
      )}

      {/* AI 判断の判定基準（任意） */}
      {value.judge === 'ai' && (
        <div className={s.field}>
          <div className={s.fieldLabel}>判定基準（任意）</div>
          <textarea
            value={value.judgeCriteria}
            onChange={(e) => onChange({ ...value, judgeCriteria: e.target.value })}
            disabled={disabled}
            placeholder="例: 全テストが通ったら終了。空欄ならループプロンプト自体を目標として判定"
            rows={2}
            className={s.criteriaTextarea}
          />
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

      {/* 定期プランニング（トグルで有効化、子設定は左ボーダーでネスト） */}
      <div className={s.field}>
        <button
          type="button"
          onClick={() =>
            onChange({ ...value, planningEnabled: !value.planningEnabled })
          }
          disabled={disabled}
          className={s.toggleRow}
        >
          <span className={s.fieldLabel}>定期プランニング</span>
          <div
            className={`${s.toggleTrack} ${
              value.planningEnabled ? s.on : s.off
            }`}
          >
            <div
              className={`${s.toggleThumb} ${
                value.planningEnabled ? s.on : s.off
              }`}
            />
          </div>
        </button>
        <div className={s.fieldCaption}>
          N 周ごとに指定モデルで計画ターンを 1 回挟み、進め方を見直します
        </div>
      </div>

      {value.planningEnabled && (
        <div className={s.subGroup}>
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

          <div className={s.field}>
            <div className={s.fieldLabel}>プロンプト</div>
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
      )}
    </div>
  );
};

export default LoopSettingsFields;
