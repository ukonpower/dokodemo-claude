import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Pencil, FileText, ImagePlus } from 'lucide-react';
import { useOutsideClose } from '@/shared/hooks/useOutsideClose';
import DrawingCanvas from './DrawingCanvas';
import s from './SketchButton.module.scss';

/** fixed 配置のポップアップが画面外にはみ出さないよう left を収める */
const clampMenuLeft = (left: number, width: number) =>
  Math.max(8, Math.min(left, window.innerWidth - width - 8));

interface SketchButtonProps {
  /** 描き上がった PNG。呼び出し側でアップロードしてパスを挿入する */
  onComplete: (file: File) => void;
  disabled?: boolean;
  /** ボタンの外観を呼び出し側の並びに合わせるための追加クラス */
  className?: string;
  /** アイコンサイズ。md（プロンプト入力欄）/ sm（ループへの指示欄） */
  size?: 'md' | 'sm';
}

/**
 * スケッチ添付ボタン（鉛筆）。押すと「白紙から / 写真から加筆」のメニューを出し、
 * お絵かきキャンバス（DrawingCanvas）を開く。ボタンへ画像をドロップすると
 * その画像を背景にした加筆モードで直接開く。
 * プロンプト入力欄とループへの指示欄で共有する。
 */
export const SketchButton: React.FC<SketchButtonProps> = ({
  onComplete,
  disabled = false,
  className,
  size = 'md',
}) => {
  const [isDrawingOpen, setIsDrawingOpen] = useState(false);
  // 写真加筆モードの背景画像 URL（object URL）。白紙スケッチ時は null
  const [drawingBgUrl, setDrawingBgUrl] = useState<string | null>(null);
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [menuPosition, setMenuPosition] = useState({ top: 0, left: 0 });
  // ボタンへ画像をドラッグ中のハイライト
  const [isDragOver, setIsDragOver] = useState(false);

  const menuRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const bgInputRef = useRef<HTMLInputElement>(null);

  // アンマウント時に解放するため、現在の背景 URL を ref にも保持する
  const drawingBgUrlRef = useRef<string | null>(null);
  useEffect(() => {
    drawingBgUrlRef.current = drawingBgUrl;
  }, [drawingBgUrl]);
  useEffect(
    () => () => {
      if (drawingBgUrlRef.current) URL.revokeObjectURL(drawingBgUrlRef.current);
    },
    []
  );

  // キャンバスを閉じ、背景 object URL を解放する
  const closeDrawing = useCallback(() => {
    setIsDrawingOpen(false);
    setDrawingBgUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return null;
    });
  }, []);

  // 白紙スケッチを開く
  const openBlankSketch = useCallback(() => {
    setDrawingBgUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return null;
    });
    setIsDrawingOpen(true);
    setIsMenuOpen(false);
  }, []);

  // 画像ファイルを背景にして加筆モードで開く
  const openSketchFromFile = useCallback((file: File) => {
    if (!file.type.startsWith('image/')) return;
    const url = URL.createObjectURL(file);
    setDrawingBgUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return url;
    });
    setIsDrawingOpen(true);
    setIsMenuOpen(false);
  }, []);

  // 「写真から加筆」: ネイティブの画像ピッカーを開く
  const openPhotoSketch = useCallback(() => {
    setIsMenuOpen(false);
    bgInputRef.current?.click();
  }, []);

  const handleBgSelected = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      e.target.value = '';
      if (file) openSketchFromFile(file);
    },
    [openSketchFromFile]
  );

  // ボタンへの画像ドラッグ＆ドロップ（ドロップした画像に加筆）
  const handleDragOver = useCallback(
    (e: React.DragEvent<HTMLButtonElement>) => {
      if (!e.dataTransfer.types.includes('Files')) return;
      e.preventDefault();
      e.stopPropagation();
      setIsDragOver(true);
    },
    []
  );
  const handleDragLeave = useCallback(
    (e: React.DragEvent<HTMLButtonElement>) => {
      e.preventDefault();
      e.stopPropagation();
      setIsDragOver(false);
    },
    []
  );
  const handleDrop = useCallback(
    (e: React.DragEvent<HTMLButtonElement>) => {
      e.preventDefault();
      e.stopPropagation();
      setIsDragOver(false);
      const file = Array.from(e.dataTransfer.files).find((f) =>
        f.type.startsWith('image/')
      );
      if (file) openSketchFromFile(file);
    },
    [openSketchFromFile]
  );

  const handleDrawingComplete = useCallback(
    (file: File) => {
      closeDrawing();
      onComplete(file);
    },
    [closeDrawing, onComplete]
  );

  // メニューの位置計算（スクロール/リサイズに追随）
  useEffect(() => {
    if (!isMenuOpen) return;
    const updatePosition = () => {
      if (buttonRef.current) {
        const rect = buttonRef.current.getBoundingClientRect();
        setMenuPosition({
          top: rect.top - 4, // ボタンの上に表示（余白4px）
          left: clampMenuLeft(rect.left, 176), // 11rem
        });
      }
    };
    updatePosition();
    window.addEventListener('scroll', updatePosition, true);
    window.addEventListener('resize', updatePosition);
    return () => {
      window.removeEventListener('scroll', updatePosition, true);
      window.removeEventListener('resize', updatePosition);
    };
  }, [isMenuOpen]);

  // 外側クリック / Escape でメニューを閉じる
  const closeMenu = useCallback(() => setIsMenuOpen(false), []);
  useOutsideClose(isMenuOpen, closeMenu, {
    ignore: [menuRef, buttonRef],
  });

  return (
    <>
      <input
        ref={bgInputRef}
        type="file"
        accept="image/*"
        onChange={handleBgSelected}
        className={s.hiddenFileInput}
      />
      <div className={s.menuWrapper} ref={menuRef}>
        <button
          type="button"
          ref={buttonRef}
          onClick={() => setIsMenuOpen((v) => !v)}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          disabled={disabled}
          className={`${className ?? ''} ${isDragOver ? s.dragOver : ''}`}
          title="スケッチを描いて添付（写真をドロップで加筆）"
          aria-label="スケッチを描いて添付"
        >
          <Pencil className={size === 'sm' ? s.iconSm : s.icon} />
        </button>
        {isMenuOpen && (
          <div
            className={s.menu}
            style={{
              top: `${menuPosition.top}px`,
              left: `${menuPosition.left}px`,
              transform: 'translateY(-100%)',
            }}
          >
            <button
              type="button"
              className={s.menuItem}
              onClick={openBlankSketch}
            >
              <FileText size={14} strokeWidth={2} />
              <span>白紙から</span>
            </button>
            <button
              type="button"
              className={s.menuItem}
              onClick={openPhotoSketch}
            >
              <ImagePlus size={14} strokeWidth={2} />
              <span>写真から加筆</span>
            </button>
          </div>
        )}
      </div>

      <DrawingCanvas
        isOpen={isDrawingOpen}
        backgroundImageUrl={drawingBgUrl}
        onClose={closeDrawing}
        onComplete={handleDrawingComplete}
      />
    </>
  );
};

export default SketchButton;
