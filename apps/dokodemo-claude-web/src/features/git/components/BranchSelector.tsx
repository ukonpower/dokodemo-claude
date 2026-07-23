import { useState, useEffect, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { ArrowDown, ArrowUp, CloudUpload, RefreshCw } from 'lucide-react';
import type { GitBranch } from '@/types';
import { useOutsideClose } from '@/shared/hooks/useOutsideClose';
import { useSocketContext } from '@/app/providers/SocketProvider';
import { useWorktreeContext } from '@/features/worktree/providers/WorktreeProvider';
import BranchCreateModal from './BranchCreateModal';
import s from './BranchSelector.module.scss';

function BranchSelector() {
  // 接続状態
  const { isConnected } = useSocketContext();

  // ブランチ・ワークツリー関連
  const {
    branches,
    currentBranch,
    switchBranch: onSwitchBranch,
    deleteBranch: onDeleteBranch,
    createBranch: onCreateBranch,
    refreshBranches: onRefreshBranches,
    pullBranch: onPullBranch,
    pullState,
    clearPullState: onClearPullState,
    syncStatus,
    isSyncStatusRefreshing,
    refreshSyncStatus: onRefreshSyncStatus,
    pushState,
    pushBranch: onPushBranch,
    clearPushState: onClearPushState,
    worktrees,
  } = useWorktreeContext();

  const isPulling = pullState?.status === 'running';
  const isPushing = pushState?.status === 'running';
  const pullLogRef = useRef<HTMLPreElement>(null);
  const pushLogRef = useRef<HTMLPreElement>(null);

  // ログが追記されたら自動で末尾までスクロール
  useEffect(() => {
    if (pullLogRef.current) {
      pullLogRef.current.scrollTop = pullLogRef.current.scrollHeight;
    }
  }, [pullState?.log]);
  useEffect(() => {
    if (pushLogRef.current) {
      pushLogRef.current.scrollTop = pushLogRef.current.scrollHeight;
    }
  }, [pushState?.log]);
  const [isOpen, setIsOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [targetBranch, setTargetBranch] = useState<string | null>(null);
  const [deleteRemoteToo, setDeleteRemoteToo] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [dropdownPosition, setDropdownPosition] = useState<{ top: number; left: number } | null>(null);
  const [pullPopupPosition, setPullPopupPosition] = useState<{
    top: number;
    left: number;
  } | null>(null);
  const [pushPopupPosition, setPushPopupPosition] = useState<{
    top: number;
    left: number;
  } | null>(null);
  const [isSyncPopoverOpen, setIsSyncPopoverOpen] = useState(false);
  const [syncPopoverPosition, setSyncPopoverPosition] = useState<{
    top: number;
    left: number;
  } | null>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const pullPopupRef = useRef<HTMLDivElement>(null);
  const pushPopupRef = useRef<HTMLDivElement>(null);
  const syncIndicatorRef = useRef<HTMLButtonElement>(null);
  const syncPopoverRef = useRef<HTMLDivElement>(null);

  // Pull モーダル（ツールチップ風ポップオーバー）の出現位置を
  // トリガーボタンの直下に揃える。表示中は scroll/resize にも追随する。
  useEffect(() => {
    if (!pullState) {
      setPullPopupPosition(null);
      return;
    }

    const updatePosition = (): void => {
      const rect = buttonRef.current?.getBoundingClientRect();
      if (!rect) return;
      setPullPopupPosition({ top: rect.bottom + 6, left: rect.left });
    };

    updatePosition();
    window.addEventListener('scroll', updatePosition, true);
    window.addEventListener('resize', updatePosition);
    return () => {
      window.removeEventListener('scroll', updatePosition, true);
      window.removeEventListener('resize', updatePosition);
    };
  }, [pullState]);

  // 成功時はログを読む暇を残しつつ、一定時間後に自動で閉じる。
  // 失敗時はメッセージを確認したいので自動非表示しない。
  useEffect(() => {
    if (pullState?.status !== 'success') return;
    const timer = setTimeout(() => {
      onClearPullState();
    }, 4000);
    return () => clearTimeout(timer);
  }, [pullState?.status, onClearPullState]);

  // ポップオーバー外クリックで閉じる。実行中は誤操作で消さないように維持する。
  useOutsideClose(
    !!pullState && pullState.status !== 'running',
    onClearPullState,
    { ignore: [pullPopupRef, buttonRef] }
  );

  // Push 進行状況ポップオーバーの出現位置を同期インジケーターの直下に揃える。
  useEffect(() => {
    if (!pushState) {
      setPushPopupPosition(null);
      return;
    }

    const updatePosition = (): void => {
      const rect = syncIndicatorRef.current?.getBoundingClientRect();
      if (!rect) return;
      setPushPopupPosition({ top: rect.bottom + 6, left: rect.left });
    };

    updatePosition();
    window.addEventListener('scroll', updatePosition, true);
    window.addEventListener('resize', updatePosition);
    return () => {
      window.removeEventListener('scroll', updatePosition, true);
      window.removeEventListener('resize', updatePosition);
    };
  }, [pushState]);

  // 成功時は一定時間後に自動で閉じる。失敗時は自動非表示しない（pull と同じ挙動）。
  useEffect(() => {
    if (pushState?.status !== 'success') return;
    const timer = setTimeout(() => {
      onClearPushState();
    }, 4000);
    return () => clearTimeout(timer);
  }, [pushState?.status, onClearPushState]);

  // ポップオーバー外クリックで閉じる。実行中は誤操作で消さないように維持する。
  useOutsideClose(
    !!pushState && pushState.status !== 'running',
    onClearPushState,
    { ignore: [pushPopupRef, syncIndicatorRef] }
  );

  const closeSyncPopover = useCallback(() => {
    setIsSyncPopoverOpen(false);
    setSyncPopoverPosition(null);
  }, []);

  useOutsideClose(isSyncPopoverOpen, closeSyncPopover, {
    ignore: [syncPopoverRef, syncIndicatorRef],
  });

  const handleToggleSyncPopover = () => {
    if (isSyncPopoverOpen) {
      closeSyncPopover();
    } else {
      const rect = syncIndicatorRef.current?.getBoundingClientRect();
      if (rect) {
        setSyncPopoverPosition({ top: rect.bottom + 4, left: rect.left });
      }
      setIsSyncPopoverOpen(true);
    }
  };

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

  useOutsideClose(isOpen, closeDropdown, {
    ignore: [dropdownRef, buttonRef],
  });

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

  // デフォルトブランチ（main/master）を常に一番上に表示する。
  // それ以外は元の並び順を安定的に維持する。
  const isDefaultBranch = (name: string): boolean =>
    name === 'main' || name === 'master';
  const localBranches = branches
    .filter((b) => !b.remote)
    .sort((a, b) => {
      const aDefault = isDefaultBranch(a.name);
      const bDefault = isDefaultBranch(b.name);
      if (aDefault === bDefault) return 0;
      return aDefault ? -1 : 1;
    });
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

      {/* VSCode 風の ahead/behind インジケーター */}
      {!syncStatus && <span className={s.syncIndicatorPlaceholder} aria-hidden />}
      {syncStatus && (
        <button
          ref={syncIndicatorRef}
          onClick={handleToggleSyncPopover}
          disabled={!isConnected}
          className={`${s.syncIndicator} ${
            syncStatus.upstream !== null &&
            syncStatus.ahead === 0 &&
            syncStatus.behind === 0
              ? s.syncIndicatorClean
              : ''
          }`}
          title={
            syncStatus.upstream
              ? `${syncStatus.upstream} と比較して ↓${syncStatus.behind} ↑${syncStatus.ahead}`
              : 'ブランチが未公開です'
          }
        >
          {syncStatus.upstream === null ? (
            <CloudUpload className={s.syncIcon} />
          ) : (
            <>
              <ArrowDown className={s.syncIcon} />
              <span>{syncStatus.behind}</span>
              <ArrowUp className={s.syncIcon} />
              <span>{syncStatus.ahead}</span>
            </>
          )}
        </button>
      )}
      {syncStatus && (
        <button
          onClick={onRefreshSyncStatus}
          disabled={!isConnected || isSyncStatusRefreshing}
          className={s.syncRefreshButton}
          title="リモートと比較して ahead/behind を更新"
          aria-label="ahead/behind を更新"
        >
          <RefreshCw
            className={`${s.syncIcon} ${
              isSyncStatusRefreshing ? s.syncIconSpinning : ''
            }`}
          />
        </button>
      )}

      {isSyncPopoverOpen &&
        syncPopoverPosition &&
        createPortal(
          <div
            ref={syncPopoverRef}
            className={s.syncPopover}
            style={{
              zIndex: 9999,
              top: syncPopoverPosition.top,
              left: syncPopoverPosition.left,
            }}
          >
            <button
              onClick={() => {
                onPullBranch();
                closeSyncPopover();
              }}
              disabled={!syncStatus || syncStatus.behind === 0 || isPulling}
              className={s.syncPopoverButton}
            >
              <ArrowDown className={s.syncIcon} />
              <span>Pull（{syncStatus?.behind ?? 0}件取り込み）</span>
            </button>
            <button
              onClick={() => {
                onPushBranch();
                closeSyncPopover();
              }}
              disabled={
                !syncStatus ||
                (syncStatus.upstream !== null && syncStatus.ahead === 0) ||
                isPushing
              }
              className={s.syncPopoverButton}
            >
              <ArrowUp className={s.syncIcon} />
              <span>
                {syncStatus?.upstream === null
                  ? 'Push（ブランチを公開）'
                  : `Push（${syncStatus?.ahead ?? 0}件送信）`}
              </span>
            </button>
          </div>,
          document.body,
        )}

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
          <div className={s.dropdownToolbar}>
            <button
              onClick={() => {
                setShowCreateModal(true);
                closeDropdown();
              }}
              className={s.toolbarButton}
              title="ブランチを作成"
            >
              <svg
                className={s.toolbarIcon}
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M12 4v16m8-8H4"
                />
              </svg>
              <span>作成</span>
            </button>
            <button
              onClick={() => {
                onPullBranch();
                closeDropdown();
              }}
              disabled={isPulling}
              className={s.toolbarButton}
              title="現在のブランチを pull (--ff-only)"
            >
              <svg
                className={s.toolbarIcon}
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M4 16v2a2 2 0 002 2h12a2 2 0 002-2v-2M7 10l5 5m0 0l5-5m-5 5V3"
                />
              </svg>
              <span>{isPulling ? 'Pull中…' : 'Pull'}</span>
            </button>
            <button
              onClick={onRefreshBranches}
              className={s.toolbarIconButton}
              title="ブランチ一覧を更新"
            >
              <svg
                className={s.toolbarIcon}
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
                />
              </svg>
            </button>
          </div>
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
                        {canDeleteBranch(branch) && (
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

      {/* ブランチ作成モーダル */}
      {showCreateModal && (
        <BranchCreateModal
          branches={branches}
          currentBranch={currentBranch}
          onClose={() => setShowCreateModal(false)}
          onCreate={(name, base) => {
            onCreateBranch(name, base);
            setShowCreateModal(false);
          }}
        />
      )}

      {/* Pull 進行状況 / 結果ポップオーバー（dropdown と統一感のあるフラットなトーン） */}
      {pullState &&
        pullPopupPosition &&
        createPortal(
          <div
            ref={pullPopupRef}
            className={`${s.pullPopup} ${
              pullState.status === 'error'
                ? s.pullPopupError
                : pullState.status === 'success'
                  ? s.pullPopupSuccess
                  : s.pullPopupRunning
            }`}
            style={{
              top: pullPopupPosition.top,
              left: pullPopupPosition.left,
            }}
          >
            <div className={s.pullPopupHeader}>
              <span className={s.pullPopupStatusDot} aria-hidden />
              <span className={s.pullPopupTitle}>
                {pullState.status === 'running'
                  ? 'Pulling'
                  : pullState.status === 'success'
                    ? 'Pull 完了'
                    : 'Pull 失敗'}
                {currentBranch && (
                  <span className={s.pullPopupBranch}>{currentBranch}</span>
                )}
              </span>
              <button
                onClick={onClearPullState}
                disabled={pullState.status === 'running'}
                className={s.pullPopupClose}
                title={pullState.status === 'running' ? 'Pull 実行中' : '閉じる'}
                aria-label="閉じる"
              >
                <svg
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
            <div className={s.pullPopupBody}>
              {pullState.status !== 'running' && pullState.message && (
                <div className={s.pullPopupMessage}>{pullState.message}</div>
              )}
              <pre ref={pullLogRef} className={s.pullPopupLog}>
                {pullState.log ? (
                  pullState.log
                ) : (
                  <span className={s.pullPopupLogPlaceholder}>
                    {pullState.status === 'running'
                      ? 'Pull中…'
                      : '出力なし'}
                  </span>
                )}
              </pre>
            </div>
          </div>,
          document.body,
        )}

      {/* Push 進行状況 / 結果ポップオーバー（Pull ポップオーバーと同一の UI・挙動） */}
      {pushState &&
        pushPopupPosition &&
        createPortal(
          <div
            ref={pushPopupRef}
            className={`${s.pullPopup} ${
              pushState.status === 'error'
                ? s.pullPopupError
                : pushState.status === 'success'
                  ? s.pullPopupSuccess
                  : s.pullPopupRunning
            }`}
            style={{
              top: pushPopupPosition.top,
              left: pushPopupPosition.left,
            }}
          >
            <div className={s.pullPopupHeader}>
              <span className={s.pullPopupStatusDot} aria-hidden />
              <span className={s.pullPopupTitle}>
                {pushState.status === 'running'
                  ? 'Pushing'
                  : pushState.status === 'success'
                    ? 'Push 完了'
                    : 'Push 失敗'}
                {currentBranch && (
                  <span className={s.pullPopupBranch}>{currentBranch}</span>
                )}
              </span>
              <button
                onClick={onClearPushState}
                disabled={pushState.status === 'running'}
                className={s.pullPopupClose}
                title={pushState.status === 'running' ? 'Push 実行中' : '閉じる'}
                aria-label="閉じる"
              >
                <svg
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
            <div className={s.pullPopupBody}>
              {pushState.status !== 'running' && pushState.message && (
                <div className={s.pullPopupMessage}>{pushState.message}</div>
              )}
              <pre ref={pushLogRef} className={s.pullPopupLog}>
                {pushState.log ? (
                  pushState.log
                ) : (
                  <span className={s.pullPopupLogPlaceholder}>
                    {pushState.status === 'running'
                      ? 'Push中…'
                      : '出力なし'}
                  </span>
                )}
              </pre>
            </div>
          </div>,
          document.body,
        )}
    </div>
  );
}

export default BranchSelector;
