import { createContext, useContext, useEffect, type ReactNode } from 'react';
import { repositoryIdMap } from '@/shared/utils/repository-id-map';
import {
  usePromptQueue,
  type UsePromptQueueReturn,
} from '@/features/ai/hooks/usePromptQueue';
import { useSocketContext } from '@/app/providers/SocketProvider';
import { useRepositoryContext } from '@/features/repo/providers/RepositoryProvider';
import { useAiContext } from '@/features/ai/providers/AiProvider';

const QueueContext = createContext<UsePromptQueueReturn | null>(null);

/**
 * プロンプトキュー管理（usePromptQueue）を提供する Provider。
 */
export function QueueProvider({ children }: { children: ReactNode }) {
  const { socket } = useSocketContext();
  const { repository } = useRepositoryContext();
  const { primaryProvider } = useAiContext();

  // プロンプトキュー管理（プライマリの provider に同期）
  const promptQueue = usePromptQueue(
    socket,
    repository.currentRepo,
    primaryProvider
  );

  // プライマリの provider が決まったらキューを取得
  useEffect(() => {
    if (!socket || !repository.currentRepo || !primaryProvider) return;
    const rid = repositoryIdMap.getRid(repository.currentRepo);
    if (!rid) return;
    socket.emit('get-prompt-queue', { rid, provider: primaryProvider });
  }, [socket, repository.currentRepo, primaryProvider]);

  return (
    <QueueContext.Provider value={promptQueue}>
      {children}
    </QueueContext.Provider>
  );
}

export function useQueueContext(): UsePromptQueueReturn {
  const ctx = useContext(QueueContext);
  if (!ctx) {
    throw new Error('useQueueContext must be used within QueueProvider');
  }
  return ctx;
}
