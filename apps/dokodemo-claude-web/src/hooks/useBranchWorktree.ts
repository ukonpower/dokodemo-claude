import { useState, useEffect, useCallback, useRef } from 'react';
import { Socket } from 'socket.io-client';
import type {
  GitBranch,
  GitWorktree,
  AiOutputLine,
  AiProvider,
  ServerToClientEvents,
  ClientToServerEvents,
} from '../types';
import { repositoryIdMap } from '../utils/repository-id-map';

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
 * useBranchWorktree フックの戻り値
 */
export interface UseBranchWorktreeReturn {
  // ブランチ状態
  branches: GitBranch[];
  currentBranch: string;

  // ワークツリー状態
  worktrees: GitWorktree[];
  parentRepoPath: string;
  mergeError: {
    message: string;
    conflictFiles?: string[];
    errorDetails?: string;
  } | null;
  isDeletingWorktree: boolean;
  deletingWorktreePath: string | null;

  // pull 状態
  isPulling: boolean;
  pullError: {
    message: string;
    output?: string;
  } | null;

  // ブランチアクション
  switchBranch: (branchName: string) => void;
  deleteBranch: (branchName: string, deleteRemote?: boolean) => void;
  createBranch: (branchName: string, baseBranch?: string) => void;
  refreshBranches: () => void;
  pullBranch: () => void;

  // ワークツリーアクション
  createWorktree: (
    branchName: string,
    baseBranch?: string,
    useExisting?: boolean
  ) => void;
  deleteWorktree: (worktreePath: string, deleteBranch?: boolean) => void;
  mergeWorktree: (worktreePath: string) => void;
  switchWorktree: (worktreePath: string) => void;

  // UI制御
  setMergeError: (
    error: {
      message: string;
      conflictFiles?: string[];
      errorDetails?: string;
    } | null
  ) => void;
  setPullError: (
    error: {
      message: string;
      output?: string;
    } | null
  ) => void;

  // クリア関数（リポジトリ切り替え時用）
  clearState: () => void;
}

/**
 * ブランチ・ワークツリー管理を行うカスタムフック
 */
export function useBranchWorktree(
  socket: Socket<ServerToClientEvents, ClientToServerEvents> | null,
  currentRepo: string,
  currentProvider: AiProvider,
  onSwitchRepository: (path: string) => void,
  onBranchError?: (message: AiOutputLine) => void
): UseBranchWorktreeReturn {
  // ブランチ状態
  const [branches, setBranches] = useState<GitBranch[]>([]);
  const [currentBranch, setCurrentBranch] = useState<string>('');

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

  // pull 状態
  const [isPulling, setIsPulling] = useState(false);
  const [pullError, setPullError] = useState<{
    message: string;
    output?: string;
  } | null>(null);

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

  // Socketイベントリスナー
  useEffect(() => {
    if (!socket) return;

    // ブランチ一覧
    const handleBranchesList = (
      data: Parameters<ServerToClientEvents['branches-list']>[0]
    ) => {
      const currentRid = repositoryIdMap.getRid(currentRepoRef.current);
      if (data.rid === currentRid) {
        setBranches(data.branches);
        const current = data.branches.find((b: GitBranch) => b.current);
        if (current) {
          setCurrentBranch(current.name);
        }
      }
    };

    // ブランチ切り替え
    const handleBranchSwitched = (
      data: Parameters<ServerToClientEvents['branch-switched']>[0]
    ) => {
      const currentRid = repositoryIdMap.getRid(currentRepoRef.current);
      if (data.rid === currentRid) {
        if (data.success) {
          setCurrentBranch(data.currentBranch);
        } else if (onBranchError) {
          const errorMessage: AiOutputLine = {
            id: `error-${Date.now()}`,
            content: `\n[ERROR] ${data.message}\n`,
            timestamp: Date.now(),
            type: 'system',
            provider: currentProvider,
          };
          onBranchError(errorMessage);
        }
      }
    };

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
      const logFn = data.success ? console.log : console.error;
      logFn(data.message);

      if (data.success && data.worktree?.path) {
        const newWorktreePath = data.worktree.path;
        // 最終アクセス時刻をバックエンドに送信
        socket.emit('update-repo-access', { path: newWorktreePath });

        onSwitchRepository(newWorktreePath);
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

    // ブランチ作成
    const handleBranchCreated = (
      data: Parameters<ServerToClientEvents['branch-created']>[0]
    ) => {
      const currentRid = repositoryIdMap.getRid(currentRepoRef.current);
      if (data.rid !== currentRid) return;
      if (!data.success && onBranchError) {
        onBranchError({
          id: `error-${Date.now()}`,
          content: `\n[ERROR] ${data.message}\n`,
          timestamp: Date.now(),
          type: 'system',
          provider: currentProvider,
        });
      }
    };

    // ブランチ pull 結果
    const handleBranchPulled = (
      data: Parameters<ServerToClientEvents['branch-pulled']>[0]
    ) => {
      const currentRid = repositoryIdMap.getRid(currentRepoRef.current);
      if (data.rid !== currentRid) return;
      setIsPulling(false);
      if (!data.success) {
        setPullError({ message: data.message, output: data.output });
      }
    };

    socket.on('branches-list', handleBranchesList);
    socket.on('branch-switched', handleBranchSwitched);
    socket.on('worktrees-list', handleWorktreesList);
    socket.on('worktree-created', handleWorktreeCreated);
    socket.on('worktree-deleted', handleWorktreeDeleted);
    socket.on('worktree-merged', handleWorktreeMerged);
    socket.on('branch-created', handleBranchCreated);
    socket.on('branch-pulled', handleBranchPulled);

    return () => {
      socket.off('branches-list', handleBranchesList);
      socket.off('branch-switched', handleBranchSwitched);
      socket.off('worktrees-list', handleWorktreesList);
      socket.off('worktree-created', handleWorktreeCreated);
      socket.off('worktree-deleted', handleWorktreeDeleted);
      socket.off('worktree-merged', handleWorktreeMerged);
      socket.off('branch-created', handleBranchCreated);
      socket.off('branch-pulled', handleBranchPulled);
    };
  }, [socket, currentProvider, onBranchError, onSwitchRepository]);

  // アクション関数
  const switchBranch = useCallback(
    (branchName: string) => {
      if (socket && currentRepo) {
        const rid = repositoryIdMap.getRid(currentRepo);
        if (!rid) return;
        socket.emit('switch-branch', { rid, branchName });
      }
    },
    [socket, currentRepo]
  );

  const deleteBranch = useCallback(
    (branchName: string, deleteRemote: boolean = false) => {
      if (socket && currentRepo) {
        const rid = repositoryIdMap.getRid(currentRepo);
        if (!rid) return;
        socket.emit('delete-branch', { rid, branchName, deleteRemote });
      }
    },
    [socket, currentRepo]
  );

  const createBranch = useCallback(
    (branchName: string, baseBranch?: string) => {
      if (!socket || !currentRepo) return;
      const rid = repositoryIdMap.getRid(currentRepo);
      if (!rid) return;
      socket.emit('create-branch', { rid, branchName, baseBranch });
    },
    [socket, currentRepo]
  );

  const refreshBranches = useCallback(() => {
    if (!socket || !currentRepo) return;
    const rid = repositoryIdMap.getRid(currentRepo);
    if (!rid) return;
    socket.emit('list-branches', { rid });
  }, [socket, currentRepo]);

  const pullBranch = useCallback(() => {
    if (!socket || !currentRepo) return;
    const rid = repositoryIdMap.getRid(currentRepo);
    if (!rid) return;
    setIsPulling(true);
    setPullError(null);
    socket.emit('pull-branch', { rid });
  }, [socket, currentRepo]);

  const createWorktree = useCallback(
    (branchName: string, baseBranch?: string, useExisting?: boolean) => {
      if (socket && parentRepoPath) {
        const prid = repositoryIdMap.getRid(parentRepoPath);
        socket.emit('create-worktree', {
          prid,
          parentRepoPath,
          branchName,
          baseBranch,
          useExistingBranch: useExisting,
        });
      }
    },
    [socket, parentRepoPath]
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

  // 状態クリア
  const clearState = useCallback(() => {
    setBranches([]);
    setCurrentBranch('');
    setWorktrees([]);
    setParentRepoPath('');
    setIsPulling(false);
    setPullError(null);
  }, []);

  // リポジトリ切り替え時に状態をリセット
  useEffect(() => {
    clearState();
  }, [currentRepo, clearState]);

  return {
    branches,
    currentBranch,
    worktrees,
    parentRepoPath,
    mergeError,
    isDeletingWorktree,
    deletingWorktreePath,
    isPulling,
    pullError,
    switchBranch,
    deleteBranch,
    createBranch,
    refreshBranches,
    pullBranch,
    createWorktree,
    deleteWorktree,
    mergeWorktree,
    switchWorktree,
    setMergeError,
    setPullError,
    clearState,
  };
}
