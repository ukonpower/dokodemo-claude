import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useOutsideClose } from '@/hooks';
import {
  ArrowUpRight,
  ChevronLeft,
  ChevronRight,
  Eye,
  EyeOff,
  ListChecks,
  ListX,
  StickyNote,
} from 'lucide-react';
import type { GitWorktree } from '@/types';
import MarkdownViewer from '@/components/files/MarkdownViewer';
import s from './DashboardSidebar.module.scss';

interface MemoPopover {
  rid: string;
  top: number;
  left: number;
}

// ビューポート内に収まるように、ボタン横（右側）に出すデフォルト位置 → 画面右に
// はみ出すならボタンの左側に寄せる。下端も同様に上にせり上げる。
function placePopoverNextTo(
  anchor: DOMRect,
  width = 320,
  height = 280,
  gap = 6
): { top: number; left: number } {
  let left = anchor.right + gap;
  if (left + width > window.innerWidth - 8) {
    left = Math.max(8, anchor.left - width - gap);
  }
  let top = anchor.top;
  if (top + height > window.innerHeight - 8) {
    top = Math.max(8, window.innerHeight - height - 8);
  }
  return { top, left };
}

interface DashboardSidebarProps {
  worktreesWithRid: Array<{ wt: GitWorktree; rid: string }>;
  visibleRids: Set<string>;
  selectedRids: Set<string>;
  onToggleVisible: (rid: string) => void;
  onToggleSelected: (rid: string) => void;
  onSetAllVisible: (visible: boolean) => void;
  onSelectAll: () => void;
  onClearSelection: () => void;
  onOpenWorktreeInNormalView: (path: string) => void;
  onCollapse: () => void;
}

/**
 * ダッシュボード PC 用の左サイドバー。
 * - 各 WT の「表示 ON/OFF」「一斉送信対象チェック」「メモプレビュー」を扱う。
 * - 編集は通常ビューで行う前提（ここでは閲覧のみ）。
 */
function DashboardSidebar({
  worktreesWithRid,
  visibleRids,
  selectedRids,
  onToggleVisible,
  onToggleSelected,
  onSetAllVisible,
  onSelectAll,
  onClearSelection,
  onOpenWorktreeInNormalView,
  onCollapse,
}: DashboardSidebarProps) {
  const [memoPopover, setMemoPopover] = useState<MemoPopover | null>(null);
  const popoverRef = useRef<HTMLDivElement | null>(null);

  const total = worktreesWithRid.length;
  const visibleCount = useMemo(
    () => worktreesWithRid.filter((x) => visibleRids.has(x.rid)).length,
    [worktreesWithRid, visibleRids]
  );
  const selectedCount = useMemo(
    () => worktreesWithRid.filter((x) => selectedRids.has(x.rid)).length,
    [worktreesWithRid, selectedRids]
  );

  const activeMemoText = useMemo(() => {
    if (!memoPopover) return '';
    return (
      worktreesWithRid.find((x) => x.rid === memoPopover.rid)?.wt.memo?.trim() ??
      ''
    );
  }, [memoPopover, worktreesWithRid]);

  const openMemoPopover = (
    rid: string,
    e: React.MouseEvent<HTMLButtonElement>
  ) => {
    if (memoPopover?.rid === rid) {
      setMemoPopover(null);
      return;
    }
    const rect = e.currentTarget.getBoundingClientRect();
    const { top, left } = placePopoverNextTo(rect);
    setMemoPopover({ rid, top, left });
  };

  // 外側クリック / Escape でポップオーバーを閉じる
  const closeMemoPopover = useCallback(() => setMemoPopover(null), []);
  useOutsideClose(!!memoPopover, closeMemoPopover, {
    ignore: [popoverRef],
  });

  // スクロールで位置が追随できないため一緒に閉じる
  useEffect(() => {
    if (!memoPopover) return;
    const handleScroll = () => setMemoPopover(null);
    window.addEventListener('scroll', handleScroll, true);
    return () => {
      window.removeEventListener('scroll', handleScroll, true);
    };
  }, [memoPopover]);

  return (
    <aside className={s.sidebar}>
      <header className={s.sidebarHeader}>
        <div className={s.titleArea}>
          <span className={s.title}>Worktrees</span>
          <span className={s.count}>
            {visibleCount}/{total}
          </span>
        </div>
        <button
          type="button"
          className={s.collapseButton}
          onClick={onCollapse}
          title="サイドバーを閉じる"
        >
          <ChevronLeft size={16} aria-hidden />
        </button>
      </header>

      <div className={s.quickActions}>
        <button
          type="button"
          className={s.quickButton}
          onClick={() => onSetAllVisible(visibleCount !== total)}
          title={visibleCount === total ? '全て非表示にする' : '全て表示する'}
          disabled={total === 0}
        >
          {visibleCount === total ? (
            <EyeOff size={12} aria-hidden />
          ) : (
            <Eye size={12} aria-hidden />
          )}
          <span className={s.quickLabel}>
            {visibleCount === total ? '全て非表示' : '全て表示'}
          </span>
          <span className={s.quickCount}>
            {visibleCount}/{total}
          </span>
        </button>
        <button
          type="button"
          className={s.quickButton}
          onClick={selectedCount === total ? onClearSelection : onSelectAll}
          title={
            selectedCount === total
              ? '一斉送信対象を全解除'
              : '全て一斉送信対象に'
          }
          disabled={total === 0}
        >
          {selectedCount === total && total > 0 ? (
            <ListX size={12} aria-hidden />
          ) : (
            <ListChecks size={12} aria-hidden />
          )}
          <span className={s.quickLabel}>
            {selectedCount === total && total > 0 ? '全て解除' : '全て選択'}
          </span>
          <span className={s.quickCount}>
            {selectedCount}/{total}
          </span>
        </button>
      </div>

      <ul className={s.list}>
        {worktreesWithRid.length === 0 && (
          <li className={s.empty}>worktree がありません</li>
        )}
        {worktreesWithRid.map(({ wt, rid }) => {
          const isVisible = visibleRids.has(rid);
          const isSelected = selectedRids.has(rid);
          const memo = wt.memo?.trim() ?? '';
          const hasMemo = memo.length > 0;
          const memoOpen = memoPopover?.rid === rid;

          return (
            <li
              key={wt.path}
              className={`${s.item} ${!isVisible ? s.itemHidden : ''}`}
            >
              <div className={s.itemRow}>
                <button
                  type="button"
                  className={`${s.visToggle} ${isVisible ? s.visToggleOn : ''}`}
                  onClick={() => onToggleVisible(rid)}
                  title={isVisible ? '表示中（クリックで非表示）' : '非表示（クリックで表示）'}
                  aria-pressed={isVisible}
                >
                  {isVisible ? (
                    <Eye size={14} aria-hidden />
                  ) : (
                    <EyeOff size={14} aria-hidden />
                  )}
                </button>
                <label
                  className={s.broadcastCheckLabel}
                  title="一斉送信の対象"
                >
                  <input
                    type="checkbox"
                    className={s.broadcastCheck}
                    checked={isSelected}
                    onChange={() => onToggleSelected(rid)}
                  />
                </label>
                <span className={s.branchName} title={wt.branch}>
                  {wt.branch}
                  {wt.isMain && <span className={s.mainTag}>main</span>}
                </span>
                {hasMemo && (
                  <button
                    type="button"
                    className={`${s.memoToggle} ${memoOpen ? s.memoToggleOpen : ''}`}
                    onClick={(e) => openMemoPopover(rid, e)}
                    title={memoOpen ? 'メモを閉じる' : 'メモを見る'}
                    aria-expanded={memoOpen}
                    aria-haspopup="dialog"
                  >
                    <StickyNote size={12} aria-hidden />
                  </button>
                )}
                <button
                  type="button"
                  className={s.openButton}
                  onClick={() => onOpenWorktreeInNormalView(wt.path)}
                  title="通常表示で開く"
                >
                  <ArrowUpRight size={12} aria-hidden />
                </button>
              </div>
            </li>
          );
        })}
      </ul>

      {memoPopover &&
        createPortal(
          <div
            ref={popoverRef}
            className={s.memoPopover}
            style={{ top: memoPopover.top, left: memoPopover.left }}
            role="dialog"
            aria-label="メモ"
          >
            <MarkdownViewer content={activeMemoText} stopLinkPropagation />
          </div>,
          document.body
        )}
    </aside>
  );
}

export default DashboardSidebar;

/** サイドバーが閉じているとき用の細い開閉ハンドル */
export function DashboardSidebarHandle({
  onExpand,
}: {
  onExpand: () => void;
}) {
  return (
    <button
      type="button"
      className={s.handle}
      onClick={onExpand}
      title="サイドバーを開く"
    >
      <ChevronRight size={16} aria-hidden />
    </button>
  );
}
