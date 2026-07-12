import { useCallback, useEffect, useRef, useState } from 'react';
import type { UseRepositoryReturn } from './useRepository';
import type { UseGitDiffReturn } from './useGitDiff';
import type { UseFileViewerReturn } from './useFileViewer';
import type { UseGitGraphReturn } from './useGitGraph';

/**
 * localStorage に保存するダッシュボードモードのキーを生成する
 */
const viewModeStorageKey = (repo: string) => `dokodemo-view-mode-${repo}`;

export interface UseViewRoutingOptions {
  initialRepo: string;
  initialViewFromUrl: string | null;
  repository: UseRepositoryReturn;
  gitDiff: UseGitDiffReturn;
  fileViewer: UseFileViewerReturn;
  gitGraph: UseGitGraphReturn;
}

export interface UseViewRoutingReturn {
  dashboardMode: boolean;
  setDashboardModeAndPersist: (next: boolean) => void;
}

/**
 * ダッシュボードビューモードの管理と、ブラウザの戻る/進むボタン（popstate）対応を
 * まとめて扱うカスタムフック。popstate が dashboardMode を書き換えるため
 * 「どのビューを表示するか」という同一責務として1フックに集約している。
 */
export function useViewRouting(
  options: UseViewRoutingOptions
): UseViewRoutingReturn {
  const { initialRepo, initialViewFromUrl, repository, gitDiff, fileViewer, gitGraph } =
    options;

  // ダッシュボードビューモードの状態管理
  // URL に ?view=dashboard が付いていれば最優先で有効化、無ければ localStorage
  // から前回の状態を復元する。ファイルビュワー (?view=files) や diff が
  // アクティブなら下流の条件分岐で隠れるため、ここでは購読範囲のみ管理する。
  const [dashboardMode, setDashboardMode] = useState<boolean>(() => {
    if (initialViewFromUrl === 'dashboard') return true;
    if (!initialRepo) return false;
    try {
      return localStorage.getItem(viewModeStorageKey(initialRepo)) === 'dashboard';
    } catch {
      return false;
    }
  });

  // currentRepoの参照
  const currentRepoRef = useRef(repository.currentRepo);
  useEffect(() => {
    currentRepoRef.current = repository.currentRepo;
  }, [repository.currentRepo]);

  // ブラウザの戻る/進むボタン対応
  useEffect(() => {
    const handlePopState = () => {
      const urlParams = new URLSearchParams(window.location.search);
      const repoFromUrl = urlParams.get('repo') || '';
      const viewFromUrl = urlParams.get('view');
      const fileFromUrl = urlParams.get('file') || '';

      // リポジトリが変化していれば切り替え（URL は既にブラウザ側で更新済み）
      if (repoFromUrl !== currentRepoRef.current) {
        repository.switchRepository(repoFromUrl, { skipPushState: true });
        return;
      }

      if (viewFromUrl === 'graph') {
        setDashboardMode(false);
        gitDiff.handleDiffViewBack();
        fileViewer.clearState();
        gitGraph.syncActive(true);
        return;
      }

      // graph 以外へ遷移する場合は graph ビューを閉じる
      gitGraph.syncActive(false);

      if (viewFromUrl === 'files') {
        // ファイルビュワーのpopstate対応はフック内で状態管理
        setDashboardMode(false);
      } else if (viewFromUrl === 'diff' && fileFromUrl) {
        setDashboardMode(false);
        gitDiff.handleDiffFileClick(fileFromUrl);
      } else if (viewFromUrl === 'dashboard') {
        setDashboardMode(true);
        gitDiff.handleDiffViewBack();
        fileViewer.clearState();
      } else {
        setDashboardMode(false);
        gitDiff.handleDiffViewBack();
        fileViewer.clearState();
      }
    };

    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, [repository, gitDiff, fileViewer, gitGraph]);

  // リポジトリ切り替え時にダッシュボードモードを localStorage から復元
  useEffect(() => {
    if (!repository.currentRepo) return;
    try {
      const saved = localStorage.getItem(viewModeStorageKey(repository.currentRepo));
      setDashboardMode(saved === 'dashboard');
    } catch {
      /* noop */
    }
  }, [repository.currentRepo]);

  // ダッシュボードモード切替（URL と localStorage に反映）
  const setDashboardModeAndPersist = useCallback((next: boolean) => {
    setDashboardMode(next);
    const repo = currentRepoRef.current;
    if (repo) {
      try {
        localStorage.setItem(
          viewModeStorageKey(repo),
          next ? 'dashboard' : 'project'
        );
      } catch {
        /* noop */
      }
    }
    // URL も同期（リポジトリ切替で消えるので個別管理）
    const url = new URL(window.location.href);
    if (next) {
      url.searchParams.set('view', 'dashboard');
    } else {
      if (url.searchParams.get('view') === 'dashboard') {
        url.searchParams.delete('view');
      }
    }
    window.history.pushState({}, '', url.toString());
  }, []);

  return { dashboardMode, setDashboardModeAndPersist };
}
