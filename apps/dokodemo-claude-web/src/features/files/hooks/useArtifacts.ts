import { useState, useEffect, useRef } from 'react';
import { Socket } from 'socket.io-client';
import type {
  ArtifactInfo,
  ServerToClientEvents,
  ClientToServerEvents,
} from '@/types';
import { repositoryIdMap } from '@/shared/utils/repository-id-map';
import { useRefreshOnFocus } from '@/shared/hooks/useRefreshOnFocus';

export interface UseArtifactsReturn {
  /** 現在のリポジトリ / ワークツリーで作られた Artifact（新しい順） */
  artifacts: ArtifactInfo[];
}

/** 現在のリポジトリの claude.ai Artifact 一覧を取得・追随する */
export function useArtifacts(
  socket: Socket<ServerToClientEvents, ClientToServerEvents> | null,
  currentRepo: string
): UseArtifactsReturn {
  const [artifacts, setArtifacts] = useState<ArtifactInfo[]>([]);

  const currentRepoRef = useRef(currentRepo);
  useEffect(() => {
    currentRepoRef.current = currentRepo;
  }, [currentRepo]);

  // 初回取得は repo-switched 応答時（useSocketBootstrap）に行う。
  // ここでは前のリポジトリの一覧が残って見えないよう、切り替え時に空へ戻す
  useEffect(() => {
    setArtifacts([]);
  }, [currentRepo]);

  // Stop hook はバックグラウンドタブだと取り逃すことがあるため、復帰時に取り直して補完する
  useRefreshOnFocus(() => {
    if (!socket || !socket.connected) return;
    const rid = repositoryIdMap.getRid(currentRepoRef.current);
    if (!rid) return;
    socket.emit('get-artifacts', { rid });
  });

  useEffect(() => {
    if (!socket) return;

    const handleArtifactsList = (
      data: Parameters<ServerToClientEvents['artifacts-list']>[0]
    ) => {
      const currentRid = repositoryIdMap.getRid(currentRepoRef.current);
      if (data.rid === currentRid) {
        setArtifacts(data.artifacts);
      }
    };

    // 通知は全クライアントへ配信されるため、表示中の rid のときだけ取り直す
    const handleArtifactsUpdated = (
      data: Parameters<ServerToClientEvents['artifacts-updated']>[0]
    ) => {
      const currentRid = repositoryIdMap.getRid(currentRepoRef.current);
      if (data.rid === currentRid) {
        socket.emit('get-artifacts', { rid: data.rid });
      }
    };

    socket.on('artifacts-list', handleArtifactsList);
    socket.on('artifacts-updated', handleArtifactsUpdated);

    return () => {
      socket.off('artifacts-list', handleArtifactsList);
      socket.off('artifacts-updated', handleArtifactsUpdated);
    };
  }, [socket]);

  return { artifacts };
}
