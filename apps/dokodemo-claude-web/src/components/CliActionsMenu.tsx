import { useState, useRef, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { SlidersHorizontal, Scaling, Maximize2, Minimize2 } from 'lucide-react';
import s from './CliActionsMenu.module.scss';

interface CliActionsMenuProps {
  /** 操作対象の AI インスタンスが無い場合は無効化 */
  disabled?: boolean;
  /** 全画面表示中かどうか（ラベル・アイコン切替用） */
  isFullscreen: boolean;
  /** ターミナルをリサイズ（表示ずれを直す） */
  onResize: () => void;
  /** 全画面表示のトグル */
  onToggleFullscreen: () => void;
}

/**
 * AI CLI の表示操作をまとめたメニューボタン
 * リサイズ / 全画面 をドロップダウンに集約する。
 * タブの ⋮ と混同しないよう、トリガーはスライダーアイコンにする。
 */
function CliActionsMenu({
  disabled = false,
  isFullscreen,
  onResize,
  onToggleFullscreen,
}: CliActionsMenuProps) {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<{
    top: number;
    right: number;
  } | null>(null);
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);

  const close = useCallback(() => {
    setOpen(false);
    setPosition(null);
  }, []);

  const openMenu = useCallback(() => {
    const rect = buttonRef.current?.getBoundingClientRect();
    if (!rect) return;
    // メニュー右端をボタンの右端に合わせて右詰めで開く
    setPosition({ top: rect.bottom + 4, right: window.innerWidth - rect.right });
    setOpen(true);
  }, []);

  const toggle = useCallback(() => {
    if (open) close();
    else openMenu();
  }, [open, close, openMenu]);

  useEffect(() => {
    if (!open) return;
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as Node;
      if (
        menuRef.current &&
        !menuRef.current.contains(target) &&
        buttonRef.current &&
        !buttonRef.current.contains(target)
      ) {
        close();
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [open, close]);

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        onClick={toggle}
        disabled={disabled}
        className="btn-icon-xs"
        title="表示操作（リサイズ / 全画面）"
      >
        <SlidersHorizontal size={14} />
      </button>

      {open &&
        position &&
        createPortal(
          <div
            ref={menuRef}
            className={s.menu}
            style={{
              position: 'fixed',
              top: position.top,
              right: position.right,
            }}
          >
            <button
              type="button"
              onClick={() => {
                close();
                onResize();
              }}
              className={s.menuItem}
            >
              <Scaling size={14} />
              <span>リサイズ</span>
            </button>
            <button
              type="button"
              onClick={() => {
                close();
                onToggleFullscreen();
              }}
              className={s.menuItem}
            >
              {isFullscreen ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
              <span>{isFullscreen ? '全画面を閉じる' : '全画面表示'}</span>
            </button>
          </div>,
          document.body
        )}
    </>
  );
}

export default CliActionsMenu;
