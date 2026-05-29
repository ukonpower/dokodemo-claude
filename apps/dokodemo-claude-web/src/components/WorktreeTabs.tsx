import { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
  type Modifier,
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  horizontalListSortingStrategy,
  useSortable,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import type { GitWorktree, GitBranch, WorktreeSyncEntry } from '../types';
import type {
  WorktreeSyncConfigState,
  WorktreeSyncCandidatesState,
} from '../hooks/useBranchWorktree';
import WorktreeCreateModal from './WorktreeCreateModal';
import s from './WorktreeTabs.module.scss';

// ドラッグ移動を横軸のみに制限する modifier
const restrictToHorizontalAxis: Modifier = ({ transform }) => ({
  ...transform,
  y: 0,
});

interface SortableWorktreeTabProps {
  wt: GitWorktree;
  isActive: boolean;
  isMenuOpen: boolean;
  compact: boolean;
  isConnected: boolean;
  onSwitch: (path: string) => void;
  onMenuClick: (
    e: React.MouseEvent<HTMLButtonElement>,
    wt: GitWorktree
  ) => void;
}

/**
 * ドラッグ&ドロップで並び替え可能なブランチワークツリータブ
 */
function SortableWorktreeTab({
  wt,
  isActive,
  isMenuOpen,
  compact,
  isConnected,
  onSwitch,
  onMenuClick,
}: SortableWorktreeTabProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: wt.path });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
    zIndex: isDragging ? 10 : undefined,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      className={`${s.tabWrapper} ${compact ? s.compactStyle : s.normalStyle} ${isActive ? s.active : ''}`}
    >
      <a
        href={`?repo=${encodeURIComponent(wt.path)}`}
        draggable={false}
        onClick={(e) => {
          if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) {
            return;
          }
          e.preventDefault();
          if (isActive) return;
          onSwitch(wt.path);
        }}
        className={`${s.tabButton} ${compact ? s.compact : s.normal} ${isActive ? s.active : ''}`}
      >
        <span className={`${s.tabBranchName} ${compact ? s.compact : s.normal}`}>
          {wt.branch}
        </span>
        {isActive && (
          <span
            className={`${s.activeDot} ${compact ? s.compact : s.normal}`}
          ></span>
        )}
      </a>

      {/* 3点リーダーメニュー */}
      <button
        onClick={(e) => onMenuClick(e, wt)}
        disabled={!isConnected}
        className={`${s.menuButton} ${compact ? s.compact : s.normal} ${isMenuOpen ? s.open : ''}`}
        title="ワークツリー操作"
      >
        <svg
          className={`${s.menuIcon} ${compact ? s.compact : s.normal}`}
          fill="currentColor"
          viewBox="0 0 20 20"
        >
          <path d="M10 6a2 2 0 110-4 2 2 0 010 4zM10 12a2 2 0 110-4 2 2 0 010 4zM10 18a2 2 0 110-4 2 2 0 010 4z" />
        </svg>
      </button>
    </div>
  );
}

interface WorktreeTabsProps {
  worktrees: GitWorktree[];
  currentWorktreePath: string;
  parentRepoPath: string;
  onCreateWorktree: (
    branchName: string,
    baseBranch: string | undefined,
    useExisting: boolean,
    syncEntries: WorktreeSyncEntry[]
  ) => void;
  onReorderWorktrees: (orderedBranchPaths: string[]) => void;
  onDeleteWorktree: (worktreePath: string, deleteBranch: boolean) => void;
  onMergeWorktree: (worktreePath: string) => void;
  onSwitchRepository: (path: string) => void;
  isConnected: boolean;
  branches: GitBranch[];
  onRefreshBranches: () => void;
  isDeletingWorktree?: boolean;
  compact?: boolean;
  syncConfig: WorktreeSyncConfigState | null;
  onRequestSyncConfig: () => void;
  onSaveSyncConfig: (entries: WorktreeSyncEntry[]) => void;
  syncCandidates: WorktreeSyncCandidatesState | null;
  onRequestSyncCandidates: (dirPath: string) => void;
  worktreeCreateError: { message: string } | null;
  worktreeCreateSuccessNonce: number;
  onClearWorktreeCreateError: () => void;
}

function WorktreeTabs({
  worktrees,
  currentWorktreePath,
  parentRepoPath,
  onCreateWorktree,
  onReorderWorktrees,
  onDeleteWorktree,
  onMergeWorktree,
  onSwitchRepository,
  isConnected,
  branches,
  onRefreshBranches,
  isDeletingWorktree = false,
  compact = false,
  syncConfig,
  onRequestSyncConfig,
  onSaveSyncConfig,
  syncCandidates,
  onRequestSyncCandidates,
  worktreeCreateError,
  worktreeCreateSuccessNonce,
  onClearWorktreeCreateError,
}: WorktreeTabsProps) {
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [menuOpenPath, setMenuOpenPath] = useState<string | null>(null);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [showMergeConfirm, setShowMergeConfirm] = useState(false);
  const [targetWorktree, setTargetWorktree] = useState<GitWorktree | null>(
    null
  );
  const [isMerging, setIsMerging] = useState(false);
  const [deleteBranchToo, setDeleteBranchToo] = useState(false);
  const [menuPosition, setMenuPosition] = useState<{
    top: number;
    left: number;
  } | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  // ドラッグが発生したかどうか（直後のタブ click を握り潰すために使用）
  const draggingOccurredRef = useRef(false);

  // ドラッグ&ドロップ用センサー（8px動かすまではクリック扱い）
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 8 },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  // メニュー外クリックで閉じる
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setMenuOpenPath(null);
        setMenuPosition(null);
      }
    };

    if (menuOpenPath) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [menuOpenPath]);

  // ワークツリー作成が成功したら作成モーダルを閉じる
  const lastCreateSuccessNonceRef = useRef(worktreeCreateSuccessNonce);
  useEffect(() => {
    if (worktreeCreateSuccessNonce !== lastCreateSuccessNonceRef.current) {
      lastCreateSuccessNonceRef.current = worktreeCreateSuccessNonce;
      setShowCreateModal(false);
    }
  }, [worktreeCreateSuccessNonce]);

  const handleMenuClick = (
    e: React.MouseEvent<HTMLButtonElement>,
    wt: GitWorktree
  ) => {
    e.stopPropagation();
    if (menuOpenPath === wt.path) {
      setMenuOpenPath(null);
      setMenuPosition(null);
    } else {
      const rect = e.currentTarget.getBoundingClientRect();
      setMenuPosition({
        top: rect.bottom + 4,
        left: rect.left,
      });
      setMenuOpenPath(wt.path);
    }
  };

  const handleDeleteClick = (wt: GitWorktree) => {
    setTargetWorktree(wt);
    setShowDeleteConfirm(true);
    setMenuOpenPath(null);
  };

  const handleMergeClick = (wt: GitWorktree) => {
    setTargetWorktree(wt);
    setShowMergeConfirm(true);
    setMenuOpenPath(null);
  };

  const handleConfirmDelete = () => {
    if (targetWorktree) {
      onDeleteWorktree(targetWorktree.path, deleteBranchToo);
      // 親リポジトリへの切り替えはworktree-deletedイベント受信時に行う
      // 削除中状態はApp.tsx側で管理（isDeletingWorktree）
      setShowDeleteConfirm(false);
      setTargetWorktree(null);
      setDeleteBranchToo(false);
    }
  };

  const handleConfirmMerge = () => {
    if (targetWorktree) {
      setIsMerging(true);
      onMergeWorktree(targetWorktree.path);
      // マージ結果はworktree-mergedイベントで処理される
      setShowMergeConfirm(false);
      setTargetWorktree(null);
      setIsMerging(false);
    }
  };

  // ワークツリーが1つ以下（メインのみ）の場合は表示しない
  if (worktrees.length <= 1 && !showCreateModal) {
    return (
      <div className={`${s.singleRoot} ${compact ? '' : s.normal}`}>
        <div className={`${s.singleInner} ${compact ? '' : s.normal}`}>
          <button
            onClick={() => setShowCreateModal(true)}
            disabled={!isConnected}
            className={`${s.createButton} ${compact ? s.compact : s.normal}`}
            title="新しいワークツリーを作成"
          >
            <svg
              className={`${s.createIcon} ${compact ? s.compact : s.normal}`}
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
            {!compact && 'ワークツリーを作成'}
          </button>
        </div>

        {showCreateModal && (
          <WorktreeCreateModal
            parentRepoPath={parentRepoPath}
            branches={branches}
            onRefreshBranches={onRefreshBranches}
            syncConfig={syncConfig}
            onRequestSyncConfig={onRequestSyncConfig}
            onSaveSyncConfig={onSaveSyncConfig}
            syncCandidates={syncCandidates}
            onRequestSyncCandidates={onRequestSyncCandidates}
            worktreeCreateError={worktreeCreateError}
            onClose={() => {
              setShowCreateModal(false);
              onClearWorktreeCreateError();
            }}
            onCreate={onCreateWorktree}
          />
        )}
      </div>
    );
  }

  // パスを正規化してアクティブ判定
  const normalizedCurrentPath = currentWorktreePath.replace(/\/+$/, '');
  const isWorktreeActive = (wt: GitWorktree) =>
    wt.path.replace(/\/+$/, '') === normalizedCurrentPath;

  // メインワークツリーとブランチワークツリーを分離
  const mainWorktree = worktrees.find((wt) => wt.isMain);
  const branchWorktrees = worktrees.filter((wt) => !wt.isMain);

  // ドラッグ開始（このあと発火するタブ click を握り潰す目印）
  const handleDragStart = () => {
    draggingOccurredRef.current = true;
  };

  // ドラッグ終了時に並び替えを反映
  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const paths = branchWorktrees.map((wt) => wt.path);
    const oldIndex = paths.indexOf(active.id as string);
    const newIndex = paths.indexOf(over.id as string);
    if (oldIndex === -1 || newIndex === -1) return;
    onReorderWorktrees(arrayMove(paths, oldIndex, newIndex));
  };

  return (
    <div className={`${s.root} ${compact ? '' : s.normal}`}>
      <div className={s.tabsContainer}>
        {/* メインワークツリー（左固定） */}
        {mainWorktree && (
          <div className={s.mainSection}>
            <div
              className={`${s.mainTab} ${compact ? s.compactStyle : s.normalStyle} ${isWorktreeActive(mainWorktree) ? s.active : ''}`}
            >
              <a
                href={`?repo=${encodeURIComponent(mainWorktree.path)}`}
                onClick={(e) => {
                  if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) {
                    return;
                  }
                  e.preventDefault();
                  if (isWorktreeActive(mainWorktree)) return;
                  onSwitchRepository(mainWorktree.path);
                }}
                className={`${s.tabButton} ${compact ? s.compact : s.normal} ${isWorktreeActive(mainWorktree) ? s.active : ''}`}
              >
                <svg
                  className={`${s.mainIcon} ${compact ? s.compact : s.normal}`}
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6"
                  />
                </svg>
                <span className={`${s.tabBranchName} ${compact ? s.compact : s.normal}`}>
                  {mainWorktree.branch}
                </span>
                {isWorktreeActive(mainWorktree) && (
                  <span className={`${s.activeDot} ${compact ? s.compact : s.normal}`}></span>
                )}
              </a>
            </div>
            <div className={s.divider}></div>
          </div>
        )}

        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          modifiers={[restrictToHorizontalAxis]}
          onDragStart={handleDragStart}
          onDragEnd={handleDragEnd}
        >
          <SortableContext
            items={branchWorktrees.map((wt) => wt.path)}
            strategy={horizontalListSortingStrategy}
          >
            <div
              className={s.tabsScroll}
              // ドラッグ操作の起点。次のドラッグ前にフラグをリセット
              onPointerDownCapture={() => {
                draggingOccurredRef.current = false;
              }}
              // ドラッグ直後にどのタブで発火しても click を握り潰す
              onClickCapture={(e) => {
                if (draggingOccurredRef.current) {
                  e.stopPropagation();
                  e.preventDefault();
                  draggingOccurredRef.current = false;
                }
              }}
            >
              {/* ブランチワークツリータブ */}
              {branchWorktrees.map((wt) => (
                <SortableWorktreeTab
                  key={wt.path}
                  wt={wt}
                  isActive={isWorktreeActive(wt)}
                  isMenuOpen={menuOpenPath === wt.path}
                  compact={compact}
                  isConnected={isConnected}
                  onSwitch={onSwitchRepository}
                  onMenuClick={handleMenuClick}
                />
              ))}

              {/* 新規作成ボタン */}
              <button
                onClick={() => setShowCreateModal(true)}
                disabled={!isConnected}
                className={`${s.newButton} ${compact ? s.compact : s.normal}`}
                title="新しいワークツリーを作成"
              >
                <svg
                  className={`${s.newIcon} ${compact ? s.compact : s.normal}`}
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
              </button>
            </div>
          </SortableContext>
        </DndContext>
      </div>

      {/* ワークツリー操作メニュー（Portalでbodyに描画） */}
      {menuOpenPath && menuPosition && createPortal(
        <div
          ref={menuRef}
          className={s.portalMenu}
          style={{
            top: menuPosition.top,
            left: menuPosition.left,
          }}
        >
          {(() => {
            const wt = worktrees.find((w) => w.path === menuOpenPath);
            if (!wt) return null;
            return (
              <>
                <button
                  onClick={() => handleMergeClick(wt)}
                  className={`${s.menuItem} ${s.mergeItem}`}
                >
                  <svg
                    className={s.menuItemIcon}
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
                  マージ
                </button>
                <button
                  onClick={() => handleDeleteClick(wt)}
                  disabled={isDeletingWorktree}
                  className={`${s.menuItem} ${s.deleteItem}`}
                >
                  <svg
                    className={s.menuItemIcon}
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
                  削除
                </button>
              </>
            );
          })()}
        </div>,
        document.body
      )}

      {/* 作成モーダル */}
      {showCreateModal && (
        <WorktreeCreateModal
          parentRepoPath={parentRepoPath}
          branches={branches}
          onRefreshBranches={onRefreshBranches}
          syncConfig={syncConfig}
          onRequestSyncConfig={onRequestSyncConfig}
          onSaveSyncConfig={onSaveSyncConfig}
          syncCandidates={syncCandidates}
          onRequestSyncCandidates={onRequestSyncCandidates}
          worktreeCreateError={worktreeCreateError}
          onClose={() => {
            setShowCreateModal(false);
            onClearWorktreeCreateError();
          }}
          onCreate={onCreateWorktree}
        />
      )}

      {/* 削除確認モーダル */}
      {showDeleteConfirm && targetWorktree && (
        <div className={s.modalOverlay}>
          <div className={s.modalContent}>
            <div className={s.modalHeader}>
              <div className={`${s.modalIconWrapper} ${s.danger}`}>
                <svg
                  className={`${s.modalIcon} ${s.danger}`}
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

            <p className={s.modalDescription}>
              ワークツリー「
              <span className={s.modalBranchName}>
                {targetWorktree.branch}
              </span>
              」を削除しますか？
            </p>

            <div className={`${s.warningBox} ${s.yellow}`}>
              <p className={s.warningTitle}>
                <span style={{ fontWeight: 600 }}>注意:</span>
              </p>
              <ul className={`${s.warningList} ${s.yellow}`}>
                <li>• 関連するCLIセッション、ターミナル、キューも終了します</li>
                <li>• 未コミットの変更は失われる可能性があります</li>
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
                <span className={s.modalBranchName}>
                  {targetWorktree.branch}
                </span>
                」も削除する
              </span>
            </label>

            <div className={s.modalFooter}>
              <button
                onClick={() => {
                  setShowDeleteConfirm(false);
                  setTargetWorktree(null);
                  setDeleteBranchToo(false);
                }}
                className={s.cancelButton}
              >
                キャンセル
              </button>
              <button
                onClick={handleConfirmDelete}
                disabled={isDeletingWorktree}
                className={`${s.confirmButton} ${s.danger}`}
              >
                {isDeletingWorktree ? '削除中...' : '削除する'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* マージ確認モーダル */}
      {showMergeConfirm && targetWorktree && (
        <div className={s.modalOverlay}>
          <div className={s.modalContent}>
            <div className={s.modalHeader}>
              <div className={`${s.modalIconWrapper} ${s.info}`}>
                <svg
                  className={`${s.modalIcon} ${s.info}`}
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

            <p className={s.modalDescription}>
              このワークツリーのブランチを親リポジトリにマージしますか？
            </p>

            <div className={`${s.warningBox} ${s.blue}`}>
              <ul className={`${s.warningList} ${s.blue}`}>
                <li>
                  • ブランチ:{' '}
                  <span className={s.modalBranchNameBlue}>
                    {targetWorktree.branch}
                  </span>
                </li>
                <li>• マージ先: 親リポジトリの現在のブランチ</li>
                <li>• コンフリクトが発生した場合、マージは中止されます</li>
                <li>• ワークツリーは削除されません</li>
              </ul>
            </div>

            <div className={s.modalFooter}>
              <button
                onClick={() => {
                  setShowMergeConfirm(false);
                  setTargetWorktree(null);
                }}
                className={s.cancelButton}
              >
                キャンセル
              </button>
              <button
                onClick={handleConfirmMerge}
                disabled={isMerging}
                className={`${s.confirmButton} ${s.info}`}
              >
                {isMerging ? 'マージ中...' : 'マージ'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default WorktreeTabs;
