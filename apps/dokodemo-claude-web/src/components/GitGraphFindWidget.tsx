import React, { useEffect, useRef } from 'react';
import { Search, ChevronUp, ChevronDown, X } from 'lucide-react';
import s from './GitGraphFindWidget.module.scss';

interface GitGraphFindWidgetProps {
  query: string;
  onQueryChange: (q: string) => void;
  matchCount: number;
  /** 現在のマッチ（1 始まり）。マッチ無しは 0 */
  currentIndex: number;
  onPrev: () => void;
  onNext: () => void;
  onClose: () => void;
}

/**
 * ヘッダから開く検索バー。message / author 部分一致、hash 前方一致（大小無視）。
 */
const GitGraphFindWidget: React.FC<GitGraphFindWidgetProps> = ({
  query,
  onQueryChange,
  matchCount,
  currentIndex,
  onPrev,
  onNext,
  onClose,
}) => {
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (e.shiftKey) onPrev();
      else onNext();
    }
  };

  return (
    <div className={s.widget}>
      <Search size={13} className={s.searchIcon} />
      <input
        ref={inputRef}
        className={s.input}
        value={query}
        placeholder="メッセージ / 作者 / ハッシュ"
        onChange={(e) => onQueryChange(e.target.value)}
        onKeyDown={handleKeyDown}
      />
      <span className={s.count}>
        {query ? `${currentIndex} / ${matchCount}` : ''}
      </span>
      <button
        className={s.navButton}
        onClick={onPrev}
        disabled={matchCount === 0}
        title="前へ"
        aria-label="前へ"
      >
        <ChevronUp size={14} />
      </button>
      <button
        className={s.navButton}
        onClick={onNext}
        disabled={matchCount === 0}
        title="次へ"
        aria-label="次へ"
      >
        <ChevronDown size={14} />
      </button>
      <button
        className={s.navButton}
        onClick={onClose}
        title="閉じる"
        aria-label="閉じる"
      >
        <X size={14} />
      </button>
    </div>
  );
};

export default GitGraphFindWidget;
