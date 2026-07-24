import { useState } from 'react';
import type { GitBranch } from '@/types';
import ModalShell from '@/shared/components/ModalShell';
import Button from '@/shared/components/Button';
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
    <ModalShell
      title="ブランチを作成"
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>キャンセル</Button>
          <Button
            variant="primary"
            onClick={handleCreate}
            disabled={!branchName.trim() || isCreating}
          >
            {isCreating ? '作成中...' : '作成'}
          </Button>
        </>
      }
    >
      <div className={s.formFields} onKeyDown={handleKeyDown}>
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
    </ModalShell>
  );
}

export default BranchCreateModal;
