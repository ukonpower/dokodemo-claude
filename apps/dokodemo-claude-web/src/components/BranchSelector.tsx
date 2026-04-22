import { useState, useEffect, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import type { GitBranch, GitWorktree } from '../types';
import s from './BranchSelector.module.scss';

interface BranchSelectorProps {
  branches: GitBranch[];
  currentBranch: string;
  onSwitchBranch: (branchName: string) => void;
  onDeleteBranch?: (branchName: string, deleteRemote: boolean) => void;
  worktrees?: GitWorktree[];
  isConnected: boolean;
}

function BranchSelector({
  branches,
  currentBranch,
  onSwitchBranch,
  onDeleteBranch,
  worktrees = [],
  isConnected,
}: BranchSelectorProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [targetBranch, setTargetBranch] = useState<string | null>(null);
  const [deleteRemoteToo, setDeleteRemoteToo] = useState(false);
  const [dropdownPosition, setDropdownPosition] = useState<{ top: number; left: number } | null>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  // ワークツリーで使用中のブランチ一覧
  const worktreeBranches = worktrees.map((wt) => wt.branch);

  // ブランチが削除可能かどうかを判定
  const canDeleteBranch = (branch: GitBranch): boolean => {
    if (branch.remote) return false;
    if (branch.current) return false;
    if (branch.name === 'main' || branch.name === 'master') return false;
    if (worktreeBranches.includes(branch.name)) return false;
    return true;
  };

  const handleDeleteClick = (e: React.MouseEvent, branchName: string) => {
    e.stopPropagation();
    setTargetBranch(branchName);
    setShowDeleteConfirm(true);
  };

  const handleConfirmDelete = () => {
    if (targetBranch && onDeleteBranch) {
      onDeleteBranch(targetBranch, deleteRemoteToo);
    }
    setShowDeleteConfirm(false);
    setTargetBranch(null);
    setDeleteRemoteToo(false);
  };

  const handleCancelDelete = () => {
    setShowDeleteConfirm(false);
    setTargetBranch(null);
    setDeleteRemoteToo(false);
  };

  const closeDropdown = useCallback(() => {
    setIsOpen(false);
    setDropdownPosition(null);
  }, []);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(event.target as Node) &&
        buttonRef.current &&
        !buttonRef.current.contains(event.target as Node)
      ) {
        closeDropdown();
      }
    };

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isOpen, closeDropdown]);

  const handleToggleDropdown = () => {
    if (isOpen) {
      closeDropdown();
    } else {
      if (buttonRef.current) {
        const rect = buttonRef.current.getBoundingClientRect();
        setDropdownPosition({
          top: rect.bottom + 4,
          left: rect.left,
        });
      }
      setIsOpen(true);
    }
  };

  const handleBranchSwitch = async (branchName: string) => {
    if (branchName === currentBranch) {
      closeDropdown();
      return;
    }

    setIsLoading(true);
    onSwitchBranch(branchName);
    closeDropdown();

    setTimeout(() => {
      setIsLoading(false);
    }, 3000);
  };

  const localBranches = branches.filter((b) => !b.remote);
  const remoteBranches = branches.filter((b) => b.remote);

  return (
    <div className={s.wrapper}>
      <button
        ref={buttonRef}
        onClick={handleToggleDropdown}
        disabled={!isConnected || isLoading}
        className={s.triggerButton}
      >
        <svg
          className={s.branchIcon}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M13 7l5 5m0 0l-5 5m5-5H6"
          />
        </svg>
        <span className={s.branchName}>
          {isLoading ? '...' : currentBranch || 'ブランチ'}
        </span>
        <svg
          className={`${s.chevron} ${isOpen ? s.chevronOpen : ''}`}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M19 9l-7 7-7-7"
          />
        </svg>
      </button>

      {isOpen && dropdownPosition && createPortal(
        <div
          ref={dropdownRef}
          className={s.dropdown}
          style={{
            zIndex: 9999,
            top: dropdownPosition.top,
            left: dropdownPosition.left,
          }}
        >
          <div className={s.dropdownList}>
            {branches.length === 0 ? (
              <div className={s.emptyMessage}>
                ブランチが見つかりません
              </div>
            ) : (
              <>
                {localBranches.length > 0 && (
                  <>
                    <div className={s.groupLabel}>
                      ローカルブランチ
                    </div>
                    {localBranches.map((branch) => (
                      <div
                        key={branch.name}
                        className={`${s.branchItem} ${
                          branch.current ? s.branchItemCurrent : s.branchItemDefault
                        }`}
                      >
                        <button
                          onClick={() => handleBranchSwitch(branch.name)}
                          className={s.branchButton}
                        >
                          <span className={s.branchButtonName}>{branch.name}</span>
                          {branch.current && (
                            <svg
                              className={s.checkIcon}
                              fill="currentColor"
                              viewBox="0 0 20 20"
                            >
                              <path
                                fillRule="evenodd"
                                d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                                clipRule="evenodd"
                              />
                            </svg>
                          )}
                        </button>
                        {onDeleteBranch && canDeleteBranch(branch) && (
                          <button
                            onClick={(e) => handleDeleteClick(e, branch.name)}
                            className={s.deleteButton}
                            title={`ブランチ「${branch.name}」を削除`}
                          >
                            <svg
                              className={s.deleteIcon}
                              fill="none"
                              stroke="currentColor"
                              viewBox="0 0 24 24"
                            >
                              <path
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                strokeWidth={2}
                                d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
                              />
                            </svg>
                          </button>
                        )}
                      </div>
                    ))}
                  </>
                )}

                {remoteBranches.length > 0 && (
                  <>
                    <div className={s.groupLabelBorder}>
                      リモートブランチ
                    </div>
                    {remoteBranches.map((branch) => (
                      <button
                        key={`${branch.remote}/${branch.name}`}
                        onClick={() => handleBranchSwitch(branch.name)}
                        className={s.remoteBranchButton}
                      >
                        <svg
                          className={s.remoteIcon}
                          fill="currentColor"
                          viewBox="0 0 20 20"
                        >
                          <path
                            fillRule="evenodd"
                            d="M12.586 4.586a2 2 0 112.828 2.828l-3 3a2 2 0 01-2.828 0 1 1 0 00-1.414 1.414 4 4 0 005.656 0l3-3a4 4 0 00-5.656-5.656l-1.5 1.5a1 1 0 101.414 1.414l1.5-1.5zm-5 5a2 2 0 012.828 0 1 1 0 101.414-1.414 4 4 0 00-5.656 0l-3 3a4 4 0 105.656 5.656l1.5-1.5a1 1 0 10-1.414-1.414l-1.5 1.5a2 2 0 11-2.828-2.828l3-3z"
                            clipRule="evenodd"
                          />
                        </svg>
                        <span className={s.remoteName}>{branch.name}</span>
                      </button>
                    ))}
                  </>
                )}
              </>
            )}
          </div>
        </div>,
        document.body
      )}

      {/* 削除確認モーダル */}
      {showDeleteConfirm && targetBranch && (
        <div className={s.modalOverlay}>
          <div className={s.modalContent}>
            <div className={s.modalHeader}>
              <div className={`${s.modalIconCircle} ${s.modalIconCircleRed}`}>
                <svg
                  className={`${s.modalIcon} ${s.modalIconRed}`}
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
                  />
                </svg>
              </div>
              <h3 className={s.modalTitle}>
                ブランチを削除
              </h3>
            </div>

            <p className={s.modalText}>
              ブランチ「
              <span className={s.monoRed}>{targetBranch}</span>
              」を削除しますか？
            </p>

            <div className={s.warningBox}>
              <p className={s.warningTitle}>
                <span>注意:</span>
              </p>
              <ul className={s.warningList}>
                <li>この操作は取り消せません</li>
                <li>マージされていないコミットは失われます</li>
              </ul>
            </div>

            {/* リモートブランチ削除オプション */}
            {branches.some(
              (b) => b.remote === 'origin' && b.name === targetBranch
            ) && (
              <label className={s.checkboxLabelGroup}>
                <input
                  type="checkbox"
                  checked={deleteRemoteToo}
                  onChange={(e) => setDeleteRemoteToo(e.target.checked)}
                  className={s.checkbox}
                />
                <span className={s.checkboxText}>
                  リモートブランチ（origin/{targetBranch}）も削除する
                </span>
              </label>
            )}

            <div className={s.modalFooter}>
              <button
                onClick={handleCancelDelete}
                className={s.cancelButton}
              >
                キャンセル
              </button>
              <button
                onClick={handleConfirmDelete}
                className={s.dangerButton}
              >
                削除する
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default BranchSelector;
