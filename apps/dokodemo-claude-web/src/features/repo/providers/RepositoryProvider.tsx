import { createContext, useContext, type ReactNode } from 'react';
import {
  useRepository,
  type UseRepositoryReturn,
} from '@/features/repo/hooks/useRepository';
import { useRepositorySwitchFromList } from '@/features/repo/hooks/useRepositorySwitchFromList';
import { useSocketContext } from '@/app/providers/SocketProvider';

export interface RepositoryContextValue {
  repository: UseRepositoryReturn;
  /**
   * リポジトリ一覧（HomeView / RepositorySwitcher）からのクリック時の切り替え。
   * WorktreeTabs はクリック時に setLastWorktreeForParent を先に呼ぶため、
   * ラッパー経由でも結果が変わらないことを担保している。
   */
  switchRepositoryFromList: (path: string) => void;
}

const RepositoryContext = createContext<RepositoryContextValue | null>(null);

/**
 * リポジトリ管理（useRepository）と一覧クリック時の切り替えを提供する Provider。
 */
export function RepositoryProvider({ children }: { children: ReactNode }) {
  const { socket } = useSocketContext();

  // URLからリポジトリを取得
  const urlParams = new URLSearchParams(window.location.search);
  const initialRepo = urlParams.get('repo') || '';

  // リポジトリ管理
  const repository = useRepository(socket, initialRepo);

  // リポジトリ一覧（HomeView / RepositorySwitcher）からのクリック時の切り替え
  const switchRepositoryFromList = useRepositorySwitchFromList(
    socket,
    repository.switchRepository
  );

  return (
    <RepositoryContext.Provider value={{ repository, switchRepositoryFromList }}>
      {children}
    </RepositoryContext.Provider>
  );
}

export function useRepositoryContext(): RepositoryContextValue {
  const ctx = useContext(RepositoryContext);
  if (!ctx) {
    throw new Error(
      'useRepositoryContext must be used within RepositoryProvider'
    );
  }
  return ctx;
}
