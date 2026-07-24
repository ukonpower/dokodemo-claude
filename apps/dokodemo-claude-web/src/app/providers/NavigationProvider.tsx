import { createContext, useContext, type ReactNode } from 'react';
import {
  useViewRouting,
  type UseViewRoutingReturn,
} from '@/app/hooks/useViewRouting';
import { useRepositoryContext } from '@/features/repo/providers/RepositoryProvider';
import {
  useGitDiffContext,
  useGitGraphContext,
} from '@/features/git/providers/GitProvider';
import { useFileViewerContext } from '@/features/files/providers/FilesProvider';

const NavigationContext = createContext<UseViewRoutingReturn | null>(null);

/**
 * ビュールーティング（useViewRouting）の戻り値を提供する Provider。
 * useViewRouting は repository / gitDiff / fileViewer / gitGraph を引数に取るため、
 * AppProviders の内側（AppContent 直上）に置き、各 context から値を集めて渡す。
 */
export function NavigationProvider({ children }: { children: ReactNode }) {
  const { repository } = useRepositoryContext();
  const gitDiff = useGitDiffContext();
  const gitGraph = useGitGraphContext();
  const fileViewer = useFileViewerContext();

  // URLからリポジトリ・初期ビューを取得
  const urlParams = new URLSearchParams(window.location.search);
  const initialRepo = urlParams.get('repo') || '';
  const initialViewFromUrl = urlParams.get('view');

  // ビュールーティング（dashboardMode / settingsMode の管理 + popstate 対応）
  const viewRouting = useViewRouting({
    initialRepo,
    initialViewFromUrl,
    repository,
    gitDiff,
    fileViewer,
    gitGraph,
  });

  return (
    <NavigationContext.Provider value={viewRouting}>
      {children}
    </NavigationContext.Provider>
  );
}

export function useNavigationContext(): UseViewRoutingReturn {
  const ctx = useContext(NavigationContext);
  if (!ctx) {
    throw new Error(
      'useNavigationContext must be used within NavigationProvider'
    );
  }
  return ctx;
}
