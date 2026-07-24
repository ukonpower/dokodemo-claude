import React from 'react';
import s from './Button.module.scss';

type ButtonVariant = 'primary' | 'danger' | 'ghost';
type ButtonSize = 'sm' | 'md';

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
}

/**
 * トークンのみで構成した基本ボタン。
 * variant / size で見た目を切り替え、native の button props はそのまま透過する。
 * className を渡すとレイアウト調整用に merge される。
 */
const Button: React.FC<ButtonProps> = ({
  variant = 'ghost',
  size = 'md',
  className,
  children,
  ...rest
}) => {
  const classes = [s.button, s[variant], s[size], className]
    .filter(Boolean)
    .join(' ');

  return (
    <button className={classes} {...rest}>
      {children}
    </button>
  );
};

export default Button;
