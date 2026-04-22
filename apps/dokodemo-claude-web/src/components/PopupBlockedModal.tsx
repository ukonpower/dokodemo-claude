import React from 'react';
import s from './PopupBlockedModal.module.scss';

interface PopupBlockedModalProps {
  isOpen: boolean;
  url: string;
  onClose: () => void;
  onOpenInNewTab: () => void;
}

export const PopupBlockedModal: React.FC<PopupBlockedModalProps> = ({
  isOpen,
  onClose,
  onOpenInNewTab,
}) => {
  if (!isOpen) return null;

  return (
    <div
      className={s.overlay}
      onClick={onClose}
    >
      <div
        className={s.modal}
        onClick={(e) => e.stopPropagation()}
      >
        <div className={s.headerRow}>
          <div className={s.iconWrapper}>
            <svg
              className={s.warningIcon}
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1-1.732-1-2.5 0L4.268 16c-.77 1.333.192 3 1.732 3z"
              />
            </svg>
          </div>
          <div>
            <h3 className={s.title}>
              ポップアップがブロックされました
            </h3>
          </div>
        </div>

        <div className={s.body}>
          <p className={s.bodyText}>
            code-serverを開くにはポップアップを許可するか、下のボタンから別タブで開いてください。
          </p>
        </div>

        <div className={s.actions}>
          <button
            onClick={onClose}
            className={s.cancelButton}
          >
            キャンセル
          </button>
          <button
            onClick={() => {
              onOpenInNewTab();
              onClose();
            }}
            className={s.openButton}
          >
            別タブで開く
          </button>
        </div>
      </div>
    </div>
  );
};
