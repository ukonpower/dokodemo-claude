import { useCallback, useEffect, useRef } from 'react';

/** 長押しが成立した座標 */
export interface LongPressPoint {
  clientX: number;
  clientY: number;
}

/** bind() が返すハンドラ束（<tr> / RefChip 等にスプレッドで付与する） */
export interface LongPressHandlers {
  onPointerDown: (e: React.PointerEvent) => void;
  onPointerMove: (e: React.PointerEvent) => void;
  onPointerUp: () => void;
  onPointerCancel: () => void;
}

const LONG_PRESS_MS = 500;
const MOVE_CANCEL_PX = 10;

/**
 * タッチ端末専用の長押し検出フック。
 * マウス操作（pointerType !== 'touch'）では一切発火しない。
 * テーブル全体で 1 インスタンスを共有し、対象ごとに bind(callback) で
 * ハンドラ束を生成する（同時に複数箇所を長押しするケースは考慮しない）。
 */
export function useLongPress(): {
  bind: (onLongPress: (p: LongPressPoint) => void) => LongPressHandlers;
  consumeLongPress: () => boolean;
  cancel: () => void;
} {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const startPointRef = useRef<LongPressPoint | null>(null);
  const firedRef = useRef(false);

  const clearTimer = useCallback(() => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const cancel = useCallback(() => {
    clearTimer();
    startPointRef.current = null;
  }, [clearTimer]);

  useEffect(() => clearTimer, [clearTimer]);

  const consumeLongPress = useCallback((): boolean => {
    if (firedRef.current) {
      firedRef.current = false;
      return true;
    }
    return false;
  }, []);

  const bind = useCallback(
    (onLongPress: (p: LongPressPoint) => void): LongPressHandlers => {
      return {
        onPointerDown: (e: React.PointerEvent) => {
          if (e.pointerType !== 'touch') return;
          clearTimer();
          // 前回の長押し後に click が来ずフラグが残ると次のタップを誤って吸うためリセット
          firedRef.current = false;
          const point: LongPressPoint = { clientX: e.clientX, clientY: e.clientY };
          startPointRef.current = point;
          timerRef.current = setTimeout(() => {
            timerRef.current = null;
            firedRef.current = true;
            // 指離し時の合成マウスイベント（mousedown/click）が、長押しで開いた直後の
            // メニュー overlay に飛んで即 close するのを防ぐ
            document.addEventListener(
              'touchend',
              (ev) => ev.preventDefault(),
              { once: true, passive: false, capture: true }
            );
            onLongPress(point);
          }, LONG_PRESS_MS);
        },
        onPointerMove: (e: React.PointerEvent) => {
          const start = startPointRef.current;
          if (!start || timerRef.current === null) return;
          const dx = e.clientX - start.clientX;
          const dy = e.clientY - start.clientY;
          if (Math.sqrt(dx * dx + dy * dy) > MOVE_CANCEL_PX) {
            cancel();
          }
        },
        onPointerUp: () => {
          cancel();
        },
        onPointerCancel: () => {
          cancel();
        },
      };
    },
    [cancel, clearTimer]
  );

  return { bind, consumeLongPress, cancel };
}
