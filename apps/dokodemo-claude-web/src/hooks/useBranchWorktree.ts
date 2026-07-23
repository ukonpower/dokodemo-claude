import { useState, useEffect, useCallback, useRef } from 'react';
import { Socket } from 'socket.io-client';
import type {
  GitBranch,
  GitWorktree,
  AiOutputLine,
  AiProvider,
  ServerToClientEvents,
  ClientToServerEvents,
  WorktreeSyncEntry,
} from '../types';
import { repositoryIdMap } from '../utils/repository-id-map';
import {
  getLastWorktreeForParent,
  setLastWorktreeForParent,
} from '../utils/last-tab-storage';

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
 * pull の状態
 *  - running: 実行中（stdout/stderr が log に逐次蓄積される）
 *  - success / error: 完了。log には最終出力、message にはサマリ
 */
export interface PullState {
  status: 'running' | 'success' | 'error';
  log: string;
  message?: string;
}

/** 現在ブランチの同期状態（null は未取得） */
export interface BranchSyncStatus {
  upstream: string | null;
  ahead: number;
  behind: number;
}

// sync status のポーリング間隔（判断済み事項どおり 30 秒）
const SYNC_STATUS_POLL_INTERVAL_MS = 30000;

// フォーカス復帰時の fetch 付き更新の抑制間隔（連続発火防止）
const SYNC_STATUS_REFRESH_MIN_INTERVAL_MS = 5000;

// fetch 付き更新の応答が来ない場合にスピナーを解除するタイムアウト
const SYNC_STATUS_REFRESH_TIMEOUT_MS = 40000;

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
  worktreeCreateError: { message: string } | null;
  worktreeCreateSuccessNonce: number;
  isDeletingWorktree: boolean;
  deletingWorktreePath: string | null;

  // pull 状態（実行中・成功・失敗 + 進行ログ）
  pullState: PullState | null;

  // 現在ブランチの同期状態（ahead/behind。null は未取得）
  syncStatus: BranchSyncStatus | null;
  // fetch 付きの同期状態更新が実行中かどうか
  isSyncStatusRefreshing: boolean;
  // push 状態（実行中・成功・失敗 + 進行ログ。pullState と同形式）
  pushState: PullState | null;

  // ブランチアクション
  switchBranch: (branchName: string) => void;
  deleteBranch: (branchName: string, deleteRemote?: boolean) => void;
  createBranch: (branchName: string, baseBranch?: string) => void;
  refreshBranches: () => void;
  pullBranch: () => void;
  pushBranch: () => void;
  // fetch を伴って ahead/behind を再取得する（手動リフレッシュ用）
  refreshSyncStatus: () => void;

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
  clearPullState: () => void;
  clearPushState: () => void;
  clearWorktreeCreateError: () => void;

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
  const [worktreeCreateError, setWorktreeCreateError] = useState<{
    message: string;
  } | null>(null);
  const [worktreeCreateSuccessNonce, setWorktreeCreateSuccessNonce] =
    useState(0);

  // pull 状態（running / success / error + 進行ログ）
  const [pullState, setPullState] = useState<PullState | null>(null);

  // 現在ブランチの同期状態（ahead/behind）
  const [syncStatus, setSyncStatus] = useState<BranchSyncStatus | null>(null);
  // fetch 付き更新の実行中フラグ（リフレッシュボタンのスピナー用）
  const [isSyncStatusRefreshing, setIsSyncStatusRefreshing] = useState(false);
  // fetch 付き更新の直近実行時刻（フォーカス復帰時の連続発火抑制用）
  const lastSyncRefreshAtRef = useRef(0);
  // push 状態（running / success / error + 進行ログ）
  const [pushState, setPushState] = useState<PullState | null>(null);

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

  // リポジトリ切替時は同期状態を未取得にリセットする
  useEffect(() => {
    setSyncStatus(null);
  }, [currentRepo]);

  // 現在ブランチの同期状態（ahead/behind）を要求する。
  // ref 経由で currentRepo を参照するため socket 以外に依存せず、
  // listener effect の依存配列に含めても再購読を引き起こさない。
  const requestSyncStatus = useCallback(() => {
    if (!socket) return;
    const repoPath = currentRepoRef.current;
    if (!repoPath) return;
    const rid = repositoryIdMap.getRid(repoPath);
    if (!rid) return;
    socket.emit('get-branch-sync-status', { rid });
  }, [socket]);

  // fetch を伴って ahead/behind を再取得する。
  // remote-tracking ref が最新化されるため、リモート側の変化も数字に反映される。
  const refreshSyncStatus = useCallback(() => {
    if (!socket || !socket.connected) return;
    const repoPath = currentRepoRef.current;
    if (!repoPath) return;
    const rid = repositoryIdMap.getRid(repoPath);
    if (!rid) return;
    lastSyncRefreshAtRef.current = Date.now();
    setIsSyncStatusRefreshing(true);
    socket.emit('get-branch-sync-status', { rid, fetch: true });
  }, [socket]);

  // fetch 付き更新の応答が来ないままの場合はスピナーを解除する
  useEffect(() => {
    if (!isSyncStatusRefreshing) return;
    const timer = setTimeout(() => {
      setIsSyncStatusRefreshing(false);
    }, SYNC_STATUS_REFRESH_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [isSyncStatusRefreshing]);

  // 30秒間隔ポーリング（socket 接続中かつタブがアクティブなときのみ）
  useEffect(() => {
    if (!socket) return;
    const interval = setInterval(() => {
      if (socket.connected && document.visibilityState === 'visible') {
        requestSyncStatus();
      }
    }, SYNC_STATUS_POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [socket, requestSyncStatus]);

  // タブ/ウィンドウにフォーカスが戻ったとき fetch 付きで再取得する。
  // visibilitychange と focus は同時に発火しうるため、直近実行からの経過時間で抑制する。
  useEffect(() => {
    if (!socket) return;
    const handleFocusRefresh = () => {
      if (document.visibilityState !== 'visible') return;
      if (
        Date.now() - lastSyncRefreshAtRef.current <
        SYNC_STATUS_REFRESH_MIN_INTERVAL_MS
      ) {
        return;
      }
      refreshSyncStatus();
    };
    window.addEventListener('focus', handleFocusRefresh);
    document.addEventListener('visibilitychange', handleFocusRefresh);
    return () => {
      window.removeEventListener('focus', handleFocusRefresh);
      document.removeEventListener('visibilitychange', handleFocusRefresh);
    };
  }, [socket, refreshSyncStatus]);

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
        // ブランチ切替・HEAD 変更に追随して同期状態を取り直す
        requestSyncStatus();
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

    // ブランチ pull 開始
    const handleBranchPullStarted = (
      data: Parameters<ServerToClientEvents['branch-pull-started']>[0]
    ) => {
      const currentRid = repositoryIdMap.getRid(currentRepoRef.current);
      if (data.rid !== currentRid) return;
      setPullState({ status: 'running', log: '' });
    };

    // ブランチ pull 進行ログ（stdout/stderr のチャンク）
    const handleBranchPullProgress = (
      data: Parameters<ServerToClientEvents['branch-pull-progress']>[0]
    ) => {
      const currentRid = repositoryIdMap.getRid(currentRepoRef.current);
      if (data.rid !== currentRid) return;
      setPullState((prev) => {
        // 進行ログは running 中だけ追記する（完了後の遅延チャンクは無視）
        if (!prev || prev.status !== 'running') return prev;
        return { ...prev, log: prev.log + data.chunk };
      });
    };

    // ブランチ pull 結果
    const handleBranchPulled = (
      data: Parameters<ServerToClientEvents['branch-pulled']>[0]
    ) => {
      const currentRid = repositoryIdMap.getRid(currentRepoRef.current);
      if (data.rid !== currentRid) return;
      setPullState({
        status: data.success ? 'success' : 'error',
        log: data.output,
        message: data.message,
      });
      requestSyncStatus();
    };

    // ブランチ同期状態（ahead/behind）
    const handleBranchSyncStatus = (
      data: Parameters<ServerToClientEvents['branch-sync-status']>[0]
    ) => {
      const currentRid = repositoryIdMap.getRid(currentRepoRef.current);
      if (data.rid !== currentRid) return;
      setSyncStatus({
        upstream: data.upstream,
        ahead: data.ahead,
        behind: data.behind,
      });
      // fetch 付き更新の応答もこのイベントで返るためスピナーを解除する
      setIsSyncStatusRefreshing(false);
    };

    // ブランチ push 開始
    const handleBranchPushStarted = (
      data: Parameters<ServerToClientEvents['branch-push-started']>[0]
    ) => {
      const currentRid = repositoryIdMap.getRid(currentRepoRef.current);
      if (data.rid !== currentRid) return;
      setPushState({ status: 'running', log: '' });
    };

    // ブランチ push 進行ログ（stdout/stderr のチャンク）
    const handleBranchPushProgress = (
      data: Parameters<ServerToClientEvents['branch-push-progress']>[0]
    ) => {
      const currentRid = repositoryIdMap.getRid(currentRepoRef.current);
      if (data.rid !== currentRid) return;
      setPushState((prev) => {
        // 進行ログは running 中だけ追記する（完了後の遅延チャンクは無視）
        if (!prev || prev.status !== 'running') return prev;
        return { ...prev, log: prev.log + data.chunk };
      });
    };

    // ブランチ push 結果
    // 契約上 output は無いため、progress で積み上げた log をそのまま保持する
    const handleBranchPushed = (
      data: Parameters<ServerToClientEvents['branch-pushed']>[0]
    ) => {
      const currentRid = repositoryIdMap.getRid(currentRepoRef.current);
      if (data.rid !== currentRid) return;
      setPushState((prev) => ({
        status: data.success ? 'success' : 'error',
        log: prev?.log ?? '',
        message: data.message,
      }));
      requestSyncStatus();
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

    socket.on('branches-list', handleBranchesList);
    socket.on('branch-switched', handleBranchSwitched);
    socket.on('worktrees-list', handleWorktreesList);
    socket.on('worktree-created', handleWorktreeCreated);
    socket.on('worktree-deleted', handleWorktreeDeleted);
    socket.on('worktree-merged', handleWorktreeMerged);
    socket.on('branch-created', handleBranchCreated);
    socket.on('branch-pull-started', handleBranchPullStarted);
    socket.on('branch-pull-progress', handleBranchPullProgress);
    socket.on('branch-pulled', handleBranchPulled);
    socket.on('branch-sync-status', handleBranchSyncStatus);
    socket.on('branch-push-started', handleBranchPushStarted);
    socket.on('branch-push-progress', handleBranchPushProgress);
    socket.on('branch-pushed', handleBranchPushed);
    socket.on('worktree-sync-config', handleWorktreeSyncConfig);
    socket.on('worktree-sync-config-saved', handleWorktreeSyncConfigSaved);
    socket.on('worktree-sync-candidates', handleWorktreeSyncCandidates);

    return () => {
      socket.off('branches-list', handleBranchesList);
      socket.off('branch-switched', handleBranchSwitched);
      socket.off('worktrees-list', handleWorktreesList);
      socket.off('worktree-created', handleWorktreeCreated);
      socket.off('worktree-deleted', handleWorktreeDeleted);
      socket.off('worktree-merged', handleWorktreeMerged);
      socket.off('branch-created', handleBranchCreated);
      socket.off('branch-pull-started', handleBranchPullStarted);
      socket.off('branch-pull-progress', handleBranchPullProgress);
      socket.off('branch-pulled', handleBranchPulled);
      socket.off('branch-sync-status', handleBranchSyncStatus);
      socket.off('branch-push-started', handleBranchPushStarted);
      socket.off('branch-push-progress', handleBranchPushProgress);
      socket.off('branch-pushed', handleBranchPushed);
      socket.off('worktree-sync-config', handleWorktreeSyncConfig);
      socket.off('worktree-sync-config-saved', handleWorktreeSyncConfigSaved);
      socket.off('worktree-sync-candidates', handleWorktreeSyncCandidates);
    };
  }, [socket, currentProvider, onBranchError, onSwitchRepository, requestSyncStatus]);

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
    // 開始イベントが来る前にもモーダルを出したいので、ここで楽観的に running をセット
    setPullState({ status: 'running', log: '' });
    socket.emit('pull-branch', { rid });
  }, [socket, currentRepo]);

  const clearPullState = useCallback(() => {
    setPullState(null);
  }, []);

  const pushBranch = useCallback(() => {
    if (!socket || !currentRepo) return;
    const rid = repositoryIdMap.getRid(currentRepo);
    if (!rid) return;
    // 開始イベントが来る前にもポップオーバーを出したいので、ここで楽観的に running をセット
    setPushState({ status: 'running', log: '' });
    socket.emit('push-branch', { rid });
  }, [socket, currentRepo]);

  const clearPushState = useCallback(() => {
    setPushState(null);
  }, []);

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
    setBranches([]);
    setCurrentBranch('');
    setWorktrees([]);
    setParentRepoPath('');
    setPullState(null);
    setSyncStatus(null);
    setIsSyncStatusRefreshing(false);
    setPushState(null);
    setWorktreeCreateError(null);
    setWorktreeSyncConfig(null);
    setWorktreeSyncCandidates(null);
  }, []);

  return {
    branches,
    currentBranch,
    worktrees,
    parentRepoPath,
    mergeError,
    worktreeCreateError,
    worktreeCreateSuccessNonce,
    isDeletingWorktree,
    deletingWorktreePath,
    pullState,
    syncStatus,
    isSyncStatusRefreshing,
    pushState,
    switchBranch,
    deleteBranch,
    createBranch,
    refreshBranches,
    pullBranch,
    pushBranch,
    refreshSyncStatus,
    createWorktree,
    deleteWorktree,
    mergeWorktree,
    switchWorktree,
    reorderWorktrees,
    saveWorktreeMemo,
    setMergeError,
    clearPullState,
    clearPushState,
    clearWorktreeCreateError,
    clearState,
    worktreeSyncConfig,
    requestWorktreeSyncConfig,
    saveWorktreeSyncConfig,
    worktreeSyncCandidates,
    requestWorktreeSyncCandidates,
  };
}
