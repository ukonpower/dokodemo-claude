import { createContext, useContext, type ReactNode } from 'react';
import { useGitDiff, type UseGitDiffReturn } from '@/features/git/hooks/useGitDiff';
import {
  useGitGraph,
  type UseGitGraphReturn,
} from '@/features/git/hooks/useGitGraph';
import { useSocketContext } from '@/app/providers/SocketProvider';
import { useRepositoryContext } from '@/features/repo/providers/RepositoryProvider';

const GitDiffContext = createContext<UseGitDiffReturn | null>(null);
const GitGraphContext = createContext<UseGitGraphReturn | null>(null);

/**
 * Git差分（useGitDiff）と Git Graph（useGitGraph）を 1 つの Provider で呼び、
 * 2 つの Context（useGitDiffContext / useGitGraphContext）で提供する。
 */
export function GitProvider({ children }: { children: ReactNode }) {
  const { socket } = useSocketContext();
  const { repository } = useRepositoryContext();

  // Git差分管理
  const gitDiff = useGitDiff(socket, repository.currentRepo);

  // Git Graph（コミットグラフ）管理
  const gitGraph = useGitGraph(socket, repository.currentRepo);

  return (
    <GitDiffContext.Provider value={gitDiff}>
      <GitGraphContext.Provider value={gitGraph}>
        {children}
      </GitGraphContext.Provider>
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

export function useGitGraphContext(): UseGitGraphReturn {
  const ctx = useContext(GitGraphContext);
  if (!ctx) {
    throw new Error('useGitGraphContext must be used within GitProvider');
  }
  return ctx;
}
