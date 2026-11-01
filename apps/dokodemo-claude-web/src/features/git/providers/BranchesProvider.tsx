import { createContext, useCallback, useContext, type ReactNode } from 'react';
import type { AiOutputLine } from '@/types';
import {
  useBranches,
  type UseBranchesReturn,
} from '@/features/git/hooks/useBranches';
import { useSocketContext } from '@/app/providers/SocketProvider';
import { useRepositoryContext } from '@/features/repo/providers/RepositoryProvider';
import { useAiContext } from '@/features/ai/providers/AiProvider';

const BranchesContext = createContext<UseBranchesReturn | null>(null);

/**
 * ブランチ管理（useBranches）を提供する Provider。
 */
export function BranchesProvider({ children }: { children: ReactNode }) {
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

  // ブランチ管理（プライマリの provider を渡す）
  const branches = useBranches(
    socket,
    repository.currentRepo,
    primaryProvider ?? 'claude',
    onBranchError
  );

  return (
    <BranchesContext.Provider value={branches}>
      {children}
    </BranchesContext.Provider>
  );
}

export function useBranchesContext(): UseBranchesReturn {
  const ctx = useContext(BranchesContext);
  if (!ctx) {
    throw new Error('useBranchesContext must be used within BranchesProvider');
  }
  return ctx;
}
