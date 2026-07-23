import { createContext, useContext, type ReactNode } from 'react';
import {
  useWorktrees,
  type UseWorktreesReturn,
} from '@/features/worktree/hooks/useWorktrees';
import { useSocketContext } from '@/app/providers/SocketProvider';
import { useRepositoryContext } from '@/features/repo/providers/RepositoryProvider';

const WorktreeContext = createContext<UseWorktreesReturn | null>(null);

/**
 * ワークツリー管理（useWorktrees）を提供する Provider。
 */
export function WorktreeProvider({ children }: { children: ReactNode }) {
  const { socket } = useSocketContext();
  const { repository } = useRepositoryContext();

  // ワークツリー管理
  const worktrees = useWorktrees(
    socket,
    repository.currentRepo,
    repository.switchRepository
  );

  return (
    <WorktreeContext.Provider value={worktrees}>
      {children}
    </WorktreeContext.Provider>
  );
}

export function useWorktreeContext(): UseWorktreesReturn {
  const ctx = useContext(WorktreeContext);
  if (!ctx) {
    throw new Error('useWorktreeContext must be used within WorktreeProvider');
  }
  return ctx;
}
