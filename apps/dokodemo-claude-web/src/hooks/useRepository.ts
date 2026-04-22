import { useState, useEffect, useCallback, useRef } from 'react';
import { Socket } from 'socket.io-client';
import type {
  GitRepository,
  RepoProcessStatus,
  ServerToClientEvents,
  ClientToServerEvents,
  PermissionMode,
} from '../types';
import { repositoryIdMap } from '../utils/repository-id-map';

/**
 * localStorage から permissionMode 設定を取得
 */
function getPermissionModeSetting(): PermissionMode {
  try {
    const saved = localStorage.getItem('app-settings');
    if (saved) {
      const settings = JSON.parse(saved);
      if (settings.permissionMode) return settings.permissionMode as PermissionMode;
      if (settings.bypassPermission === false) return 'disabled';
    }
  } catch { /* ignore */ }
  return 'dangerous';
}

/**
 * useRepository フックの戻り値
 */
export interface UseRepositoryReturn {
  // 状態
  repositories: GitRepository[];
  currentRepo: string;
  currentRid: string | undefined;
  repoProcessStatuses: RepoProcessStatus[];
  lastAccessTimes: Record<string, number>;
  isLoadingRepoData: boolean;
  isSwitchingRepo: boolean;

  // プロセス停止関連
  showStopProcessConfirm: boolean;
  stoppingProcesses: boolean;
  stopProcessTargetRid: string | null;

  // リポジトリ削除関連
  showDeleteConfirm: boolean;
  setShowDeleteConfirm: (show: boolean) => void;

  // アクション
  cloneRepository: (url: string, name: string) => void;
  createRepository: (name: string) => void;
  deleteRepository: (path: string, name: string) => void;
  switchRepository: (path: string, options?: { skipPushState?: boolean }) => void;

  // プロセス停止アクション
  showStopProcessConfirmDialog: (rid: string) => void;
  confirmStopProcesses: () => void;
  cancelStopProcesses: () => void;

  // 自身の更新
  pullSelf: () => void;

  // ローディング終了コールバック
  endLoadingOnOutput: () => void;
}

/**
 * リポジトリ管理を行うカスタムフック
 */
export function useRepository(
  socket: Socket<ServerToClientEvents, ClientToServerEvents> | null,
  initialRepo?: string
): UseRepositoryReturn {
  // リポジトリ一覧
  const [repositories, setRepositories] = useState<GitRepository[]>([]);
  // プロセス状態
  const [repoProcessStatuses, setRepoProcessStatuses] = useState<
    RepoProcessStatus[]
  >([]);
  // 最終アクセス時刻（バックエンドから取得）
  const [lastAccessTimes, setLastAccessTimes] = useState<Record<string, number>>({});
  // 現在選択中のリポジトリ
  const [currentRepo, setCurrentRepo] = useState<string>(() => {
    if (initialRepo) return initialRepo;
    // URLのクエリパラメータからリポジトリパスを復元
    const urlParams = new URLSearchParams(window.location.search);
    return urlParams.get('repo') || '';
  });
  // ローディング状態
  const [isLoadingRepoData, setIsLoadingRepoData] = useState(false);
  const [isSwitchingRepo, setIsSwitchingRepo] = useState(false);

  // プロセス停止関連
  const [showStopProcessConfirm, setShowStopProcessConfirm] = useState(false);
  const [stoppingProcesses, setStoppingProcesses] = useState(false);
  const [stopProcessTargetRid, setStopProcessTargetRid] = useState<
    string | null
  >(null);

  // 削除確認
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  // Ref
  const currentRepoRef = useRef(currentRepo);
  useEffect(() => {
    currentRepoRef.current = currentRepo;
  }, [currentRepo]);

  const loadingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isLoadingRepoDataRef = useRef(isLoadingRepoData);
  useEffect(() => {
    isLoadingRepoDataRef.current = isLoadingRepoData;
  }, [isLoadingRepoData]);

  // 現在のリポジトリID
  const currentRid = currentRepo
    ? repositoryIdMap.getRid(currentRepo)
    : undefined;

  // リポジトリが変更された時にローディング状態を管理
  useEffect(() => {
    if (currentRepo) {
      setIsLoadingRepoData(true);

      // 3秒のタイムアウトを設定（フォールバック）
      if (loadingTimeoutRef.current) {
        clearTimeout(loadingTimeoutRef.current);
      }
      loadingTimeoutRef.current = setTimeout(() => {
        setIsLoadingRepoData(false);
      }, 3000);
    } else {
      setIsLoadingRepoData(false);
      if (loadingTimeoutRef.current) {
        clearTimeout(loadingTimeoutRef.current);
        loadingTimeoutRef.current = null;
      }
    }
  }, [currentRepo]);

  // リポジトリが選択されたときに最終アクセス時刻を更新（バックエンドに送信）
  useEffect(() => {
    if (currentRepo && socket) {
      socket.emit('update-repo-access', { path: currentRepo });
    }
  }, [currentRepo, socket]);

  // ローディング終了コールバック
  const endLoadingOnOutput = useCallback(() => {
    if (loadingTimeoutRef.current) {
      clearTimeout(loadingTimeoutRef.current);
      loadingTimeoutRef.current = null;
    }
    setIsLoadingRepoData(false);
  }, []);

  // Socketイベントリスナー
  useEffect(() => {
    if (!socket) return;

    // IDマッピング関連
    const handleIdMapping = (
      data: Parameters<ServerToClientEvents['id-mapping']>[0]
    ) => {
      repositoryIdMap.update(data);
    };

    const handleIdMappingUpdated = (
      data: Parameters<ServerToClientEvents['id-mapping-updated']>[0]
    ) => {
      repositoryIdMap.update(data);
    };

    // リポジトリ一覧
    const handleReposList = (
      data: Parameters<ServerToClientEvents['repos-list']>[0]
    ) => {
      setRepositories(data.repos);
      if (data.lastAccessTimes) {
        setLastAccessTimes(data.lastAccessTimes);
      }
      socket.emit('get-repos-process-status');
    };

    // プロセス状態
    const handleReposProcessStatus = (
      data: Parameters<ServerToClientEvents['repos-process-status']>[0]
    ) => {
      setRepoProcessStatuses(data.statuses);
    };

    // プロセス停止完了
    const handleRepoProcessesStopped = (
      data: Parameters<ServerToClientEvents['repo-processes-stopped']>[0]
    ) => {
      setStoppingProcesses(false);
      setShowStopProcessConfirm(false);
      setStopProcessTargetRid(null);
      if (data.success) {
        console.log(
          `プロセス停止完了: AI ${data.aiSessionsClosed}件, ターミナル ${data.terminalsClosed}件`
        );
        socket.emit('get-repos-process-status');
      } else {
        console.error('プロセス停止失敗:', data.message);
      }
    };

    // リポジトリ削除
    const handleRepoDeleted = (
      data: Parameters<ServerToClientEvents['repo-deleted']>[0]
    ) => {
      if (data.success) {
        if (currentRepoRef.current === data.path) {
          setCurrentRepo('');
          const url = new URL(window.location.href);
          url.searchParams.delete('repo');
          window.history.replaceState({}, '', url.toString());
        }
      }
    };

    // リポジトリ切り替え
    const handleRepoSwitched = (
      data: Parameters<ServerToClientEvents['repo-switched']>[0]
    ) => {
      if (data.success) {
        setCurrentRepo(data.currentPath);
        const url = new URL(window.location.href);
        url.searchParams.set('repo', data.currentPath);
        window.history.replaceState({}, '', url.toString());
      }
      setIsSwitchingRepo(false);
    };

    socket.on('id-mapping', handleIdMapping);
    socket.on('id-mapping-updated', handleIdMappingUpdated);
    socket.on('repos-list', handleReposList);
    socket.on('repos-process-status', handleReposProcessStatus);
    socket.on('repo-processes-stopped', handleRepoProcessesStopped);
    socket.on('repo-deleted', handleRepoDeleted);
    socket.on('repo-switched', handleRepoSwitched);

    return () => {
      socket.off('id-mapping', handleIdMapping);
      socket.off('id-mapping-updated', handleIdMappingUpdated);
      socket.off('repos-list', handleReposList);
      socket.off('repos-process-status', handleReposProcessStatus);
      socket.off('repo-processes-stopped', handleRepoProcessesStopped);
      socket.off('repo-deleted', handleRepoDeleted);
      socket.off('repo-switched', handleRepoSwitched);
    };
  }, [socket]);

  // アクション関数
  const cloneRepository = useCallback(
    (url: string, name: string) => {
      if (socket) {
        socket.emit('clone-repo', { url, name });
      }
    },
    [socket]
  );

  const createRepository = useCallback(
    (name: string) => {
      if (socket) {
        socket.emit('create-repo', { name });
      }
    },
    [socket]
  );

  const deleteRepository = useCallback(
    (path: string, name: string) => {
      if (socket) {
        socket.emit('delete-repo', { path, name });
      }
    },
    [socket]
  );

  const switchRepository = useCallback(
    (path: string, options?: { skipPushState?: boolean }) => {
      if (!socket) return;

      // React state を更新（ページリロードなし）
      setCurrentRepo(path);

      // URL を更新（popstate からの呼び出し時は既に URL が更新済みなのでスキップ）
      if (!options?.skipPushState) {
        const url = new URL(window.location.href);
        if (path) {
          url.searchParams.set('repo', path);
        } else {
          url.searchParams.delete('repo');
        }
        // 他リポジトリ固有のビュー状態をクリア
        url.searchParams.delete('view');
        url.searchParams.delete('file');
        url.searchParams.delete('fullscreen');
        window.history.pushState({}, '', url.toString());
      }

      if (path) {
        // 最終アクセス時刻をバックエンドに送信
        socket.emit('update-repo-access', { path });

        setIsSwitchingRepo(true);
        socket.emit('switch-repo', {
          path,
          permissionMode: getPermissionModeSetting(),
        });
      } else {
        // ホーム画面へ戻る場合はバックエンド切替不要
        setIsSwitchingRepo(false);
      }
    },
    [socket]
  );

  // プロセス停止関連
  const showStopProcessConfirmDialog = useCallback((rid: string) => {
    setStopProcessTargetRid(rid);
    setShowStopProcessConfirm(true);
  }, []);

  const confirmStopProcesses = useCallback(() => {
    if (socket && stopProcessTargetRid) {
      setStoppingProcesses(true);
      socket.emit('stop-repo-processes', { rid: stopProcessTargetRid });
    }
  }, [socket, stopProcessTargetRid]);

  const cancelStopProcesses = useCallback(() => {
    setShowStopProcessConfirm(false);
    setStopProcessTargetRid(null);
  }, []);

  const pullSelf = useCallback(() => {
    if (socket) {
      if (
        confirm('dokodemo-claude自身を最新版に更新します。よろしいですか？')
      ) {
        socket.emit('pull-self');
      }
    }
  }, [socket]);

  return {
    repositories,
    currentRepo,
    currentRid,
    repoProcessStatuses,
    lastAccessTimes,
    isLoadingRepoData,
    isSwitchingRepo,
    showStopProcessConfirm,
    stoppingProcesses,
    stopProcessTargetRid,
    showDeleteConfirm,
    setShowDeleteConfirm,
    cloneRepository,
    createRepository,
    deleteRepository,
    switchRepository,
    showStopProcessConfirmDialog,
    confirmStopProcesses,
    cancelStopProcesses,
    pullSelf,
    endLoadingOnOutput,
  };
}
