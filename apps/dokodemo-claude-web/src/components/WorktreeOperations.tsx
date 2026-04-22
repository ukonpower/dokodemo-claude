import { useState } from 'react';
import type { GitWorktree } from '../types';
import s from './WorktreeOperations.module.scss';

interface WorktreeOperationsProps {
  currentWorktree: GitWorktree | undefined;
  onDeleteWorktree: (worktreePath: string, deleteBranch: boolean) => void;
  onMergeWorktree: (worktreePath: string) => void;
  isConnected: boolean;
  mergeError: {
    message: string;
    conflictFiles?: string[];
    errorDetails?: string;
  } | null;
  onClearMergeError: () => void;
  isDeletingWorktree?: boolean;
}

function WorktreeOperations({
  currentWorktree,
  onDeleteWorktree,
  onMergeWorktree,
  isConnected,
  mergeError,
  onClearMergeError,
  isDeletingWorktree = false,
}: WorktreeOperationsProps) {
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [showMergeConfirm, setShowMergeConfirm] = useState(false);
  const [isMerging, setIsMerging] = useState(false);
  const [deleteBranchToo, setDeleteBranchToo] = useState(true);

  // メインワークツリーの場合は表示しない
  if (!currentWorktree || currentWorktree.isMain) {
    return null;
  }

  const handleDeleteClick = () => {
    setShowDeleteConfirm(true);
  };

  const handleConfirmDelete = () => {
    onDeleteWorktree(currentWorktree.path, deleteBranchToo);
    setShowDeleteConfirm(false);
    setDeleteBranchToo(false);
  };

  const handleCancelDelete = () => {
    setShowDeleteConfirm(false);
    setDeleteBranchToo(false);
  };

  const handleMergeClick = () => {
    setShowMergeConfirm(true);
  };

  const handleConfirmMerge = () => {
    setIsMerging(true);
    onMergeWorktree(currentWorktree.path);
    setShowMergeConfirm(false);
    setIsMerging(false);
  };

  const handleCancelMerge = () => {
    setShowMergeConfirm(false);
  };

  return (
    <div className={s.container}>
      <div className={s.layout}>
        {/* ワークツリー情報 */}
        <div className={s.infoSection}>
          <div className={s.infoIcon}>
            <svg
              className={s.infoSvg}
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M4 7v10c0 2.21 3.582 4 8 4s8-1.79 8-4V7M4 7c0 2.21 3.582 4 8 4s8-1.79 8-4M4 7c0-2.21 3.582-4 8-4s8 1.79 8 4"
              />
            </svg>
            <span className={s.infoLabel}>ワークツリー:</span>
          </div>
          <span className={s.branchName}>
            {currentWorktree.branch}
          </span>
          <span className={s.pathText}>
            ({currentWorktree.path.split('/').slice(-2).join('/')})
          </span>
        </div>

        {/* ボタングループ */}
        <div className={s.buttonGroup}>
          {/* マージボタン */}
          <button
            onClick={handleMergeClick}
            disabled={!isConnected || isMerging}
            className={s.mergeButton}
          >
            <svg
              className={s.buttonIcon}
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4"
              />
            </svg>
            {isMerging ? 'マージ中...' : 'マージ'}
          </button>

          {/* 削除ボタン */}
          <button
            onClick={handleDeleteClick}
            disabled={!isConnected || isDeletingWorktree}
            className={s.deleteButton}
          >
            <svg
              className={s.buttonIcon}
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
            {isDeletingWorktree ? '削除中...' : '削除'}
          </button>
        </div>
      </div>

      {/* 削除確認モーダル */}
      {showDeleteConfirm && (
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
                ワークツリーを削除
              </h3>
            </div>

            <p className={s.modalText}>
              ワークツリー「
              <span className={s.monoRed}>
                {currentWorktree.branch}
              </span>
              」を削除しますか？
            </p>

            <div className={s.warningBox}>
              <p className={s.warningTitle}>
                <span>注意:</span>
              </p>
              <ul className={s.warningList}>
                <li>関連するCLIセッション、ターミナル、キューも終了します</li>
                <li>未コミットの変更は失われる可能性があります</li>
              </ul>
            </div>

            {/* ブランチ削除オプション */}
            <label className={s.checkboxLabel}>
              <input
                type="checkbox"
                checked={deleteBranchToo}
                onChange={(e) => setDeleteBranchToo(e.target.checked)}
                className={s.checkbox}
              />
              <span className={s.checkboxText}>
                ブランチ「
                <span className={s.monoRed}>
                  {currentWorktree.branch}
                </span>
                」も削除する
              </span>
            </label>

            <div className={s.modalFooter}>
              <button
                onClick={handleCancelDelete}
                className={s.cancelButton}
              >
                キャンセル
              </button>
              <button
                onClick={handleConfirmDelete}
                disabled={isDeletingWorktree}
                className={s.dangerButton}
              >
                {isDeletingWorktree ? '削除中...' : '削除する'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* マージ確認モーダル */}
      {showMergeConfirm && (
        <div className={s.modalOverlay}>
          <div className={s.modalContent}>
            <div className={s.modalHeader}>
              <div className={`${s.modalIconCircle} ${s.modalIconCircleBlue}`}>
                <svg
                  className={`${s.modalIcon} ${s.modalIconBlue}`}
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4"
                  />
                </svg>
              </div>
              <h3 className={s.modalTitle}>
                ブランチをマージ
              </h3>
            </div>

            <p className={s.modalText}>
              このワークツリーのブランチを親リポジトリにマージしますか？
            </p>

            <div className={s.infoBox}>
              <ul className={s.infoList}>
                <li>
                  ブランチ:{' '}
                  <span className={s.monoBlue}>
                    {currentWorktree.branch}
                  </span>
                </li>
                <li>マージ先: 親リポジトリの現在のブランチ</li>
                <li>コンフリクトが発生した場合、マージは中止されます</li>
                <li>ワークツリーは削除されません</li>
              </ul>
            </div>

            <div className={s.modalFooter}>
              <button
                onClick={handleCancelMerge}
                className={s.cancelButton}
              >
                キャンセル
              </button>
              <button
                onClick={handleConfirmMerge}
                disabled={isMerging}
                className={s.primaryButton}
              >
                {isMerging ? 'マージ中...' : 'マージ'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* マージエラーモーダル */}
      {mergeError && (
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
                    d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                  />
                </svg>
              </div>
              <h3 className={s.modalTitle}>マージエラー</h3>
            </div>

            <p className={s.modalText}>{mergeError.message}</p>

            {mergeError.conflictFiles &&
              mergeError.conflictFiles.length > 0 && (
                <div className={s.errorBox}>
                  <p className={s.errorTitle}>
                    コンフリクトが発生したファイル:
                  </p>
                  <ul className={s.errorFileList}>
                    {mergeError.conflictFiles.map((file, index) => (
                      <li key={index} className={s.errorFileMono}>
                        {file}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

            {mergeError.errorDetails && (
              <div className={s.detailBox}>
                <p className={s.detailTitle}>
                  エラー詳細:
                </p>
                <pre className={s.detailPre}>
                  {mergeError.errorDetails}
                </pre>
              </div>
            )}

            <div className={s.modalFooterEnd}>
              <button
                onClick={onClearMergeError}
                className={s.closeButton}
              >
                閉じる
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default WorktreeOperations;
