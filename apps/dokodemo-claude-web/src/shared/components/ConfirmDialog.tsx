import React, { useEffect } from 'react';
import { AlertTriangle } from 'lucide-react';
import Button from '@/shared/components/Button';
import s from './ConfirmDialog.module.scss';

interface ConfirmDialogProps {
  isOpen: boolean;
  title: string;
  /** danger は赤（取り消せない操作）、warning は橙（一時的な操作） */
  tone?: 'danger' | 'warning';
  confirmLabel: string;
  /** 実行ボタンを押せない状態（確認入力が未一致など） */
  confirmDisabled?: boolean;
  /** 実行中（両ボタンを無効化しラベルを差し替える） */
  busy?: boolean;
  busyLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
  /** 本文（警告リスト・対象情報など） */
  children?: React.ReactNode;
}

/**
 * 破壊的操作の確認ダイアログ。
 * window.confirm はモバイルで扱いにくいため、取り消せない操作はこれを使う。
 */
export function ConfirmDialog({
  isOpen,
  title,
  tone = 'danger',
  confirmLabel,
  confirmDisabled = false,
  busy = false,
  busyLabel,
  onConfirm,
  onCancel,
  children,
}: ConfirmDialogProps) {
  // ESC でキャンセル（実行中は閉じない）
  useEffect(() => {
    if (!isOpen) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !busy) onCancel();
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [isOpen, busy, onCancel]);

  if (!isOpen) return null;

  return (
    <div className={s.overlay} role="presentation">
      <div className={s.card} role="dialog" aria-modal="true">
        <div className={s.header}>
          <AlertTriangle
            className={`${s.icon} ${tone === 'danger' ? s.iconDanger : s.iconWarning}`}
            aria-hidden
          />
          <h3 className={s.title}>{title}</h3>
        </div>
        <div className={s.body}>{children}</div>
        <div className={s.actions}>
          <Button
            variant="ghost"
            className={s.actionButton}
            onClick={onCancel}
            disabled={busy}
          >
            キャンセル
          </Button>
          <Button
            variant={tone === 'danger' ? 'danger' : 'primary'}
            className={s.actionButton}
            onClick={onConfirm}
            disabled={busy || confirmDisabled}
          >
            {busy ? (busyLabel ?? '処理中...') : confirmLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}

export default ConfirmDialog;
