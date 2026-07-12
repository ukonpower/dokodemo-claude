import { useRef } from 'react';
import type React from 'react';

/**
 * モーダルのオーバーレイ（背景）クリックで閉じるための共通ハンドラ。
 *
 * mousedown と click の両方がオーバーレイ自身で発生した場合のみ閉じる。
 * これにより、コンテンツ内のテキストをドラッグ選択して
 * オーバーレイ上でマウスを離しても閉じない。
 *
 * 使い方: 返り値をオーバーレイ要素にそのまま spread する。
 *   const overlayProps = useOverlayClose(onClose);
 *   <div className={s.overlay} {...overlayProps}>...</div>
 *
 * オーバーレイ直下以外の要素（コンテンツ周りの余白など）も
 * 「背景」として扱いたい場合は isOverlayTarget で判定を差し替える。
 */
export function useOverlayClose(
  onClose: () => void,
  isOverlayTarget: (e: React.MouseEvent) => boolean = (e) =>
    e.target === e.currentTarget
) {
  const pressedOnOverlay = useRef(false);

  const onMouseDown = (e: React.MouseEvent) => {
    pressedOnOverlay.current = isOverlayTarget(e);
  };

  const onClick = (e: React.MouseEvent) => {
    const shouldClose = pressedOnOverlay.current && isOverlayTarget(e);
    pressedOnOverlay.current = false;
    if (shouldClose) onClose();
  };

  return { onMouseDown, onClick };
}
