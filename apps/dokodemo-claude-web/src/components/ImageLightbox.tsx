import React, { useCallback, useEffect, useState, useRef } from 'react';
import {
  X,
  ChevronLeft,
  ChevronRight,
  Copy as CopyIcon,
  Check,
  Trash2,
} from 'lucide-react';
import s from './ImageLightbox.module.scss';

export interface LightboxItem {
  id: string;
  filename: string;
  imageUrl: string;
  copyPath: string;
  type?: 'image' | 'video';
  title?: string;
  description?: string;
  labels?: string[];
}

interface ImageLightboxProps {
  items: LightboxItem[];
  currentIndex: number;
  isOpen: boolean;
  onClose: () => void;
  onIndexChange: (index: number) => void;
  onCopyPath: (path: string) => void;
  onDelete?: (filename: string) => void;
  copiedPath: string | null;
}

const ImageLightbox: React.FC<ImageLightboxProps> = ({
  items,
  currentIndex,
  isOpen,
  onClose,
  onIndexChange,
  onCopyPath,
  onDelete,
  copiedPath,
}) => {
  const [touchStart, setTouchStart] = useState<number | null>(null);
  const [touchEnd, setTouchEnd] = useState<number | null>(null);
  const [swipeOffset, setSwipeOffset] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);

  const currentItem = items[currentIndex];

  const goToPrevious = useCallback(() => {
    if (currentIndex > 0) {
      onIndexChange(currentIndex - 1);
    }
  }, [currentIndex, onIndexChange]);

  const goToNext = useCallback(() => {
    if (currentIndex < items.length - 1) {
      onIndexChange(currentIndex + 1);
    }
  }, [currentIndex, items.length, onIndexChange]);

  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      switch (e.key) {
        case 'Escape':
          onClose();
          break;
        case 'ArrowLeft':
          goToPrevious();
          break;
        case 'ArrowRight':
          goToNext();
          break;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose, goToPrevious, goToNext]);

  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => {
      document.body.style.overflow = '';
    };
  }, [isOpen]);

  const minSwipeDistance = 50;

  const handleTouchStart = (e: React.TouchEvent) => {
    setTouchEnd(null);
    setTouchStart(e.targetTouches[0].clientX);
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    const currentX = e.targetTouches[0].clientX;
    setTouchEnd(currentX);

    if (touchStart !== null) {
      const offset = currentX - touchStart;
      if (
        (currentIndex === 0 && offset > 0) ||
        (currentIndex === items.length - 1 && offset < 0)
      ) {
        setSwipeOffset(offset * 0.3);
      } else {
        setSwipeOffset(offset);
      }
    }
  };

  const handleTouchEnd = () => {
    setSwipeOffset(0);
    if (!touchStart || !touchEnd) return;

    const distance = touchStart - touchEnd;
    const isLeftSwipe = distance > minSwipeDistance;
    const isRightSwipe = distance < -minSwipeDistance;

    if (isLeftSwipe) {
      goToNext();
    } else if (isRightSwipe) {
      goToPrevious();
    }

    setTouchStart(null);
    setTouchEnd(null);
  };

  const handleDelete = useCallback(() => {
    if (currentItem && onDelete && window.confirm('このファイルを削除しますか？')) {
      onDelete(currentItem.filename);
      if (items.length === 1) {
        onClose();
      } else if (currentIndex === items.length - 1) {
        onIndexChange(currentIndex - 1);
      }
    }
  }, [
    currentItem,
    items.length,
    currentIndex,
    onDelete,
    onClose,
    onIndexChange,
  ]);

  const handleBackdropClick = (e: React.MouseEvent) => {
    if (e.target === containerRef.current) {
      onClose();
    }
  };

  if (!isOpen || !currentItem) return null;

  return (
    <div
      ref={containerRef}
      onClick={handleBackdropClick}
      className={s.backdrop}
    >
      {/* ヘッダー */}
      <div className={s.header}>
        <div className={s.headerLeft}>
          <span className={s.counter}>
            {currentIndex + 1} / {items.length}
          </span>
        </div>
        <button
          onClick={onClose}
          className={s.closeButton}
          aria-label="閉じる"
          title="閉じる (Esc)"
        >
          <X size={20} strokeWidth={2.25} />
        </button>
      </div>

      {/* メインコンテンツ */}
      <div
        className={s.mainContent}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
      >
        {currentIndex > 0 && (
          <button
            onClick={goToPrevious}
            className={s.prevButton}
            aria-label="前の画像"
          >
            <ChevronLeft className={s.navIcon} strokeWidth={2.25} />
          </button>
        )}

        <div
          className={s.imageWrapper}
          style={{
            transform: `translateX(${swipeOffset}px)`,
          }}
        >
          {currentItem.type === 'video' ? (
            <video
              src={currentItem.imageUrl}
              controls
              autoPlay
              muted
              loop
              className={s.mediaContent}
            />
          ) : (
            <img
              src={currentItem.imageUrl}
              alt={currentItem.title || currentItem.filename}
              className={s.mediaContent}
              draggable={false}
            />
          )}
        </div>

        {currentIndex < items.length - 1 && (
          <button
            onClick={goToNext}
            className={s.nextButton}
            aria-label="次の画像"
          >
            <ChevronRight className={s.navIcon} strokeWidth={2.25} />
          </button>
        )}
      </div>

      {/* メタデータパネル */}
      {(currentItem.title || currentItem.description || (currentItem.labels && currentItem.labels.length > 0)) && (
        <div className={s.metaPanel}>
          {currentItem.title && (
            <h3 className={s.metaTitle}>
              {currentItem.title}
            </h3>
          )}
          {currentItem.description && (
            <p className={s.metaDescription}>
              {currentItem.description}
            </p>
          )}
          {currentItem.labels && currentItem.labels.length > 0 && (
            <div className={s.labelList}>
              {currentItem.labels.map((label) => (
                <span
                  key={label}
                  className={s.labelTag}
                >
                  {label}
                </span>
              ))}
            </div>
          )}
        </div>
      )}

      {/* アクションバー */}
      <div className={s.actionBar}>
        <button
          onClick={() => onCopyPath(currentItem.copyPath)}
          className={`${s.copyPathButton} ${
            copiedPath === currentItem.copyPath
              ? s.copyPathCopied
              : s.copyPathDefault
          }`}
        >
          {copiedPath === currentItem.copyPath ? (
            <>
              <Check size={14} strokeWidth={2.5} />
              <span>Copied</span>
            </>
          ) : (
            <>
              <CopyIcon size={14} strokeWidth={2} />
              <span>Copy Path</span>
            </>
          )}
        </button>
        {onDelete && (
          <button
            onClick={handleDelete}
            className={s.deleteFileButton}
            aria-label="削除"
            title="削除"
          >
            <Trash2 size={14} strokeWidth={2} />
          </button>
        )}
      </div>
    </div>
  );
};

export default ImageLightbox;
