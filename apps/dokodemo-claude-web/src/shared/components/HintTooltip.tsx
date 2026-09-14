import React, { useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { HelpCircle } from 'lucide-react';
import { useOutsideClose } from '@/shared/hooks/useOutsideClose';
import s from './HintTooltip.module.scss';

/** ツールチップの最大幅（画面外へはみ出さないよう位置計算にも使う） */
const TOOLTIP_WIDTH = 260;
/** 画面端に残す余白 */
const VIEWPORT_MARGIN = 8;

interface HintTooltipProps {
  /** 表示する説明文 */
  text: string;
}

/**
 * ラベル横に置く「?」。押すと説明文をツールチップで出す。
 *
 * 説明文を常時表示すると画面が説明で埋まるため、読みたいときだけ開く。
 * 本体は body へ portal する（開閉アニメーションの overflow: hidden や
 * 親のスクロール領域で切れるのを避けるため）。
 */
const HintTooltip: React.FC<HintTooltipProps> = ({ text }) => {
  const buttonRef = useRef<HTMLButtonElement>(null);
  const [position, setPosition] = useState<{
    top: number;
    left: number;
  } | null>(null);
  const open = position !== null;

  const close = () => setPosition(null);
  useOutsideClose(open, close, { ignore: [buttonRef] });

  const toggle = () => {
    if (open) {
      close();
      return;
    }
    const rect = buttonRef.current?.getBoundingClientRect();
    if (!rect) return;
    // ボタンの左下に出し、右端で見切れるときだけ画面内へ寄せる
    const maxLeft = window.innerWidth - TOOLTIP_WIDTH - VIEWPORT_MARGIN;
    setPosition({
      top: rect.bottom + VIEWPORT_MARGIN / 2,
      left: Math.max(VIEWPORT_MARGIN, Math.min(rect.left, maxLeft)),
    });
  };

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        onClick={toggle}
        className={`${s.button} ${open ? s.open : ''}`}
        aria-label="説明を表示"
        aria-expanded={open}
      >
        <HelpCircle size={12} />
      </button>
      {position &&
        createPortal(
          <div
            role="tooltip"
            className={s.tooltip}
            style={{ top: position.top, left: position.left }}
          >
            {text}
          </div>,
          document.body
        )}
    </>
  );
};

export default HintTooltip;
