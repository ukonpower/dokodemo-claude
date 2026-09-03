import { useState, useEffect, useCallback, useRef } from 'react';
import { Socket } from 'socket.io-client';
import type { ServerToClientEvents, ClientToServerEvents } from '@/types';
import { repositoryIdMap } from '@/shared/utils/repository-id-map';

/**
 * useGitActions フックの戻り値
 */
export interface UseGitActionsReturn {
  actionInProgress: boolean;
  pull: () => void;
  push: (opts?: { remote?: string; force?: boolean; setUpstream?: boolean }) => void;
  fetch: (opts?: { prune?: boolean }) => void;
  // push 先選択用の remote 一覧と、その取得要求
  remotes: string[];
  requestRemotes: () => void;
}

/**
 * コマンドパレット等から呼ぶ Git 操作（pull / push / fetch）を管理するカスタムフック
 */
export function useGitActions(
  socket: Socket<ServerToClientEvents, ClientToServerEvents> | null,
  currentRepo: string
): UseGitActionsReturn {
  const [actionInProgress, setActionInProgress] = useState(false);
  const [remotes, setRemotes] = useState<string[]>([]);

  const currentRepoRef = useRef(currentRepo);
  useEffect(() => {
    currentRepoRef.current = currentRepo;
  }, [currentRepo]);

  useEffect(() => {
    if (!socket) return;

    const handleActionResult = (
      data: Parameters<ServerToClientEvents['git-action-result']>[0]
    ) => {
      const currentRid = repositoryIdMap.getRid(currentRepoRef.current);
      if (data.rid !== currentRid) return;
      setActionInProgress(false);
      if (!data.success) {
        console.error(`git ${data.action} failed: ${data.message}`);
      }
    };

    const handleRemotesResult = (
      data: Parameters<ServerToClientEvents['git-remotes-result']>[0]
    ) => {
      const currentRid = repositoryIdMap.getRid(currentRepoRef.current);
      if (data.rid === currentRid) {
        setRemotes(data.remotes);
      }
    };

    socket.on('git-action-result', handleActionResult);
    socket.on('git-remotes-result', handleRemotesResult);

    return () => {
      socket.off('git-action-result', handleActionResult);
      socket.off('git-remotes-result', handleRemotesResult);
    };
  }, [socket]);

  const pull = useCallback(() => {
    if (!socket || !currentRepo) return;
    const rid = repositoryIdMap.getRid(currentRepo);
    if (!rid) return;
    setActionInProgress(true);
    socket.emit('git-pull', { rid });
  }, [socket, currentRepo]);

  const push = useCallback(
    (opts?: { remote?: string; force?: boolean; setUpstream?: boolean }) => {
      if (!socket || !currentRepo) return;
      const rid = repositoryIdMap.getRid(currentRepo);
      if (!rid) return;
      setActionInProgress(true);
      socket.emit('git-push', { rid, ...(opts ?? {}) });
    },
    [socket, currentRepo]
  );

  const fetchRemote = useCallback(
    (opts?: { prune?: boolean }) => {
      if (!socket || !currentRepo) return;
      const rid = repositoryIdMap.getRid(currentRepo);
      if (!rid) return;
      setActionInProgress(true);
      socket.emit('git-fetch', { rid, ...(opts ?? {}) });
    },
    [socket, currentRepo]
  );

  const requestRemotes = useCallback(() => {
    if (!socket || !currentRepo) return;
    const rid = repositoryIdMap.getRid(currentRepo);
    if (!rid) return;
    socket.emit('git-remotes', { rid });
  }, [socket, currentRepo]);

  return {
    actionInProgress,
    pull,
    push,
    fetch: fetchRemote,
    remotes,
    requestRemotes,
  };
}
