import React from 'react';
import { Menu, Repeat } from 'lucide-react';
import type { SendMode } from '@/app/hooks/useAppSettings';
import s from './SendModeTabs.module.scss';

interface SendModeTabsProps {
  value: SendMode;
  onChange: (mode: SendMode) => void;
  disabled?: boolean;
}

// 送信モードの定義。ここでの選択が入力欄そのものの出し分け（CommandInput /
// LoopComposer）を決めるため、タブは入力欄の外＝views 側に置く
const MODES: {
  value: SendMode;
  label: string;
  icon?: React.ReactNode;
  title: string;
}[] = [
  {
    value: 'send',
    label: '送信',
    title: '送信: 入力をそのまま AI へ送る',
  },
  {
    value: 'queue',
    label: 'キュー',
    icon: <Menu />,
    title: 'キュー: 送信予約リストに追加（clear / commit の設定が使える）',
  },
  {
    value: 'loop',
    label: 'ループ',
    icon: <Repeat />,
    title: 'ループ: 専用の入力欄に切り替え、同じプロンプトを繰り返し送信',
  },
];

/**
 * 送信モード切替タブ（送信 / キュー / ループ）
 *
 * モードごとに描画する入力欄が入れ替わるため、どの入力欄にも属さない
 * 独立したタブとして入力欄の上に置く。
 */
const SendModeTabs: React.FC<SendModeTabsProps> = ({
  value,
  onChange,
  disabled = false,
}) => (
  <div className={s.root} role="group" aria-label="送信モード">
    {MODES.map((mode) => (
      <button
        key={mode.value}
        type="button"
        onClick={() => onChange(mode.value)}
        disabled={disabled}
        className={`${s.button} ${value === mode.value ? s.active : ''}`}
        title={mode.title}
        aria-pressed={value === mode.value}
      >
        {mode.icon && <span className={s.icon}>{mode.icon}</span>}
        {mode.label}
      </button>
    ))}
  </div>
);

export default SendModeTabs;
