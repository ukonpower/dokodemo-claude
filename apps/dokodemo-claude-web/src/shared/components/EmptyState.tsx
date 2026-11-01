import React from 'react';
import s from './EmptyState.module.scss';

interface EmptyStateProps {
  /** 文の頭に添えるアイコン。クリックで何かできる空表示（アップロード等）にだけ付ける */
  icon?: React.ReactNode;
  message: string;
  hint?: string;
}

/** 一覧が空のときに出す控えめな案内文 */
const EmptyState: React.FC<EmptyStateProps> = ({ icon, message, hint }) => {
  return (
    <div className={s.root}>
      <div className={s.message}>
        {icon && <span className={s.icon}>{icon}</span>}
        {message}
      </div>
      {hint && <div className={s.hint}>{hint}</div>}
    </div>
  );
};

export default EmptyState;
