import { useMemo } from 'react';
import { Eye, EyeOff, StickyNote, X } from 'lucide-react';
import type { GitWorktree } from '../types';
import { useOverlayClose } from '../hooks/useOverlayClose';
import s from './DashboardFilterModal.module.scss';

interface DashboardFilterModalProps {
  isOpen: boolean;
  onClose: () => void;
  worktreesWithRid: Array<{ wt: GitWorktree; rid: string }>;
  visibleRids: Set<string>;
  onToggleVisible: (rid: string) => void;
  onSetAllVisible: (visible: boolean) => void;
}

/**
 * SP 用の表示フィルタモーダル。
 * 表示する worktree の絞り込みを行うだけのシンプルな UI。
 * 一斉送信対象の切り替えはカード側のチェックボックスで行う想定。
 */
function DashboardFilterModal({
  isOpen,
  onClose,
  worktreesWithRid,
  visibleRids,
  onToggleVisible,
  onSetAllVisible,
}: DashboardFilterModalProps) {
  const total = worktreesWithRid.length;
  const visibleCount = useMemo(
    () => worktreesWithRid.filter((x) => visibleRids.has(x.rid)).length,
    [worktreesWithRid, visibleRids]
  );

  const overlayProps = useOverlayClose(onClose);

  if (!isOpen) return null;

  return (
    <div className={s.overlay} {...overlayProps}>
      <div className={s.modal}>
        <header className={s.header}>
          <span className={s.title}>表示する worktree</span>
          <span className={s.count}>
            {visibleCount}/{total}
          </span>
          <button
            type="button"
            className={s.closeButton}
            onClick={onClose}
            title="閉じる"
          >
            <X size={16} aria-hidden />
          </button>
        </header>

        <div className={s.actions}>
          <button
            type="button"
            className={s.actionButton}
            onClick={() => onSetAllVisible(true)}
          >
            <Eye size={12} aria-hidden />
            <span>全て表示</span>
          </button>
          <button
            type="button"
            className={s.actionButton}
            onClick={() => onSetAllVisible(false)}
          >
            <EyeOff size={12} aria-hidden />
            <span>全て非表示</span>
          </button>
        </div>

        <ul className={s.list}>
          {worktreesWithRid.length === 0 && (
            <li className={s.empty}>worktree がありません</li>
          )}
          {worktreesWithRid.map(({ wt, rid }) => {
            const isVisible = visibleRids.has(rid);
            const hasMemo = !!wt.memo?.trim();
            return (
              <li key={wt.path} className={s.item}>
                <label className={s.itemLabel}>
                  <input
                    type="checkbox"
                    className={s.itemCheck}
                    checked={isVisible}
                    onChange={() => onToggleVisible(rid)}
                  />
                  <span className={s.itemBranch} title={wt.branch}>
                    {wt.branch}
                    {wt.isMain && <span className={s.mainTag}>main</span>}
                  </span>
                  {hasMemo && (
                    <StickyNote
                      size={12}
                      aria-hidden
                      className={s.memoIcon}
                    />
                  )}
                </label>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}

export default DashboardFilterModal;
