import React, { useRef, useState } from 'react';
import { GitBranch, ChevronDown } from 'lucide-react';
import { useOutsideClose } from '../hooks';
import s from './GitGraphBranchDropdown.module.scss';

interface GitGraphBranchDropdownProps {
  branchOptions: { name: string; isRemote: boolean }[];
  selected: string | null; // null = Show All
  onSelect: (name: string | null) => void;
}

const SHOW_ALL_LABEL = 'Show All';

/**
 * ブランチ絞り込みの単一選択ドロップダウン（Show All + ローカル→リモート順）
 */
const GitGraphBranchDropdown: React.FC<GitGraphBranchDropdownProps> = ({
  branchOptions,
  selected,
  onSelect,
}) => {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useOutsideClose(open, () => setOpen(false), {
    ignore: [triggerRef, menuRef],
  });

  const locals = branchOptions.filter((b) => !b.isRemote);
  const remotes = branchOptions.filter((b) => b.isRemote);

  const handlePick = (name: string | null) => {
    onSelect(name);
    setOpen(false);
  };

  return (
    <div className={s.wrap}>
      <button
        ref={triggerRef}
        className={s.trigger}
        onClick={() => setOpen((o) => !o)}
        title="ブランチ絞り込み"
      >
        <GitBranch size={13} />
        <span className={s.triggerLabel}>{selected ?? SHOW_ALL_LABEL}</span>
        <ChevronDown size={13} />
      </button>

      {open && (
        <div ref={menuRef} className={s.menu}>
          <button
            className={`${s.item} ${selected === null ? s.itemActive : ''}`}
            onClick={() => handlePick(null)}
          >
            {SHOW_ALL_LABEL}
          </button>

          {locals.length > 0 && (
            <div className={s.groupLabel}>ローカル</div>
          )}
          {locals.map((b) => (
            <button
              key={`l:${b.name}`}
              className={`${s.item} ${selected === b.name ? s.itemActive : ''}`}
              onClick={() => handlePick(b.name)}
            >
              {b.name}
            </button>
          ))}

          {remotes.length > 0 && (
            <div className={s.groupLabel}>リモート</div>
          )}
          {remotes.map((b) => (
            <button
              key={`r:${b.name}`}
              className={`${s.item} ${s.itemRemote} ${
                selected === b.name ? s.itemActive : ''
              }`}
              onClick={() => handlePick(b.name)}
            >
              {b.name}
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

export default GitGraphBranchDropdown;
