import React, { useState } from 'react';
import { Minus, Plus } from 'lucide-react';
import s from './LoopSettingsFields.module.scss';

// ループ設定の値（判断方式・判断間隔・再送待機秒数）
export interface LoopSettingsValue {
  judge: 'ai' | 'user' | 'none';
  judgeEveryN: number;
  intervalSec: number;
}

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
}

/**
 * ループ設定の編集フィールド（判断方式・判断間隔・再送待機）
 * 新規追加ポップオーバーとキューアイテム編集の両方から使う共通 UI
 */
const LoopSettingsFields: React.FC<LoopSettingsFieldsProps> = ({
  value,
  disabled,
  onChange,
}) => {
  const selectedOption = JUDGE_OPTIONS.find((o) => o.value === value.judge);
  const intervalMin = Math.floor(value.intervalSec / 60);

  return (
    <div className={`${s.root} ${disabled ? s.disabled : ''}`}>
      {/* 判断方式（セグメントボタン） */}
      <div className={s.field}>
        <div className={s.fieldLabel}>判断方式</div>
        <div className={s.segmented}>
          {JUDGE_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              type="button"
              onClick={() => onChange({ ...value, judge: opt.value })}
              disabled={disabled}
              className={`${s.segmentButton} ${
                value.judge === opt.value ? s.segmentActive : ''
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
        {selectedOption && (
          <div className={s.fieldCaption}>{selectedOption.caption}</div>
        )}
      </div>

      {/* 判断間隔（判断ありの場合のみ） */}
      {value.judge !== 'none' && (
        <div className={s.field}>
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

      {/* 再送までの待機時間 */}
      <div className={s.field}>
        <div className={s.fieldLabel}>再送待機</div>
        <Stepper
          value={intervalMin}
          min={0}
          suffix="分"
          disabled={disabled}
          onChange={(n) => onChange({ ...value, intervalSec: n * 60 })}
        />
      </div>
    </div>
  );
};

export default LoopSettingsFields;
