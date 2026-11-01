import React, { useEffect } from 'react';
import { X } from 'lucide-react';
import { useOverlayClose } from '@/shared/hooks/useOverlayClose';
import IconButton from '@/shared/components/IconButton';
import s from './ModalShell.module.scss';

interface ModalShellProps {
  title: React.ReactNode;
  onClose: () => void;
  children: React.ReactNode;
  /** 任意のフッター領域（ボタン列など） */
  footer?: React.ReactNode;
}

/**
 * モーダルの骨組み（オーバーレイ + パネル + ヘッダー + コンテンツ + 任意フッター）。
 * オーバーレイクリックと Escape キーで onClose する。既存モーダルの共通形を抽出したもの。
 */
const ModalShell: React.FC<ModalShellProps> = ({
  title,
  onClose,
  children,
  footer,
}) => {
  const overlayProps = useOverlayClose(onClose);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  return (
    <div className={s.overlay} {...overlayProps}>
      <div
        className={s.panel}
        role="dialog"
        aria-modal="true"
      >
        <div className={s.header}>
          <h2 className={s.title}>{title}</h2>
          <IconButton size="md" label="閉じる" onClick={onClose}>
            <X />
          </IconButton>
        </div>
        <div className={s.content}>{children}</div>
        {footer && <div className={s.footer}>{footer}</div>}
      </div>
    </div>
  );
};

export default ModalShell;
