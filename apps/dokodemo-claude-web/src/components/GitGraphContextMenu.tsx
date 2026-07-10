import React, { useLayoutEffect, useRef, useState, useEffect } from 'react';
import s from './GitGraphContextMenu.module.scss';

export interface GitGraphMenuItem {
  label: string;
  onClick: () => void;
}

interface GitGraphContextMenuProps {
  x: number;
  y: number;
  items: GitGraphMenuItem[];
  onClose: () => void;
}

/**
 * Git Graph 用の右クリックコンテキストメニュー
 * （vscode-git-graph のブランチ/コミットメニュー相当）
 */
const GitGraphContextMenu: React.FC<GitGraphContextMenuProps> = ({
  x,
  y,
  items,
  onClose,
}) => {
  const menuRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: x, top: y });

  // 画面端にはみ出す場合は内側に寄せる
  useLayoutEffect(() => {
    const el = menuRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    setPos({
      left: Math.max(0, Math.min(x, window.innerWidth - rect.width - 4)),
      top: Math.max(0, Math.min(y, window.innerHeight - rect.height - 4)),
    });
  }, [x, y]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  return (
    <div
      className={s.overlay}
      onMouseDown={onClose}
      onContextMenu={(e) => {
        e.preventDefault();
        onClose();
      }}
    >
      <div
        ref={menuRef}
        className={s.menu}
        style={{ left: pos.left, top: pos.top }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        {items.map((item) => (
          <button
            key={item.label}
            className={s.item}
            onClick={() => {
              onClose();
              item.onClick();
            }}
          >
            {item.label}
          </button>
        ))}
      </div>
    </div>
  );
};

export default GitGraphContextMenu;
