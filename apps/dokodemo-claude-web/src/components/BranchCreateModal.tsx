import { useState } from 'react';
import type { GitBranch } from '../types';
import s from './BranchCreateModal.module.scss';

interface BranchCreateModalProps {
  branches: GitBranch[];
  currentBranch: string;
  onClose: () => void;
  onCreate: (branchName: string, baseBranch?: string) => void;
}

function BranchCreateModal({
  branches,
  currentBranch,
  onClose,
  onCreate,
}: BranchCreateModalProps) {
  const [branchName, setBranchName] = useState('');
  const [baseBranch, setBaseBranch] = useState('');
  const [isCreating, setIsCreating] = useState(false);

  const handleCreate = () => {
    if (!branchName.trim()) return;
    setIsCreating(true);
    onCreate(branchName.trim(), baseBranch.trim() || undefined);
    onClose();
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && branchName.trim() && !isCreating) {
      handleCreate();
    } else if (e.key === 'Escape') {
      onClose();
    }
  };

  return (
    <div className={s.modalOverlay}>
      <div className={s.modalContent} onKeyDown={handleKeyDown}>
        <div className={s.modalHeader}>
          <h3 className={s.modalTitle}>ブランチを作成</h3>
          <button onClick={onClose} className={s.closeButton}>
            <svg
              className={s.closeIcon}
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
          </button>
        </div>

        <div className={s.formFields}>
          <div className={s.fieldGroup}>
            <label className={s.fieldLabel}>
              ブランチ名 <span className={s.requiredMark}>*</span>
            </label>
            <input
              type="text"
              value={branchName}
              onChange={(e) => setBranchName(e.target.value)}
              placeholder="feature/new-feature"
              autoFocus
              className={s.textInput}
            />
          </div>

          <div className={s.fieldGroup}>
            <label className={s.fieldLabel}>元になるブランチ</label>
            <select
              value={baseBranch}
              onChange={(e) => setBaseBranch(e.target.value)}
              className={s.selectInput}
            >
              <option value="">
                {currentBranch
                  ? `現在のブランチ (${currentBranch})`
                  : 'HEAD（現在のコミット）'}
              </option>
              {branches.map((branch) => (
                <option
                  key={`${branch.remote ?? ''}/${branch.name}`}
                  value={branch.name}
                >
                  {branch.name}
                  {branch.current ? ' (現在)' : ''}
                  {branch.remote ? ` (${branch.remote})` : ''}
                </option>
              ))}
            </select>
            <p className={s.fieldHint}>
              省略した場合は現在のHEADから新しいブランチを作成します
            </p>
          </div>
        </div>

        <div className={s.modalFooter}>
          <button onClick={onClose} className={s.cancelButton}>
            キャンセル
          </button>
          <button
            onClick={handleCreate}
            disabled={!branchName.trim() || isCreating}
            className={s.createButton}
          >
            {isCreating ? '作成中...' : '作成'}
          </button>
        </div>
      </div>
    </div>
  );
}

export default BranchCreateModal;
