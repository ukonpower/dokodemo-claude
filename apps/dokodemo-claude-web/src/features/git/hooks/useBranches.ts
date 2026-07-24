import { useState, useEffect, useCallback, useRef } from 'react';
import { Socket } from 'socket.io-client';
import type {
  GitBranch,
  AiOutputLine,
  AiProvider,
  ServerToClientEvents,
  ClientToServerEvents,
} from '@/types';
import { repositoryIdMap } from '@/shared/utils/repository-id-map';
import { useRefreshOnFocus } from '@/shared/hooks/useRefreshOnFocus';

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
 * useBranches フックの戻り値
 */
export interface UseBranchesReturn {
  // ブランチ状態
  branches: GitBranch[];
  currentBranch: string;

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

  // UI制御
  clearPullState: () => void;
  clearPushState: () => void;

  // クリア関数（リポジトリ切り替え時用）
  clearState: () => void;
}

/**
 * ブランチ管理を行うカスタムフック
 */
export function useBranches(
  socket: Socket<ServerToClientEvents, ClientToServerEvents> | null,
  currentRepo: string,
  currentProvider: AiProvider,
  onBranchError?: (message: AiOutputLine) => void
): UseBranchesReturn {
  // ブランチ状態
  const [branches, setBranches] = useState<GitBranch[]>([]);
  const [currentBranch, setCurrentBranch] = useState<string>('');

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

  // Ref
  const currentRepoRef = useRef(currentRepo);

  useEffect(() => {
    currentRepoRef.current = currentRepo;
  }, [currentRepo]);

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
  // 手動リフレッシュ直後の再発火は lastSyncRefreshAtRef で追加抑制する
  // （フック内蔵のスロットルは focus 起因の実行しか記録しないため）。
  useRefreshOnFocus(() => {
    if (
      Date.now() - lastSyncRefreshAtRef.current <
      SYNC_STATUS_REFRESH_MIN_INTERVAL_MS
    ) {
      return;
    }
    refreshSyncStatus();
  }, SYNC_STATUS_REFRESH_MIN_INTERVAL_MS);

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

    socket.on('branches-list', handleBranchesList);
    socket.on('branch-switched', handleBranchSwitched);
    socket.on('branch-created', handleBranchCreated);
    socket.on('branch-pull-started', handleBranchPullStarted);
    socket.on('branch-pull-progress', handleBranchPullProgress);
    socket.on('branch-pulled', handleBranchPulled);
    socket.on('branch-sync-status', handleBranchSyncStatus);
    socket.on('branch-push-started', handleBranchPushStarted);
    socket.on('branch-push-progress', handleBranchPushProgress);
    socket.on('branch-pushed', handleBranchPushed);

    return () => {
      socket.off('branches-list', handleBranchesList);
      socket.off('branch-switched', handleBranchSwitched);
      socket.off('branch-created', handleBranchCreated);
      socket.off('branch-pull-started', handleBranchPullStarted);
      socket.off('branch-pull-progress', handleBranchPullProgress);
      socket.off('branch-pulled', handleBranchPulled);
      socket.off('branch-sync-status', handleBranchSyncStatus);
      socket.off('branch-push-started', handleBranchPushStarted);
      socket.off('branch-push-progress', handleBranchPushProgress);
      socket.off('branch-pushed', handleBranchPushed);
    };
  }, [socket, currentProvider, onBranchError, requestSyncStatus]);

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

  // 状態クリア
  const clearState = useCallback(() => {
    setBranches([]);
    setCurrentBranch('');
    setPullState(null);
    setSyncStatus(null);
    setIsSyncStatusRefreshing(false);
    setPushState(null);
  }, []);

  return {
    branches,
    currentBranch,
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
    clearPullState,
    clearPushState,
    clearState,
  };
}
