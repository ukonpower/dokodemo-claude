import { useCallback, useEffect, useRef, useState } from 'react';
import type { UseRepositoryReturn } from '@/features/repo/hooks/useRepository';
import type { UseGitDiffReturn } from '@/features/git/hooks/useGitDiff';
import type { UseFileViewerReturn } from '@/features/files/hooks/useFileViewer';
import type { UseGitGraphReturn } from '@/features/git/hooks/useGitGraph';

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
  settingsMode: boolean;
  openSettings: () => void;
  closeSettings: () => void;
  projectSettingsMode: boolean;
  openProjectSettings: () => void;
  closeProjectSettings: () => void;
  reviewInboxMode: boolean;
  openReviewInbox: () => void;
  closeReviewInbox: () => void;
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

  // 設定ページの表示状態（URL に ?view=settings が付いていれば初期表示）
  // ダッシュボードと違い永続化はしない（設定は一時的な遷移先のため）
  const [settingsMode, setSettingsMode] = useState<boolean>(
    () => initialViewFromUrl === 'settings'
  );

  // プロジェクト設定ページの表示状態（?view=project-settings）。
  // アプリ設定と同じく一時的な遷移先なので永続化はしない
  const [projectSettingsMode, setProjectSettingsMode] = useState<boolean>(
    () => initialViewFromUrl === 'project-settings'
  );

  // 評価リクエスト受信箱の表示状態（?view=review）。一時的な遷移先なので永続化しない
  const [reviewInboxMode, setReviewInboxMode] = useState<boolean>(
    () => initialViewFromUrl === 'review'
  );

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

      if (viewFromUrl === 'settings') {
        setSettingsMode(true);
        setProjectSettingsMode(false);
        setReviewInboxMode(false);
        return;
      }

      if (viewFromUrl === 'project-settings') {
        setSettingsMode(false);
        setProjectSettingsMode(true);
        setReviewInboxMode(false);
        return;
      }

      if (viewFromUrl === 'review') {
        setSettingsMode(false);
        setProjectSettingsMode(false);
        setReviewInboxMode(true);
        return;
      }

      // settings 系・受信箱以外へ遷移する場合はそれらを閉じる
      setSettingsMode(false);
      setProjectSettingsMode(false);
      setReviewInboxMode(false);

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

  // 設定ページを開く（URL に ?view=settings を積む）
  const openSettings = useCallback(() => {
    setSettingsMode(true);
    setProjectSettingsMode(false);
    const url = new URL(window.location.href);
    url.searchParams.set('view', 'settings');
    window.history.pushState({}, '', url.toString());
  }, []);

  // 設定ページを閉じて元のビューへ戻る
  // （ダッシュボード表示中だった場合は ?view=dashboard を復元する）
  const closeSettings = useCallback(() => {
    setSettingsMode(false);
    const url = new URL(window.location.href);
    if (dashboardMode) {
      url.searchParams.set('view', 'dashboard');
    } else if (url.searchParams.get('view') === 'settings') {
      url.searchParams.delete('view');
    }
    window.history.pushState({}, '', url.toString());
  }, [dashboardMode]);

  // プロジェクト設定ページを開く（URL に ?view=project-settings を積む）
  const openProjectSettings = useCallback(() => {
    setProjectSettingsMode(true);
    const url = new URL(window.location.href);
    url.searchParams.set('view', 'project-settings');
    window.history.pushState({}, '', url.toString());
  }, []);

  // プロジェクト設定ページを閉じて元のビューへ戻る
  const closeProjectSettings = useCallback(() => {
    setProjectSettingsMode(false);
    const url = new URL(window.location.href);
    if (dashboardMode) {
      url.searchParams.set('view', 'dashboard');
    } else if (url.searchParams.get('view') === 'project-settings') {
      url.searchParams.delete('view');
    }
    window.history.pushState({}, '', url.toString());
  }, [dashboardMode]);

  // 評価リクエスト受信箱を開く（URL に ?view=review を積む）
  const openReviewInbox = useCallback(() => {
    setReviewInboxMode(true);
    const url = new URL(window.location.href);
    url.searchParams.set('view', 'review');
    window.history.pushState({}, '', url.toString());
  }, []);

  // 受信箱を閉じて元のビューへ戻る
  const closeReviewInbox = useCallback(() => {
    setReviewInboxMode(false);
    const url = new URL(window.location.href);
    if (dashboardMode) {
      url.searchParams.set('view', 'dashboard');
    } else if (url.searchParams.get('view') === 'review') {
      url.searchParams.delete('view');
    }
    window.history.pushState({}, '', url.toString());
  }, [dashboardMode]);

  return {
    dashboardMode,
    setDashboardModeAndPersist,
    settingsMode,
    openSettings,
    closeSettings,
    projectSettingsMode,
    openProjectSettings,
    closeProjectSettings,
    reviewInboxMode,
    openReviewInbox,
    closeReviewInbox,
  };
}
