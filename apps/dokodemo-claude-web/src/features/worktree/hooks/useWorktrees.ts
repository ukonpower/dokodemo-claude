import { useState, useEffect, useCallback, useRef } from 'react';
import { Socket } from 'socket.io-client';
import type {
  GitWorktree,
  ServerToClientEvents,
  ClientToServerEvents,
  WorktreeSyncEntry,
} from '@/types';
import { repositoryIdMap } from '@/shared/utils/repository-id-map';
import { useRefreshOnFocus } from '@/shared/hooks/useRefreshOnFocus';
import {
  getLastWorktreeForParent,
  setLastWorktreeForParent,
} from '@/shared/utils/last-tab-storage';

/**
 * worktree 作成時のファイル同期設定（リポジトリ単位の保存値）
 */
export interface WorktreeSyncConfigState {
  parentRepoPath: string;
  entries: WorktreeSyncEntry[];
  // 直近の保存試行のタイムスタンプ・結果
  lastSavedAt?: number;
  lastSaveError?: string;
}

/**
 * worktree 同期対象候補（親リポジトリ内の指定ディレクトリ直下の列挙結果）
 */
export interface WorktreeSyncCandidatesState {
  parentRepoPath: string;
  dirPath: string;
  entries: { name: string; type: 'file' | 'directory' }[];
}

/**
 * 新しいworktree構造かどうかをチェック
 */
function isNewWorktreeFormat(
  worktreePath: string,
  parentRepoPath: string | undefined
): boolean {
  if (!parentRepoPath) return false;
  const projectName = parentRepoPath.split('/').pop();
  if (!projectName) return false;

  const expectedPrefix = `/.dokodemo-worktrees/${projectName}/`;
  return worktreePath.includes(expectedPrefix);
}

/**
 * useWorktrees フックの戻り値
 */
export interface UseWorktreesReturn {
  // ワークツリー状態
  worktrees: GitWorktree[];
  parentRepoPath: string;
  mergeError: {
    message: string;
    conflictFiles?: string[];
    errorDetails?: string;
  } | null;
  worktreeCreateError: { message: string } | null;
  worktreeCreateSuccessNonce: number;
  isDeletingWorktree: boolean;
  deletingWorktreePath: string | null;

  // ワークツリーアクション
  createWorktree: (
    branchName: string,
    baseBranch?: string,
    useExisting?: boolean,
    syncEntries?: WorktreeSyncEntry[]
  ) => void;
  deleteWorktree: (worktreePath: string, deleteBranch?: boolean) => void;
  mergeWorktree: (worktreePath: string) => void;
  switchWorktree: (worktreePath: string) => void;
  reorderWorktrees: (orderedBranchPaths: string[]) => void;
  saveWorktreeMemo: (worktreePath: string, memo: string) => void;

  // ワークツリー同期設定
  worktreeSyncConfig: WorktreeSyncConfigState | null;
  requestWorktreeSyncConfig: () => void;
  saveWorktreeSyncConfig: (entries: WorktreeSyncEntry[]) => void;

  // ワークツリー同期対象候補
  worktreeSyncCandidates: WorktreeSyncCandidatesState | null;
  requestWorktreeSyncCandidates: (dirPath: string) => void;

  // UI制御
  setMergeError: (
    error: {
      message: string;
      conflictFiles?: string[];
      errorDetails?: string;
    } | null
  ) => void;
  clearWorktreeCreateError: () => void;

  // クリア関数（リポジトリ切り替え時用）
  clearState: () => void;
}

/**
 * ワークツリー管理を行うカスタムフック
 */
export function useWorktrees(
  socket: Socket<ServerToClientEvents, ClientToServerEvents> | null,
  currentRepo: string,
  onSwitchRepository: (path: string) => void
): UseWorktreesReturn {
  // ワークツリー状態
  const [worktrees, setWorktrees] = useState<GitWorktree[]>([]);
  const [parentRepoPath, setParentRepoPath] = useState<string>('');
  const [mergeError, setMergeError] = useState<{
    message: string;
    conflictFiles?: string[];
    errorDetails?: string;
  } | null>(null);
  const [isDeletingWorktree, setIsDeletingWorktree] = useState(false);
  const [deletingWorktreePath, setDeletingWorktreePath] = useState<
    string | null
  >(null);
  const [worktreeCreateError, setWorktreeCreateError] = useState<{
    message: string;
  } | null>(null);
  const [worktreeCreateSuccessNonce, setWorktreeCreateSuccessNonce] =
    useState(0);

  // ワークツリー同期設定
  const [worktreeSyncConfig, setWorktreeSyncConfig] =
    useState<WorktreeSyncConfigState | null>(null);

  // ワークツリー同期対象候補
  const [worktreeSyncCandidates, setWorktreeSyncCandidates] =
    useState<WorktreeSyncCandidatesState | null>(null);

  // Ref
  const currentRepoRef = useRef(currentRepo);
  const parentRepoPathRef = useRef(parentRepoPath);
  const recentlyDeletedWorktreesRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    currentRepoRef.current = currentRepo;
  }, [currentRepo]);
  useEffect(() => {
    parentRepoPathRef.current = parentRepoPath;
  }, [parentRepoPath]);

  // タブ復帰時にワークツリー一覧を再取得する。
  // PR 状況（prInfo）は worktrees-list に相乗りして届くため、GitHub 側で
  // PR が作成・マージされても、ここで再取得しない限り画面に反映されない。
  // gh CLI の呼び出し頻度はサーバ側の PR キャッシュ（30秒 TTL）で抑制される。
  useRefreshOnFocus(() => {
    if (!socket || !socket.connected) return;
    const repoPath = currentRepoRef.current;
    if (!repoPath) return;
    const rid = repositoryIdMap.getRid(repoPath);
    if (!rid) return;
    socket.emit('list-worktrees', { rid });
  });

  // Socketイベントリスナー
  useEffect(() => {
    if (!socket) return;

    // ワークツリー一覧
    const handleWorktreesList = (
      data: Parameters<ServerToClientEvents['worktrees-list']>[0]
    ) => {
      const currentPath = currentRepoRef.current;
      if (!currentPath) return;

      const isRelevant =
        data.parentRepoPath === currentPath ||
        currentPath.startsWith(data.parentRepoPath + '/.worktrees/') ||
        isNewWorktreeFormat(currentPath, data.parentRepoPath);

      if (isRelevant) {
        const deletedPaths = recentlyDeletedWorktreesRef.current;
        const filteredWorktrees = data.worktrees.filter(
          (wt: { path: string }) => !deletedPaths.has(wt.path)
        );
        setWorktrees(filteredWorktrees);
        setParentRepoPath(data.parentRepoPath || '');
      }
    };

    // ワークツリー作成
    const handleWorktreeCreated = (
      data: Parameters<ServerToClientEvents['worktree-created']>[0]
    ) => {
      if (!data.success) {
        setWorktreeCreateError({ message: data.message });
        return;
      }

      setWorktreeCreateError(null);
      setWorktreeCreateSuccessNonce((n) => n + 1);

      if (data.worktree?.path) {
        // 最終アクセス時刻は onSwitchRepository → useRepository の useEffect [currentRepo] 経路で emit される
        onSwitchRepository(data.worktree.path);
      }
    };

    // ワークツリー削除
    const handleWorktreeDeleted = (
      data: Parameters<ServerToClientEvents['worktree-deleted']>[0]
    ) => {
      const logFn = data.success ? console.log : console.error;
      logFn(data.message);

      setIsDeletingWorktree(false);
      setDeletingWorktreePath(null);

      if (data.success) {
        const deletedPath = (data as { worktreePath?: string }).worktreePath;
        if (deletedPath) {
          recentlyDeletedWorktreesRef.current.add(deletedPath);
          setTimeout(() => {
            recentlyDeletedWorktreesRef.current.delete(deletedPath);
          }, 5000);
          setWorktrees((prev) => prev.filter((wt) => wt.path !== deletedPath));

          const currentPath = currentRepoRef.current;
          const parentPath = parentRepoPathRef.current;
          // 削除した worktree が「次回ホームから開く先」として保存されていれば
          // 親リポへ戻す（stale な参照で broken state にならないように）。
          if (
            parentPath &&
            getLastWorktreeForParent(parentPath) === deletedPath
          ) {
            setLastWorktreeForParent(parentPath, parentPath);
          }
          if (currentPath === deletedPath && parentPath) {
            onSwitchRepository(parentPath);
          }
        }
      }
    };

    // ワークツリーマージ
    const handleWorktreeMerged = (
      data: Parameters<ServerToClientEvents['worktree-merged']>[0]
    ) => {
      if (data.success) {
        console.log(data.message);
      } else {
        console.error(data.message);
        setMergeError({
          message: data.message,
          conflictFiles: data.mergeResult?.conflictFiles,
          errorDetails: data.mergeResult?.errorDetails,
        });
      }
    };

    // ワークツリー同期設定（取得）
    const handleWorktreeSyncConfig = (
      data: Parameters<ServerToClientEvents['worktree-sync-config']>[0]
    ) => {
      const parentPath = parentRepoPathRef.current || currentRepoRef.current;
      if (!parentPath) return;
      if (data.parentRepoPath !== parentPath) return;
      setWorktreeSyncConfig({
        parentRepoPath: data.parentRepoPath,
        entries: data.entries,
      });
    };

    // ワークツリー同期設定（保存）
    const handleWorktreeSyncConfigSaved = (
      data: Parameters<ServerToClientEvents['worktree-sync-config-saved']>[0]
    ) => {
      setWorktreeSyncConfig((prev) => {
        if (!prev) return prev;
        if (
          data.parentRepoPath &&
          data.parentRepoPath !== prev.parentRepoPath
        ) {
          return prev;
        }
        return {
          ...prev,
          lastSavedAt: data.success ? Date.now() : prev.lastSavedAt,
          lastSaveError: data.success ? undefined : data.message,
        };
      });
    };

    // ワークツリー同期対象候補
    const handleWorktreeSyncCandidates = (
      data: Parameters<ServerToClientEvents['worktree-sync-candidates']>[0]
    ) => {
      const parentPath = parentRepoPathRef.current || currentRepoRef.current;
      if (!parentPath) return;
      if (data.parentRepoPath !== parentPath) return;
      setWorktreeSyncCandidates({
        parentRepoPath: data.parentRepoPath,
        dirPath: data.dirPath,
        entries: data.entries,
      });
    };

    socket.on('worktrees-list', handleWorktreesList);
    socket.on('worktree-created', handleWorktreeCreated);
    socket.on('worktree-deleted', handleWorktreeDeleted);
    socket.on('worktree-merged', handleWorktreeMerged);
    socket.on('worktree-sync-config', handleWorktreeSyncConfig);
    socket.on('worktree-sync-config-saved', handleWorktreeSyncConfigSaved);
    socket.on('worktree-sync-candidates', handleWorktreeSyncCandidates);

    return () => {
      socket.off('worktrees-list', handleWorktreesList);
      socket.off('worktree-created', handleWorktreeCreated);
      socket.off('worktree-deleted', handleWorktreeDeleted);
      socket.off('worktree-merged', handleWorktreeMerged);
      socket.off('worktree-sync-config', handleWorktreeSyncConfig);
      socket.off('worktree-sync-config-saved', handleWorktreeSyncConfigSaved);
      socket.off('worktree-sync-candidates', handleWorktreeSyncCandidates);
    };
  }, [socket, onSwitchRepository]);

  // アクション関数
  const createWorktree = useCallback(
    (
      branchName: string,
      baseBranch?: string,
      useExisting?: boolean,
      syncEntries?: WorktreeSyncEntry[]
    ) => {
      if (socket && parentRepoPath) {
        setWorktreeCreateError(null);
        const prid = repositoryIdMap.getRid(parentRepoPath);
        socket.emit('create-worktree', {
          prid,
          parentRepoPath,
          branchName,
          baseBranch,
          useExistingBranch: useExisting,
          syncEntries,
        });
      }
    },
    [socket, parentRepoPath]
  );

  const clearWorktreeCreateError = useCallback(() => {
    setWorktreeCreateError(null);
  }, []);

  const requestWorktreeSyncConfig = useCallback(() => {
    if (!socket) return;
    const repoPath = parentRepoPath || currentRepo;
    if (!repoPath) return;
    const prid = repositoryIdMap.getRid(repoPath);
    socket.emit('get-worktree-sync-config', {
      prid,
      parentRepoPath: repoPath,
    });
  }, [socket, parentRepoPath, currentRepo]);

  const saveWorktreeSyncConfig = useCallback(
    (entries: WorktreeSyncEntry[]) => {
      if (!socket) return;
      const repoPath = parentRepoPath || currentRepo;
      if (!repoPath) return;
      const prid = repositoryIdMap.getRid(repoPath);
      socket.emit('save-worktree-sync-config', {
        prid,
        parentRepoPath: repoPath,
        entries,
      });
    },
    [socket, parentRepoPath, currentRepo]
  );

  const requestWorktreeSyncCandidates = useCallback(
    (dirPath: string) => {
      if (!socket) return;
      const repoPath = parentRepoPath || currentRepo;
      if (!repoPath) return;
      const prid = repositoryIdMap.getRid(repoPath);
      socket.emit('list-worktree-sync-candidates', {
        prid,
        parentRepoPath: repoPath,
        dirPath,
      });
    },
    [socket, parentRepoPath, currentRepo]
  );

  const deleteWorktree = useCallback(
    (worktreePath: string, deleteBranch: boolean = false) => {
      if (socket && parentRepoPath) {
        setIsDeletingWorktree(true);
        setDeletingWorktreePath(worktreePath);

        const worktree = worktrees.find((wt) => wt.path === worktreePath);
        const branchName = worktree?.branch;
        const wtid = repositoryIdMap.getRid(worktreePath);
        const prid = repositoryIdMap.getRid(parentRepoPath);

        socket.emit('delete-worktree', {
          wtid,
          worktreePath,
          prid,
          parentRepoPath,
          deleteBranch,
          branchName,
        });
      }
    },
    [socket, parentRepoPath, worktrees]
  );

  const mergeWorktree = useCallback(
    (worktreePath: string) => {
      if (socket && parentRepoPath) {
        const wtid = repositoryIdMap.getRid(worktreePath);
        const prid = repositoryIdMap.getRid(parentRepoPath);
        socket.emit('merge-worktree', {
          wtid,
          worktreePath,
          prid,
          parentRepoPath,
        });
      }
    },
    [socket, parentRepoPath]
  );

  const switchWorktree = useCallback(
    (worktreePath: string) => {
      onSwitchRepository(worktreePath);
    },
    [onSwitchRepository]
  );

  // ワークツリータブの並び替え（楽観的更新 + サーバーへ永続化）
  const reorderWorktrees = useCallback(
    (orderedBranchPaths: string[]) => {
      // ローカル状態を即座に並び替え（メイン先頭、指定順、残りは末尾）
      setWorktrees((prev) => {
        const byPath = new Map(prev.map((wt) => [wt.path, wt]));
        const main = prev.filter((wt) => wt.isMain);
        const ordered = orderedBranchPaths
          .map((p) => byPath.get(p))
          .filter((wt): wt is GitWorktree => wt !== undefined);
        const orderedSet = new Set(orderedBranchPaths);
        const rest = prev.filter(
          (wt) => !wt.isMain && !orderedSet.has(wt.path)
        );
        return [...main, ...ordered, ...rest];
      });

      if (socket && parentRepoPath) {
        const prid = repositoryIdMap.getRid(parentRepoPath);
        socket.emit('save-worktree-sort-order', {
          prid,
          parentRepoPath,
          orderedPaths: orderedBranchPaths,
        });
      }
    },
    [socket, parentRepoPath]
  );

  // ワークツリーのメモを保存（サーバーへ emit、結果は worktrees-list で反映される）
  const saveWorktreeMemo = useCallback(
    (worktreePath: string, memo: string) => {
      const wt = worktrees.find((w) => w.path === worktreePath);
      const rid = wt ? repositoryIdMap.getRid(wt.path) : undefined;
      if (!socket || !rid) return;
      socket.emit('save-worktree-memo', { rid, memo });
    },
    [socket, worktrees]
  );

  // 状態クリア
  const clearState = useCallback(() => {
    setWorktrees([]);
    setParentRepoPath('');
    setWorktreeCreateError(null);
    setWorktreeSyncConfig(null);
    setWorktreeSyncCandidates(null);
  }, []);

  return {
    worktrees,
    parentRepoPath,
    mergeError,
    worktreeCreateError,
    worktreeCreateSuccessNonce,
    isDeletingWorktree,
    deletingWorktreePath,
    createWorktree,
    deleteWorktree,
    mergeWorktree,
    switchWorktree,
    reorderWorktrees,
    saveWorktreeMemo,
    setMergeError,
    clearWorktreeCreateError,
    clearState,
    worktreeSyncConfig,
    requestWorktreeSyncConfig,
    saveWorktreeSyncConfig,
    worktreeSyncCandidates,
    requestWorktreeSyncCandidates,
  };
}
