import {
  useCallback,
  type KeyboardEvent,
  type ReactNode,
} from 'react';
import s from './DashboardPromptInput.module.scss';

interface DashboardPromptInputProps {
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  disabled?: boolean;
  placeholder?: string;
  rows?: number;
  /** 送信ボタンに表示するラベル（PCのみ） */
  submitLabel?: string;
  submitTitle?: string;
  /** 入力欄の文字サイズ（md: 通常ページ寄り / sm: ダッシュボードカード寄り） */
  size?: 'sm' | 'md';
  /** textarea の左側に追加するスロット（プレフィックス選択ボタンなど） */
  leadingExtras?: ReactNode;
  /** textarea の下に追加するスロット（キュー追加トグルなど） */
  bottomExtras?: ReactNode;
}

/**
 * ダッシュボード（カード個別 / 一斉送信バー）で共用するプロンプト入力。
 * 通常ページの送信ボタンと同じデザインに揃える。
 */
function DashboardPromptInput({
  value,
  onChange,
  onSubmit,
  disabled = false,
  placeholder,
  rows = 2,
  submitLabel = '送信',
  submitTitle,
  size = 'sm',
  leadingExtras,
  bottomExtras,
}: DashboardPromptInputProps) {
  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLTextAreaElement>) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
        e.preventDefault();
        onSubmit();
      }
    },
    [onSubmit]
  );

  const canSubmit = !disabled && value.trim().length > 0;

  return (
    <div className={s.root}>
      <div className={s.formRow}>
        {leadingExtras && <div className={s.leadingExtras}>{leadingExtras}</div>}
        <textarea
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          disabled={disabled}
          rows={rows}
          className={`${s.textarea} ${size === 'md' ? s.textareaMd : ''}`}
        />
        <button
          type="button"
          onClick={onSubmit}
          disabled={!canSubmit}
          className={s.submitButton}
          title={submitTitle ?? submitLabel}
        >
          <svg
            className={s.submitIcon}
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
            aria-hidden
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M5 10l7-7m0 0l7 7m-7-7v18"
            />
          </svg>
          <span className={s.submitText}>{submitLabel}</span>
        </button>
      </div>
      {bottomExtras && <div className={s.bottomExtras}>{bottomExtras}</div>}
    </div>
  );
}

export default DashboardPromptInput;
