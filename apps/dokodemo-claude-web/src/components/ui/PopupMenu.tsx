/**
 * アンカー要素の直下に開くポップアップメニューの共通コンポーネント。
 *
 * - `createPortal` で body 直下に描画し、`position: fixed` でアンカーの真下に配置する。
 * - 既定はアンカー左端に揃えて右方向へ展開する（AI 追加メニューと同じ挙動）。
 *   実幅を測って画面右端からはみ出す場合だけ左へクランプする。
 * - 外側クリック / Escape で閉じる（`useOutsideClose`）。
 */
import { useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useOutsideClose } from '../../hooks';
import s from './PopupMenu.module.scss';

interface PopupMenuProps {
  open: boolean;
  /** メニューを紐付けるアンカー要素（トリガーボタン） */
  anchorEl: HTMLElement | null;
  onClose: () => void;
  children: React.ReactNode;
  className?: string;
}

const MENU_MARGIN = 8;
const GAP = 4;

export function PopupMenu({
  open,
  anchorEl,
  onClose,
  children,
  className,
}: PopupMenuProps) {
  const menuRef = useRef<HTMLDivElement | null>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  useOutsideClose(open, onClose, { ignore: [anchorEl, menuRef] });

  // 描画後に実幅を測り、アンカー左端起点で右へ展開しつつ画面内へクランプする。
  useLayoutEffect(() => {
    if (!open || !anchorEl) {
      setPos(null);
      return;
    }
    const rect = anchorEl.getBoundingClientRect();
    const width = menuRef.current?.offsetWidth ?? 0;
    let left = rect.left;
    if (width > 0) {
      left = Math.min(left, window.innerWidth - width - MENU_MARGIN);
      left = Math.max(left, MENU_MARGIN);
    }
    setPos({ top: rect.bottom + GAP, left });
  }, [open, anchorEl]);

  if (!open || !anchorEl) return null;

  return createPortal(
    <div
      ref={menuRef}
      className={`${s.menu}${className ? ` ${className}` : ''}`}
      style={{
        position: 'fixed',
        top: pos?.top ?? 0,
        left: pos?.left ?? 0,
        // 実幅測定前は位置未確定なので隠しておく（チラつき防止）
        visibility: pos ? 'visible' : 'hidden',
      }}
    >
      {children}
    </div>,
    document.body
  );
}
