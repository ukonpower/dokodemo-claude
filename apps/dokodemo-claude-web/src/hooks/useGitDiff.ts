import { useState, useEffect, useCallback, useRef } from 'react';
import { Socket } from 'socket.io-client';
import type {
  GitDiffSummary,
  GitDiffDetail,
  ServerToClientEvents,
  ClientToServerEvents,
} from '../types';
import { repositoryIdMap } from '../utils/repository-id-map';

/**
 * useGitDiff フックの戻り値
 */
export interface UseGitDiffReturn {
  // サマリー状態
  diffSummary: GitDiffSummary | null;
  diffSummaryLoading: boolean;
  diffSummaryError: string | null;

  // 詳細状態
  diffDetail: GitDiffDetail | null;
  diffDetailLoading: boolean;
  diffDetailError: string | null;

  // ビュー状態
  currentView: 'main' | 'diff';
  diffViewFilename: string;

  // アクション
  refreshDiffSummary: () => void;
  refreshDiffDetail: () => void;
  handleDiffFileClick: (filename: string) => void;
  handleDiffViewBack: () => void;

  // 内部セッター
  setDiffDetail: (detail: GitDiffDetail | null) => void;

  // クリア関数（リポジトリ切り替え時用）
  clearState: () => void;
}

/**
 * Git差分表示を管理するカスタムフック
 */
export function useGitDiff(
  socket: Socket<ServerToClientEvents, ClientToServerEvents> | null,
  currentRepo: string
): UseGitDiffReturn {
  // サマリー状態
  const [diffSummary, setDiffSummary] = useState<GitDiffSummary | null>(null);
  const [diffSummaryLoading, setDiffSummaryLoading] = useState(false);
  const [diffSummaryError, setDiffSummaryError] = useState<string | null>(null);

  // 詳細状態
  const [diffDetail, setDiffDetail] = useState<GitDiffDetail | null>(null);
  const [diffDetailLoading, setDiffDetailLoading] = useState(false);
  const [diffDetailError, setDiffDetailError] = useState<string | null>(null);

  // ビュー状態
  const [currentView, setCurrentView] = useState<'main' | 'diff'>(() => {
    const urlParams = new URLSearchParams(window.location.search);
    return urlParams.get('view') === 'diff' ? 'diff' : 'main';
  });
  const [diffViewFilename, setDiffViewFilename] = useState<string>(() => {
    const urlParams = new URLSearchParams(window.location.search);
    return urlParams.get('file') || '';
  });

  // Ref
  const currentRepoRef = useRef(currentRepo);
  const diffViewFilenameRef = useRef(diffViewFilename);

  useEffect(() => {
    currentRepoRef.current = currentRepo;
  }, [currentRepo]);
  useEffect(() => {
    diffViewFilenameRef.current = diffViewFilename;
  }, [diffViewFilename]);

  // Socketイベントリスナー
  useEffect(() => {
    if (!socket) return;

    // Git差分サマリー
    const handleGitDiffSummary = (
      data: Parameters<ServerToClientEvents['git-diff-summary']>[0]
    ) => {
      const currentRid = repositoryIdMap.getRid(currentRepoRef.current);
      if (data.rid === currentRid) {
        setDiffSummary(data.summary);
        setDiffSummaryLoading(false);
        setDiffSummaryError(null);
      }
    };

    // Git差分詳細
    const handleGitDiffDetail = (
      data: Parameters<ServerToClientEvents['git-diff-detail']>[0]
    ) => {
      const currentRid = repositoryIdMap.getRid(currentRepoRef.current);
      if (data.rid === currentRid) {
        setDiffDetail(data.detail);
        setDiffDetailLoading(false);
        setDiffDetailError(null);
      }
    };

    // Git差分エラー
    const handleGitDiffError = (
      data: Parameters<ServerToClientEvents['git-diff-error']>[0]
    ) => {
      const currentRid = repositoryIdMap.getRid(currentRepoRef.current);
      if (data.rid === currentRid) {
        setDiffSummaryLoading(false);
        setDiffDetailLoading(false);
        setDiffSummaryError(data.message);
        setDiffDetailError(data.message);
      }
    };

    socket.on('git-diff-summary', handleGitDiffSummary);
    socket.on('git-diff-detail', handleGitDiffDetail);
    socket.on('git-diff-error', handleGitDiffError);

    return () => {
      socket.off('git-diff-summary', handleGitDiffSummary);
      socket.off('git-diff-detail', handleGitDiffDetail);
      socket.off('git-diff-error', handleGitDiffError);
    };
  }, [socket]);

  // アクション関数
  const refreshDiffSummary = useCallback(() => {
    if (socket && currentRepo) {
      const rid = repositoryIdMap.getRid(currentRepo);
      if (!rid) return;
      setDiffSummaryLoading(true);
      setDiffSummaryError(null);
      socket.emit('get-git-diff-summary', { rid });
    }
  }, [socket, currentRepo]);

  const refreshDiffDetail = useCallback(() => {
    if (socket && currentRepo && diffViewFilenameRef.current) {
      const rid = repositoryIdMap.getRid(currentRepo);
      if (!rid) return;
      setDiffDetailLoading(true);
      setDiffDetailError(null);
      socket.emit('get-git-diff-detail', {
        rid,
        filename: diffViewFilenameRef.current,
      });
    }
  }, [socket, currentRepo]);

  const handleDiffFileClick = useCallback((filename: string) => {
    setDiffViewFilename(filename);
    setDiffDetail(null);
    setCurrentView('diff');
    // URLを更新
    const urlParams = new URLSearchParams(window.location.search);
    urlParams.set('view', 'diff');
    urlParams.set('file', filename);
    const newUrl = `${window.location.pathname}?${urlParams.toString()}`;
    window.history.pushState({}, '', newUrl);
    // 差分を即座に取得
    if (socket && currentRepo) {
      const rid = repositoryIdMap.getRid(currentRepo);
      if (rid) {
        setDiffDetailLoading(true);
        setDiffDetailError(null);
        socket.emit('get-git-diff-detail', { rid, filename });
      }
    }
  }, [socket, currentRepo]);

  const handleDiffViewBack = useCallback(() => {
    setCurrentView('main');
    setDiffDetail(null);
    setDiffViewFilename('');
    // URLを更新
    const urlParams = new URLSearchParams(window.location.search);
    urlParams.delete('view');
    urlParams.delete('file');
    const newUrl = urlParams.toString()
      ? `${window.location.pathname}?${urlParams.toString()}`
      : window.location.pathname;
    window.history.pushState({}, '', newUrl);
  }, []);

  // 状態クリア
  const clearState = useCallback(() => {
    setDiffSummary(null);
    setDiffSummaryLoading(false);
    setDiffSummaryError(null);
    setDiffDetail(null);
    setDiffDetailLoading(false);
    setDiffDetailError(null);
    setCurrentView('main');
    setDiffViewFilename('');
  }, []);

  // リポジトリ切り替え時に状態をリセット
  useEffect(() => {
    clearState();
  }, [currentRepo, clearState]);

  return {
    diffSummary,
    diffSummaryLoading,
    diffSummaryError,
    diffDetail,
    diffDetailLoading,
    diffDetailError,
    currentView,
    diffViewFilename,
    refreshDiffSummary,
    refreshDiffDetail,
    handleDiffFileClick,
    handleDiffViewBack,
    setDiffDetail,
    clearState,
  };
}
