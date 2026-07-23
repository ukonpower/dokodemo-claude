import React from 'react';
import s from './EmptyState.module.scss';

interface EmptyStateProps {
  icon: React.ReactNode;
  message: string;
  hint?: string;
}

const EmptyState: React.FC<EmptyStateProps> = ({ icon, message, hint }) => {
  return (
    <div className={s.root}>
      <div className={s.iconWrap}>{icon}</div>
      <div className={s.message}>{message}</div>
      {hint && <div className={s.hint}>{hint}</div>}
    </div>
  );
};

export default EmptyState;
