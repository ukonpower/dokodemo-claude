import { useState } from 'react';
import type { GitBranch } from '../types';
import s from './WorktreeCreateModal.module.scss';

interface WorktreeCreateModalProps {
  parentRepoPath: string;
  branches: GitBranch[];
  onClose: () => void;
  onCreate: (
    branchName: string,
    baseBranch?: string,
    useExisting?: boolean
  ) => void;
}

function WorktreeCreateModal({
  branches,
  onClose,
  onCreate,
}: WorktreeCreateModalProps) {
  const [branchName, setBranchName] = useState('');
  const [baseBranch, setBaseBranch] = useState('');
  const [useExistingBranch, setUseExistingBranch] = useState(false);
  const [isCreating, setIsCreating] = useState(false);

  const handleCreate = () => {
    if (!branchName.trim()) return;
    setIsCreating(true);
    onCreate(
      branchName.trim(),
      baseBranch.trim() || undefined,
      useExistingBranch
    );
    onClose();
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && branchName.trim() && !isCreating) {
      handleCreate();
    } else if (e.key === 'Escape') {
      onClose();
    }
  };

  // 既存ブランチを使用する場合、ブランチ選択変更時にブランチ名も更新
  const handleExistingBranchSelect = (selectedBranch: string) => {
    setBranchName(selectedBranch);
  };

  return (
    <div className={s.modalOverlay}>
      <div
        className={s.modalContent}
        onKeyDown={handleKeyDown}
      >
        <div className={s.modalHeader}>
          <h3 className={s.modalTitle}>
            ワークツリーを作成
          </h3>
          <button
            onClick={onClose}
            className={s.closeButton}
          >
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
          {/* 既存ブランチを使うか選択 */}
          <div className={s.checkboxRow}>
            <input
              type="checkbox"
              id="useExisting"
              checked={useExistingBranch}
              onChange={(e) => {
                setUseExistingBranch(e.target.checked);
                setBranchName('');
              }}
              className={s.checkbox}
            />
            <label htmlFor="useExisting" className={s.checkboxLabel}>
              既存のブランチを使用
            </label>
          </div>

          {/* ブランチ名入力 / 選択 */}
          <div className={s.fieldGroup}>
            <label className={s.fieldLabel}>
              ブランチ名 <span className={s.requiredMark}>*</span>
            </label>
            {useExistingBranch ? (
              <select
                value={branchName}
                onChange={(e) => handleExistingBranchSelect(e.target.value)}
                className={s.selectInput}
              >
                <option value="">ブランチを選択...</option>
                {branches.map((branch) => (
                  <option key={branch.name} value={branch.name}>
                    {branch.name}
                    {branch.current ? ' (現在)' : ''}
                    {branch.remote ? ` (${branch.remote})` : ''}
                  </option>
                ))}
              </select>
            ) : (
              <input
                type="text"
                value={branchName}
                onChange={(e) => setBranchName(e.target.value)}
                placeholder="feature/new-feature"
                autoFocus
                className={s.textInput}
              />
            )}
            <p className={s.fieldHint}>
              ワークツリーのディレクトリ名としても使用されます
            </p>
          </div>

          {/* 新規ブランチの場合のベースブランチ */}
          {!useExistingBranch && (
            <div className={s.fieldGroup}>
              <label className={s.fieldLabel}>
                元になるブランチ
              </label>
              <select
                value={baseBranch}
                onChange={(e) => setBaseBranch(e.target.value)}
                className={s.selectInput}
              >
                <option value="">HEAD（現在のコミット）</option>
                {branches.map((branch) => (
                  <option key={branch.name} value={branch.name}>
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
          )}
        </div>

        {/* ボタン */}
        <div className={s.modalFooter}>
          <button
            onClick={onClose}
            className={s.cancelButton}
          >
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

export default WorktreeCreateModal;
