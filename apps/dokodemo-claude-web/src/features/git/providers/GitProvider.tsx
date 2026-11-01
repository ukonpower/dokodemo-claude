import { createContext, useContext, type ReactNode } from 'react';
import { useGitDiff, type UseGitDiffReturn } from '@/features/git/hooks/useGitDiff';
import {
  useGitActions,
  type UseGitActionsReturn,
} from '@/features/git/hooks/useGitActions';
import { useSocketContext } from '@/app/providers/SocketProvider';
import { useRepositoryContext } from '@/features/repo/providers/RepositoryProvider';

const GitDiffContext = createContext<UseGitDiffReturn | null>(null);
const GitActionsContext = createContext<UseGitActionsReturn | null>(null);

/**
 * Git差分（useGitDiff）と Git操作（useGitActions）を 1 つの Provider で呼び、
 * 2 つの Context（useGitDiffContext / useGitActionsContext）で提供する。
 */
export function GitProvider({ children }: { children: ReactNode }) {
  const { socket } = useSocketContext();
  const { repository } = useRepositoryContext();

  // Git差分管理
  const gitDiff = useGitDiff(socket, repository.currentRepo);

  // Git操作（pull / push / fetch）管理
  const gitActions = useGitActions(socket, repository.currentRepo);

  return (
    <GitDiffContext.Provider value={gitDiff}>
      <GitActionsContext.Provider value={gitActions}>
        {children}
      </GitActionsContext.Provider>
    </GitDiffContext.Provider>
  );
}

export function useGitDiffContext(): UseGitDiffReturn {
  const ctx = useContext(GitDiffContext);
  if (!ctx) {
    throw new Error('useGitDiffContext must be used within GitProvider');
  }
  return ctx;
}

export function useGitActionsContext(): UseGitActionsReturn {
  const ctx = useContext(GitActionsContext);
  if (!ctx) {
    throw new Error('useGitActionsContext must be used within GitProvider');
  }
  return ctx;
}
