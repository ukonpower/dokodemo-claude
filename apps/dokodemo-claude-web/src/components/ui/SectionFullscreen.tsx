import React, { useEffect } from 'react';
import { X } from 'lucide-react';
import s from './SectionFullscreen.module.scss';

interface SectionFullscreenProps {
  isOpen: boolean;
  onClose: () => void;
  icon: React.ReactNode;
  title: string;
  count?: number;
  children: React.ReactNode;
}

const SectionFullscreen: React.FC<SectionFullscreenProps> = ({
  isOpen,
  onClose,
  icon,
  title,
  count,
  children,
}) => {
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => {
      document.body.style.overflow = '';
    };
  }, [isOpen]);

  if (!isOpen) return null;

  return (
    <div className={s.backdrop}>
      <div className={s.header}>
        <span className={s.headerIcon}>{icon}</span>
        <span className={s.headerTitle}>{title}</span>
        {count !== undefined && count > 0 && (
          <span className={s.headerCount}>{count}</span>
        )}
        <span className={s.spacer} />
        <button
          onClick={onClose}
          className={s.closeButton}
          aria-label="閉じる"
          title="閉じる (Esc)"
        >
          <X size={18} strokeWidth={2.25} />
        </button>
      </div>
      <div className={s.body}>{children}</div>
    </div>
  );
};

export default SectionFullscreen;
