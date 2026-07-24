import React from 'react';
import s from './IconButton.module.scss';

type IconButtonSize = 'md' | 'xs';

interface IconButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  size?: IconButtonSize;
  /** aria-label（アイコンのみのボタンなので必須） */
  label: string;
}

/**
 * アイコン 1 つを収めた正方形ボタン。既存グローバルクラス .btn-icon / .btn-icon-xs の React 化。
 * children にアイコン（lucide-react 等）を渡す。サイズは CSS 側で svg を含めて固定する。
 */
const IconButton: React.FC<IconButtonProps> = ({
  size = 'md',
  label,
  className,
  children,
  ...rest
}) => {
  const classes = [s.iconButton, s[size], className]
    .filter(Boolean)
    .join(' ');

  return (
    <button className={classes} aria-label={label} title={label} {...rest}>
      {children}
    </button>
  );
};

export default IconButton;
