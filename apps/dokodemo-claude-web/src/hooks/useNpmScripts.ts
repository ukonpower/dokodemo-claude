import { useState, useEffect, useCallback, useRef } from 'react';
import { Socket } from 'socket.io-client';
import type { ServerToClientEvents, ClientToServerEvents } from '../types';
import { repositoryIdMap } from '../utils/repository-id-map';

/**
 * useNpmScripts フックの戻り値
 */
export interface UseNpmScriptsReturn {
  npmScripts: Record<string, string>;
  executeNpmScript: (scriptName: string) => void;
  refreshNpmScripts: () => void;
}

/**
 * npmスクリプトの一覧取得・実行・再取得を管理するカスタムフック
 */
export function useNpmScripts(
  socket: Socket<ServerToClientEvents, ClientToServerEvents> | null,
  currentRepo: string,
  activeTerminalId: string | null
): UseNpmScriptsReturn {
  // npmスクリプト関連
  const [npmScripts, setNpmScripts] = useState<Record<string, string>>({});

  // currentRepoの参照
  const currentRepoRef = useRef(currentRepo);
  useEffect(() => {
    currentRepoRef.current = currentRepo;
  }, [currentRepo]);

  // npmスクリプト関連のリスナー
  useEffect(() => {
    if (!socket) return;

    const handleNpmScriptsList = (
      data: Parameters<ServerToClientEvents['npm-scripts-list']>[0]
    ) => {
      const currentRid = repositoryIdMap.getRid(currentRepoRef.current);
      if (data.rid === currentRid) {
        setNpmScripts(data.scripts);
      }
    };

    socket.on('npm-scripts-list', handleNpmScriptsList);

    return () => {
      socket.off('npm-scripts-list', handleNpmScriptsList);
    };
  }, [socket]);

  // npmスクリプト実行ハンドラ
  const executeNpmScript = useCallback(
    (scriptName: string) => {
      if (socket && currentRepo) {
        const rid = repositoryIdMap.getRid(currentRepo);
        if (!rid) return;
        socket.emit('execute-npm-script', {
          rid,
          scriptName,
          terminalId: activeTerminalId || undefined,
        });
      }
    },
    [socket, currentRepo, activeTerminalId]
  );

  // npmスクリプト更新ハンドラ
  const refreshNpmScripts = useCallback(() => {
    if (socket && currentRepo) {
      const rid = repositoryIdMap.getRid(currentRepo);
      if (!rid) return;
      socket.emit('get-npm-scripts', { rid });
    }
  }, [socket, currentRepo]);

  return {
    npmScripts,
    executeNpmScript,
    refreshNpmScripts,
  };
}
