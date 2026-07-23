import { useState, useEffect, useCallback, useRef } from 'react';
import { Socket } from 'socket.io-client';
import type {
  AiProvider,
  PromptQueueItem,
  ServerToClientEvents,
  ClientToServerEvents,
} from '@/types';
import { repositoryIdMap } from '@/utils/repository-id-map';

export interface LoopSettings {
  judge: 'ai' | 'user' | 'none';
  judgeEveryN: number;
  intervalSec: number;
  judgeCriteria?: string;
  // 定期プランニング: N 周ごとに強いモデルで計画ターンを 1 回差し込む
  planning?: {
    everyN: number;
    model: string;
    prompt: string;
  };
}

/**
 * ループ終了時の情報（AI 判断の理由表示用）。
 * アイテムはループ終了時にキューから消えるため、理由をここに退避して
 * バナー表示する。
 */
export interface LoopEndInfo {
  reason: string;
  endedBy: 'ai-judge' | 'user';
  endedAt: number;
}

/**
 * usePromptQueue フックの戻り値
 */
export interface UsePromptQueueReturn {
  // 状態
  promptQueue: PromptQueueItem[];
  isQueueProcessing: boolean;
  isQueuePaused: boolean;
  currentItemId: string | undefined;

  // アクション
  addToQueue: (
    command: string,
    sendClearBefore: boolean,
    sendCommitAfter: boolean,
    model?: string,
    loop?: LoopSettings
  ) => void;
  removeFromQueue: (itemId: string) => void;
  updateQueue: (
    itemId: string,
    prompt: string,
    sendClearBefore: boolean,
    isAutoCommit: boolean,
    model?: string,
    loop?: LoopSettings | null
  ) => void;
  pauseQueue: () => void;
  resumeQueue: () => void;
  resetQueue: () => void;
  cancelCurrentItem: () => void;
  forceSend: (itemId: string) => void;
  reorderQueue: (reorderedQueue: PromptQueueItem[]) => void;
  requeueItem: (itemId: string) => void;
  stopLoop: (itemId: string) => void;
  approveLoopContinuation: (itemId: string, approved: boolean) => void;

  // ループ終了情報（AI 判断の理由バナー表示用）
  loopEndInfo: LoopEndInfo | null;
  dismissLoopEnd: () => void;

  // クリア関数（リポジトリ切り替え時用）
  clearState: () => void;
}

/**
 * プロンプトキュー管理を行うカスタムフック
 * provider はリポジトリのプライマリ AI インスタンスの provider を渡す
 */
export function usePromptQueue(
  socket: Socket<ServerToClientEvents, ClientToServerEvents> | null,
  currentRepo: string,
  primaryProvider: AiProvider | undefined
): UsePromptQueueReturn {
  // 状態
  const [promptQueue, setPromptQueue] = useState<PromptQueueItem[]>([]);
  const [isQueueProcessing, setIsQueueProcessing] = useState<boolean>(false);
  const [isQueuePaused, setIsQueuePaused] = useState<boolean>(false);
  const [currentItemId, setCurrentItemId] = useState<string | undefined>(
    undefined
  );
  const [loopEndInfo, setLoopEndInfo] = useState<LoopEndInfo | null>(null);

  // Ref
  const currentRepoRef = useRef(currentRepo);
  const currentProviderRef = useRef<AiProvider | undefined>(primaryProvider);

  useEffect(() => {
    currentRepoRef.current = currentRepo;
  }, [currentRepo]);
  useEffect(() => {
    currentProviderRef.current = primaryProvider;
  }, [primaryProvider]);

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
        setCurrentItemId(data.currentItemId);
      }
    };

    // キューアイテム追加
    const handlePromptAddedToQueue = (
      data: Parameters<ServerToClientEvents['prompt-added-to-queue']>[0]
    ) => {
      if (data.success) {
        const currentRid = repositoryIdMap.getRid(currentRepoRef.current);
        const provider = currentProviderRef.current;
        if (currentRid && provider) {
          socket.emit('get-prompt-queue', { rid: currentRid, provider });
        }
      }
    };

    // キューアイテム削除
    const handlePromptRemovedFromQueue = (
      data: Parameters<ServerToClientEvents['prompt-removed-from-queue']>[0]
    ) => {
      if (data.success) {
        const currentRid = repositoryIdMap.getRid(currentRepoRef.current);
        const provider = currentProviderRef.current;
        if (currentRid && provider) {
          socket.emit('get-prompt-queue', { rid: currentRid, provider });
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
        const provider = currentProviderRef.current;
        if (currentRid && provider) {
          socket.emit('get-prompt-queue', { rid: currentRid, provider });
        }
      }
    };

    // ループ終了通知: キュー再取得 + 理由があればバナー表示用に退避
    // （終了時はアイテムがキューから消えるため、reason はここでしか拾えない）
    const handleLoopEnded = (
      data: Parameters<ServerToClientEvents['prompt-loop-ended']>[0]
    ) => {
      const currentRid = repositoryIdMap.getRid(currentRepoRef.current);
      if (
        data.rid === currentRid &&
        data.provider === currentProviderRef.current
      ) {
        if (data.reason) {
          setLoopEndInfo({
            reason: data.reason,
            endedBy: data.endedBy,
            endedAt: Date.now(),
          });
        }
        const provider = currentProviderRef.current;
        if (currentRid && provider) {
          socket.emit('get-prompt-queue', { rid: currentRid, provider });
        }
      }
    };

    socket.on('prompt-queue-updated', handlePromptQueueUpdated);
    socket.on('prompt-added-to-queue', handlePromptAddedToQueue);
    socket.on('prompt-removed-from-queue', handlePromptRemovedFromQueue);
    socket.on('prompt-queue-processing-started', handleProcessingStarted);
    socket.on('prompt-queue-processing-completed', handleProcessingCompleted);
    socket.on('prompt-loop-ended', handleLoopEnded);

    return () => {
      socket.off('prompt-queue-updated', handlePromptQueueUpdated);
      socket.off('prompt-added-to-queue', handlePromptAddedToQueue);
      socket.off('prompt-removed-from-queue', handlePromptRemovedFromQueue);
      socket.off('prompt-queue-processing-started', handleProcessingStarted);
      socket.off('prompt-queue-processing-completed', handleProcessingCompleted);
      socket.off('prompt-loop-ended', handleLoopEnded);
    };
  }, [socket]);

  // アクション関数
  const addToQueue = useCallback(
    (
      command: string,
      sendClearBefore: boolean,
      sendCommitAfter: boolean,
      model?: string,
      loop?: LoopSettings
    ) => {
      if (!socket || !currentRepo) return;
      const rid = repositoryIdMap.getRid(currentRepo);
      if (!rid) return;
      const provider = currentProviderRef.current;
      if (!provider) return;

      // 新しいループを開始するとき、前回のループ終了バナーは古い情報なので消す
      if (loop) {
        setLoopEndInfo(null);
      }

      socket.emit('add-to-prompt-queue', {
        rid,
        provider,
        prompt: command,
        sendClearBefore,
        isAutoCommit: sendCommitAfter,
        model,
        loop,
      });
    },
    [socket, currentRepo]
  );

  const removeFromQueue = useCallback(
    (itemId: string) => {
      if (!socket || !currentRepo) return;
      const rid = repositoryIdMap.getRid(currentRepo);
      if (!rid) return;
      const provider = currentProviderRef.current;
      if (!provider) return;
      socket.emit('remove-from-prompt-queue', {
        rid,
        provider,
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
      model?: string,
      loop?: LoopSettings | null
    ) => {
      if (!socket || !currentRepo) return;
      const rid = repositoryIdMap.getRid(currentRepo);
      if (!rid) return;
      const provider = currentProviderRef.current;
      if (!provider) return;
      socket.emit('update-prompt-queue', {
        rid,
        provider,
        itemId,
        prompt,
        sendClearBefore,
        isAutoCommit,
        model,
        loop,
      });
    },
    [socket, currentRepo]
  );

  const pauseQueue = useCallback(() => {
    if (!socket || !currentRepo) return;
    const rid = repositoryIdMap.getRid(currentRepo);
    if (!rid) return;
    const provider = currentProviderRef.current;
    if (!provider) return;
    socket.emit('pause-prompt-queue', { rid, provider });
  }, [socket, currentRepo]);

  const resumeQueue = useCallback(() => {
    if (!socket || !currentRepo) return;
    const rid = repositoryIdMap.getRid(currentRepo);
    if (!rid) return;
    const provider = currentProviderRef.current;
    if (!provider) return;
    socket.emit('resume-prompt-queue', { rid, provider });
  }, [socket, currentRepo]);

  const resetQueue = useCallback(() => {
    if (!socket || !currentRepo) return;
    const rid = repositoryIdMap.getRid(currentRepo);
    if (!rid) return;
    const provider = currentProviderRef.current;
    if (!provider) return;
    socket.emit('reset-prompt-queue', { rid, provider });
  }, [socket, currentRepo]);

  const cancelCurrentItem = useCallback(() => {
    if (!socket || !currentRepo) return;
    const rid = repositoryIdMap.getRid(currentRepo);
    if (!rid) return;
    const provider = currentProviderRef.current;
    if (!provider) return;
    socket.emit('cancel-current-queue-item', { rid, provider });
  }, [socket, currentRepo]);

  const forceSend = useCallback(
    (itemId: string) => {
      if (!socket || !currentRepo) return;
      const rid = repositoryIdMap.getRid(currentRepo);
      if (!rid) return;
      const provider = currentProviderRef.current;
      if (!provider) return;
      socket.emit('force-send-prompt-queue-item', {
        rid,
        provider,
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
      const provider = currentProviderRef.current;
      if (!provider) return;
      socket.emit('reorder-prompt-queue', {
        rid,
        provider,
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
      const provider = currentProviderRef.current;
      if (!provider) return;
      socket.emit('requeue-prompt-item', {
        rid,
        provider,
        itemId,
      });
    },
    [socket, currentRepo]
  );

  const stopLoop = useCallback(
    (itemId: string) => {
      if (!socket || !currentRepo) return;
      const rid = repositoryIdMap.getRid(currentRepo);
      if (!rid) return;
      const provider = currentProviderRef.current;
      if (!provider) return;
      socket.emit('stop-prompt-loop', { rid, provider, itemId });
    },
    [socket, currentRepo]
  );

  const approveLoopContinuation = useCallback(
    (itemId: string, approved: boolean) => {
      if (!socket || !currentRepo) return;
      const rid = repositoryIdMap.getRid(currentRepo);
      if (!rid) return;
      const provider = currentProviderRef.current;
      if (!provider) return;
      socket.emit('approve-loop-continuation', {
        rid,
        provider,
        itemId,
        approved,
      });
    },
    [socket, currentRepo]
  );

  const dismissLoopEnd = useCallback(() => {
    setLoopEndInfo(null);
  }, []);

  // 状態クリア
  const clearState = useCallback(() => {
    setPromptQueue([]);
    setIsQueueProcessing(false);
    setIsQueuePaused(false);
    setCurrentItemId(undefined);
    setLoopEndInfo(null);
  }, []);

  return {
    promptQueue,
    isQueueProcessing,
    isQueuePaused,
    currentItemId,
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
    stopLoop,
    approveLoopContinuation,
    loopEndInfo,
    dismissLoopEnd,
    clearState,
  };
}
