/**
 * dokodemo-claude 自身を更新するボタン。
 *
 * クリックで更新先ブランチのメニューを開き、選んだブランチへ切り替えて最新化する。
 * 候補は main と未マージの release/*（＋現在ブランチ）。
 */
import { useCallback, useRef, useState } from 'react';
import { RefreshCw, Check } from 'lucide-react';
import { PopupMenu } from '@/shared/components/PopupMenu';
import { useRepositoryContext } from '@/features/repo/providers/RepositoryProvider';
import s from './SelfUpdateButton.module.scss';

function SelfUpdateButton() {
  const { repository } = useRepositoryContext();
  const {
    pullSelf,
    selfUpdateAvailable,
    selfBranches,
    selfBranchesLoading,
    fetchSelfBranches,
  } = repository;

  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const [open, setOpen] = useState(false);

  const toggleMenu = useCallback(() => {
    setOpen((prev) => {
      // 開くたびに fetch し直して最新のリリースブランチを反映する
      if (!prev) fetchSelfBranches();
      return !prev;
    });
  }, [fetchSelfBranches]);

  const selectBranch = useCallback(
    (branch: string) => {
      setOpen(false);
      pullSelf(branch);
    },
    [pullSelf]
  );

  return (
    <>
      <button
        ref={buttonRef}
        onClick={toggleMenu}
        className={s.updateButton}
        title={
          selfUpdateAvailable
            ? '新しいリリースがあります。クリックで更新先ブランチを選択'
            : 'dokodemo-claude自身を更新（ブランチを選択）'
        }
      >
        <RefreshCw className={s.updateIcon} />
        <span>更新</span>
        {selfUpdateAvailable && <span className={s.updateBadge} />}
      </button>

      <PopupMenu
        open={open}
        anchorEl={buttonRef.current}
        onClose={() => setOpen(false)}
        className={s.menu}
      >
        <div className={s.menuHeader}>更新先ブランチ</div>
        {selfBranchesLoading && selfBranches.length === 0 ? (
          <div className={s.menuEmpty}>読み込み中...</div>
        ) : selfBranches.length === 0 ? (
          <div className={s.menuEmpty}>ブランチを取得できませんでした</div>
        ) : (
          selfBranches.map((branch) => (
            <button
              key={branch.name}
              onClick={() => selectBranch(branch.name)}
              className={s.menuItem}
            >
              <span className={s.menuItemCheck}>
                {branch.isCurrent && <Check />}
              </span>
              <span className={s.menuItemName}>{branch.name}</span>
              {branch.behind > 0 && (
                <span className={s.menuItemBehind}>+{branch.behind}</span>
              )}
            </button>
          ))
        )}
      </PopupMenu>
    </>
  );
}

export default SelfUpdateButton;
