import { createContext, useCallback, useContext, type ReactNode } from 'react';
import type { AiOutputLine } from '@/types';
import {
  useBranchWorktree,
  type UseBranchWorktreeReturn,
} from '@/features/worktree/hooks/useBranchWorktree';
import { useSocketContext } from '@/app/providers/SocketProvider';
import { useRepositoryContext } from '@/features/repo/providers/RepositoryProvider';
import { useAiContext } from '@/features/ai/providers/AiProvider';

const WorktreeContext = createContext<UseBranchWorktreeReturn | null>(null);

/**
 * ブランチ・ワークツリー管理（useBranchWorktree）を提供する Provider。
 */
export function WorktreeProvider({ children }: { children: ReactNode }) {
  const { socket } = useSocketContext();
  const { repository } = useRepositoryContext();
  const { primaryProvider } = useAiContext();

  // ブランチエラー時のコールバック
  const onBranchError = useCallback(
    (errorMessage: AiOutputLine) => {
      console.error('Branch error:', errorMessage.content);
    },
    []
  );

  // ブランチ・ワークツリー管理（プライマリの provider を渡す）
  const branchWorktree = useBranchWorktree(
    socket,
    repository.currentRepo,
    primaryProvider ?? 'claude',
    repository.switchRepository,
    onBranchError
  );

  return (
    <WorktreeContext.Provider value={branchWorktree}>
      {children}
    </WorktreeContext.Provider>
  );
}

export function useWorktreeContext(): UseBranchWorktreeReturn {
  const ctx = useContext(WorktreeContext);
  if (!ctx) {
    throw new Error('useWorktreeContext must be used within WorktreeProvider');
  }
  return ctx;
}
