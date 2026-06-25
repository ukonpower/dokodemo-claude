import { useMemo, useState } from 'react';
import {
  ArrowUpRight,
  CheckSquare,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Eye,
  EyeOff,
  Square,
  StickyNote,
} from 'lucide-react';
import type { GitWorktree } from '../types';
import MarkdownViewer from './MarkdownViewer';
import s from './DashboardSidebar.module.scss';

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
  const [expandedMemoRids, setExpandedMemoRids] = useState<Set<string>>(
    new Set()
  );

  const total = worktreesWithRid.length;
  const visibleCount = useMemo(
    () => worktreesWithRid.filter((x) => visibleRids.has(x.rid)).length,
    [worktreesWithRid, visibleRids]
  );
  const selectedCount = useMemo(
    () => worktreesWithRid.filter((x) => selectedRids.has(x.rid)).length,
    [worktreesWithRid, selectedRids]
  );

  const toggleMemoExpand = (rid: string) => {
    setExpandedMemoRids((prev) => {
      const next = new Set(prev);
      if (next.has(rid)) next.delete(rid);
      else next.add(rid);
      return next;
    });
  };

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
          title={visibleCount === total ? '全て非表示' : '全て表示'}
        >
          {visibleCount === total ? (
            <EyeOff size={12} aria-hidden />
          ) : (
            <Eye size={12} aria-hidden />
          )}
          <span>表示</span>
        </button>
        <button
          type="button"
          className={s.quickButton}
          onClick={selectedCount === total ? onClearSelection : onSelectAll}
          title={
            selectedCount === total ? '一斉送信対象を全解除' : '全て一斉送信対象に'
          }
        >
          {selectedCount === total && total > 0 ? (
            <CheckSquare size={12} aria-hidden />
          ) : (
            <Square size={12} aria-hidden />
          )}
          <span>送信</span>
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
          const memoExpanded = expandedMemoRids.has(rid);

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
                    className={`${s.memoToggle} ${memoExpanded ? s.memoToggleOpen : ''}`}
                    onClick={() => toggleMemoExpand(rid)}
                    title={memoExpanded ? 'メモを閉じる' : 'メモを開く'}
                    aria-expanded={memoExpanded}
                  >
                    <StickyNote size={12} aria-hidden />
                    <ChevronDown size={10} aria-hidden className={s.memoChevron} />
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

              {hasMemo && memoExpanded && (
                <div className={s.memoBlock}>
                  <MarkdownViewer content={memo} stopLinkPropagation />
                </div>
              )}
              {hasMemo && !memoExpanded && (
                <button
                  type="button"
                  className={s.memoPreview}
                  onClick={() => toggleMemoExpand(rid)}
                  title="メモを開く"
                >
                  {memo.replace(/\s+/g, ' ').slice(0, 80)}
                  {memo.length > 80 ? '…' : ''}
                </button>
              )}
            </li>
          );
        })}
      </ul>
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
