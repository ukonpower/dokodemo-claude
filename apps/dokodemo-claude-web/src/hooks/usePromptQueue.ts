import { useState, useEffect, useCallback, useRef } from 'react';
import { Socket } from 'socket.io-client';
import type {
  AiProvider,
  PromptQueueItem,
  ServerToClientEvents,
  ClientToServerEvents,
} from '../types';
import { repositoryIdMap } from '../utils/repository-id-map';

/**
 * usePromptQueue フックの戻り値
 */
export interface UsePromptQueueReturn {
  // 状態
  promptQueue: PromptQueueItem[];
  isQueueProcessing: boolean;
  isQueuePaused: boolean;

  // アクション
  addToQueue: (
    command: string,
    sendClearBefore: boolean,
    sendCommitAfter: boolean,
    model?: string
  ) => void;
  removeFromQueue: (itemId: string) => void;
  updateQueue: (
    itemId: string,
    prompt: string,
    sendClearBefore: boolean,
    isAutoCommit: boolean,
    model?: string
  ) => void;
  pauseQueue: () => void;
  resumeQueue: () => void;
  resetQueue: () => void;
  cancelCurrentItem: () => void;
  forceSend: (itemId: string) => void;
  reorderQueue: (reorderedQueue: PromptQueueItem[]) => void;
  requeueItem: (itemId: string) => void;

  // クリア関数（リポジトリ切り替え時用）
  clearState: () => void;
}

/**
 * プロンプトキュー管理を行うカスタムフック
 */
export function usePromptQueue(
  socket: Socket<ServerToClientEvents, ClientToServerEvents> | null,
  currentRepo: string,
  currentProvider: AiProvider
): UsePromptQueueReturn {
  // 状態
  const [promptQueue, setPromptQueue] = useState<PromptQueueItem[]>([]);
  const [isQueueProcessing, setIsQueueProcessing] = useState<boolean>(false);
  const [isQueuePaused, setIsQueuePaused] = useState<boolean>(false);

  // Ref
  const currentRepoRef = useRef(currentRepo);
  const currentProviderRef = useRef(currentProvider);

  useEffect(() => {
    currentRepoRef.current = currentRepo;
  }, [currentRepo]);
  useEffect(() => {
    currentProviderRef.current = currentProvider;
  }, [currentProvider]);

  // Socketイベントリスナー
  useEffect(() => {
    if (!socket) return;

    // キュー更新
    const handlePromptQueueUpdated = (
      data: Parameters<ServerToClientEvents['prompt-queue-updated']>[0]
    ) => {
      const currentRid = repositoryIdMap.getRid(currentRepoRef.current);
      if (
        data.rid === currentRid &&
        data.provider === currentProviderRef.current
      ) {
        setPromptQueue(data.queue);
        setIsQueueProcessing(data.isProcessing);
        setIsQueuePaused(data.isPaused);
      }
    };

    // キューアイテム追加
    const handlePromptAddedToQueue = (
      data: Parameters<ServerToClientEvents['prompt-added-to-queue']>[0]
    ) => {
      if (data.success) {
        const currentRid = repositoryIdMap.getRid(currentRepoRef.current);
        if (currentRid) {
          socket.emit('get-prompt-queue', {
            rid: currentRid,
            provider: currentProviderRef.current,
          });
        }
      }
    };

    // キューアイテム削除
    const handlePromptRemovedFromQueue = (
      data: Parameters<ServerToClientEvents['prompt-removed-from-queue']>[0]
    ) => {
      if (data.success) {
        const currentRid = repositoryIdMap.getRid(currentRepoRef.current);
        if (currentRid) {
          socket.emit('get-prompt-queue', {
            rid: currentRid,
            provider: currentProviderRef.current,
          });
        }
      }
    };

    // キュー処理開始
    const handleProcessingStarted = (
      data: Parameters<
        ServerToClientEvents['prompt-queue-processing-started']
      >[0]
    ) => {
      const currentRid = repositoryIdMap.getRid(currentRepoRef.current);
      if (
        data.rid === currentRid &&
        data.provider === currentProviderRef.current
      ) {
        setIsQueueProcessing(true);
      }
    };

    // キュー処理完了
    const handleProcessingCompleted = (
      data: Parameters<
        ServerToClientEvents['prompt-queue-processing-completed']
      >[0]
    ) => {
      const currentRid = repositoryIdMap.getRid(currentRepoRef.current);
      if (
        data.rid === currentRid &&
        data.provider === currentProviderRef.current
      ) {
        setIsQueueProcessing(false);
        if (currentRid) {
          socket.emit('get-prompt-queue', {
            rid: currentRid,
            provider: currentProviderRef.current,
          });
        }
      }
    };

    socket.on('prompt-queue-updated', handlePromptQueueUpdated);
    socket.on('prompt-added-to-queue', handlePromptAddedToQueue);
    socket.on('prompt-removed-from-queue', handlePromptRemovedFromQueue);
    socket.on('prompt-queue-processing-started', handleProcessingStarted);
    socket.on('prompt-queue-processing-completed', handleProcessingCompleted);

    return () => {
      socket.off('prompt-queue-updated', handlePromptQueueUpdated);
      socket.off('prompt-added-to-queue', handlePromptAddedToQueue);
      socket.off('prompt-removed-from-queue', handlePromptRemovedFromQueue);
      socket.off('prompt-queue-processing-started', handleProcessingStarted);
      socket.off('prompt-queue-processing-completed', handleProcessingCompleted);
    };
  }, [socket]);

  // アクション関数
  const addToQueue = useCallback(
    (
      command: string,
      sendClearBefore: boolean,
      sendCommitAfter: boolean,
      model?: string
    ) => {
      if (!socket || !currentRepo) return;
      const rid = repositoryIdMap.getRid(currentRepo);
      if (!rid) return;

      socket.emit('add-to-prompt-queue', {
        rid,
        provider: currentProviderRef.current,
        prompt: command,
        sendClearBefore,
        isAutoCommit: sendCommitAfter,
        model,
      });
    },
    [socket, currentRepo]
  );

  const removeFromQueue = useCallback(
    (itemId: string) => {
      if (!socket || !currentRepo) return;
      const rid = repositoryIdMap.getRid(currentRepo);
      if (!rid) return;
      socket.emit('remove-from-prompt-queue', {
        rid,
        provider: currentProviderRef.current,
        itemId,
      });
    },
    [socket, currentRepo]
  );

  const updateQueue = useCallback(
    (
      itemId: string,
      prompt: string,
      sendClearBefore: boolean,
      isAutoCommit: boolean,
      model?: string
    ) => {
      if (!socket || !currentRepo) return;
      const rid = repositoryIdMap.getRid(currentRepo);
      if (!rid) return;
      socket.emit('update-prompt-queue', {
        rid,
        provider: currentProviderRef.current,
        itemId,
        prompt,
        sendClearBefore,
        isAutoCommit,
        model,
      });
    },
    [socket, currentRepo]
  );

  const pauseQueue = useCallback(() => {
    if (!socket || !currentRepo) return;
    const rid = repositoryIdMap.getRid(currentRepo);
    if (!rid) return;
    socket.emit('pause-prompt-queue', {
      rid,
      provider: currentProviderRef.current,
    });
  }, [socket, currentRepo]);

  const resumeQueue = useCallback(() => {
    if (!socket || !currentRepo) return;
    const rid = repositoryIdMap.getRid(currentRepo);
    if (!rid) return;
    socket.emit('resume-prompt-queue', {
      rid,
      provider: currentProviderRef.current,
    });
  }, [socket, currentRepo]);

  const resetQueue = useCallback(() => {
    if (!socket || !currentRepo) return;
    const rid = repositoryIdMap.getRid(currentRepo);
    if (!rid) return;
    socket.emit('reset-prompt-queue', {
      rid,
      provider: currentProviderRef.current,
    });
  }, [socket, currentRepo]);

  const cancelCurrentItem = useCallback(() => {
    if (!socket || !currentRepo) return;
    const rid = repositoryIdMap.getRid(currentRepo);
    if (!rid) return;
    socket.emit('cancel-current-queue-item', {
      rid,
      provider: currentProviderRef.current,
    });
  }, [socket, currentRepo]);

  const forceSend = useCallback(
    (itemId: string) => {
      if (!socket || !currentRepo) return;
      const rid = repositoryIdMap.getRid(currentRepo);
      if (!rid) return;
      socket.emit('force-send-prompt-queue-item', {
        rid,
        provider: currentProviderRef.current,
        itemId,
      });
    },
    [socket, currentRepo]
  );

  const reorderQueue = useCallback(
    (reorderedQueue: PromptQueueItem[]) => {
      if (!socket || !currentRepo) return;
      const rid = repositoryIdMap.getRid(currentRepo);
      if (!rid) return;
      socket.emit('reorder-prompt-queue', {
        rid,
        provider: currentProviderRef.current,
        queue: reorderedQueue,
      });
    },
    [socket, currentRepo]
  );

  const requeueItem = useCallback(
    (itemId: string) => {
      if (!socket || !currentRepo) return;
      const rid = repositoryIdMap.getRid(currentRepo);
      if (!rid) return;
      socket.emit('requeue-prompt-item', {
        rid,
        provider: currentProviderRef.current,
        itemId,
      });
    },
    [socket, currentRepo]
  );

  // 状態クリア
  const clearState = useCallback(() => {
    setPromptQueue([]);
    setIsQueueProcessing(false);
    setIsQueuePaused(false);
  }, []);

  // リポジトリ切り替え時に状態をリセット
  useEffect(() => {
    clearState();
  }, [currentRepo, clearState]);

  return {
    promptQueue,
    isQueueProcessing,
    isQueuePaused,
    addToQueue,
    removeFromQueue,
    updateQueue,
    pauseQueue,
    resumeQueue,
    resetQueue,
    cancelCurrentItem,
    forceSend,
    reorderQueue,
    requeueItem,
    clearState,
  };
}
