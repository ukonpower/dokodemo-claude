import React from 'react';
import { AlertTriangle } from 'lucide-react';
import ModalShell from '@/shared/components/ModalShell';
import Button from '@/shared/components/Button';
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
    <ModalShell
      title={
        <span className={s.title}>
          <AlertTriangle size={20} className={s.warningIcon} />
          ポップアップがブロックされました
        </span>
      }
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            キャンセル
          </Button>
          <Button
            variant="primary"
            onClick={() => {
              onOpenInNewTab();
              onClose();
            }}
          >
            別タブで開く
          </Button>
        </>
      }
    >
      <p className={s.bodyText}>
        code-serverを開くにはポップアップを許可するか、下のボタンから別タブで開いてください。
      </p>
    </ModalShell>
  );
};
