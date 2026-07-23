import { useEffect } from 'react';
import type { RefObject } from 'react';

type MaybeRef =
  | RefObject<HTMLElement | null>
  | HTMLElement
  | null
  | undefined
  | (() => HTMLElement | null | undefined);

interface UseOutsideCloseOptions {
  /**
   * 「内側」扱いする要素（トリガーボタン / メニュー本体 など）。
   * ここに含まれる要素、またはその子孫での pointerdown では close しない。
   */
  ignore?: MaybeRef[];
  /**
   * CSS セレクタで「内側」扱いする指定。
   * pointerdown の target が `closest(selector)` にマッチしたら close しない。
   * data 属性で複数箇所を一括除外したい場合に便利。
   */
  ignoreClosest?: string;
  /** Escape キーでも閉じる（既定 true） */
  closeOnEscape?: boolean;
}

/**
 * ポップアップ系 UI の「外側で閉じる」を共通化するフック。
 *
 * - `pointerdown` を capture フェーズで拾うため、マウス / タップ / ペンで挙動が揃い、
 *   途中で `stopPropagation` されても外側検知が動く。
 * - `Escape` キーでも閉じる（既定 ON）。
 * - `ignore` に渡した要素の内側での pointerdown は無視する。
 *   トリガーボタン自身の再クリックで即再オープンしてしまうのを防ぐため、
 *   通常はトリガーとメニュー本体の 2 つを渡す。
 */
export function useOutsideClose(
  open: boolean,
  close: () => void,
  {
    ignore = [],
    ignoreClosest,
    closeOnEscape = true,
  }: UseOutsideCloseOptions = {}
) {
  useEffect(() => {
    if (!open) return;

    const resolveEl = (r: MaybeRef): HTMLElement | null => {
      if (!r) return null;
      if (typeof r === 'function') return r() ?? null;
      if (r instanceof HTMLElement) return r;
      return r.current;
    };

    const isInside = (target: EventTarget | null) => {
      if (!(target instanceof Node)) return false;
      if (
        ignoreClosest &&
        target instanceof Element &&
        target.closest(ignoreClosest)
      ) {
        return true;
      }
      return ignore.some((r) => {
        const el = resolveEl(r);
        return el ? el.contains(target) : false;
      });
    };

    const onPointerDown = (event: PointerEvent) => {
      if (!isInside(event.target)) close();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close();
    };

    document.addEventListener('pointerdown', onPointerDown, true);
    if (closeOnEscape) document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true);
      if (closeOnEscape) document.removeEventListener('keydown', onKeyDown);
    };
    // ignore 配列の参照は毎レンダー変わるため依存に含めない。
    // 実際に参照する時点で ref.current から最新要素を取り直す設計。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, close, closeOnEscape, ignoreClosest]);
}
