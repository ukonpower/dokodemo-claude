import { useState, useEffect, useCallback, useRef } from 'react';
import { Socket } from 'socket.io-client';
import type {
  GitGraphData,
  GitGraphCommitDetail,
  GitDiffDetail,
  ServerToClientEvents,
  ClientToServerEvents,
} from '../types';
import { repositoryIdMap } from '../utils/repository-id-map';

const INITIAL_MAX_COMMITS = 300;
const LOAD_MORE_STEP = 300;

/**
 * useGitGraph フックの戻り値
 */
export interface UseGitGraphReturn {
  // グラフ状態
  graph: GitGraphData | null;
  loading: boolean;
  error: string | null;

  // ビュー状態
  isActive: boolean;
  maxCommits: number;
  selectedBranch: string | null; // null = Show All

  // コミット詳細（行展開用）
  detailByHash: Record<string, GitGraphCommitDetail>;
  detailLoadingHash: string | null;

  // ファイル diff（オーバーレイ用）
  fileDiff: GitDiffDetail | null;
  fileDiffLoading: boolean;
  fileDiffHash: string | null;

  // アクション
  openGraphView: () => void;
  handleBack: () => void;
  // popstate 用: URL に合わせて isActive のみを更新（pushState しない）
  syncActive: (active: boolean) => void;
  refresh: () => void;
  loadMore: () => void;
  setBranch: (name: string | null) => void;
  requestCommitDetail: (hash: string) => void;
  requestFileDiff: (
    hash: string,
    filename: string,
    oldFilename?: string
  ) => void;
  closeFileDiff: () => void;
  clearState: () => void;
}

/**
 * Git Graph（コミットグラフ）表示を管理するカスタムフック
 * useGitDiff の構造（rid 一致ガード・URL 初期化・pushState）を踏襲する
 */
export function useGitGraph(
  socket: Socket<ServerToClientEvents, ClientToServerEvents> | null,
  currentRepo: string
): UseGitGraphReturn {
  const [graph, setGraph] = useState<GitGraphData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [isActive, setIsActive] = useState<boolean>(() => {
    const urlParams = new URLSearchParams(window.location.search);
    return urlParams.get('view') === 'graph';
  });
  const [maxCommits, setMaxCommits] = useState(INITIAL_MAX_COMMITS);
  const [selectedBranch, setSelectedBranch] = useState<string | null>(null);

  const [detailByHash, setDetailByHash] = useState<
    Record<string, GitGraphCommitDetail>
  >({});
  const [detailLoadingHash, setDetailLoadingHash] = useState<string | null>(
    null
  );

  const [fileDiff, setFileDiff] = useState<GitDiffDetail | null>(null);
  const [fileDiffLoading, setFileDiffLoading] = useState(false);
  const [fileDiffHash, setFileDiffHash] = useState<string | null>(null);

  const currentRepoRef = useRef(currentRepo);
  useEffect(() => {
    currentRepoRef.current = currentRepo;
  }, [currentRepo]);

  // グラフ要求（rid 解決してから emit）
  const requestGraph = useCallback(
    (branches: string | null, max: number) => {
      if (!socket || !currentRepo) return;
      const rid = repositoryIdMap.getRid(currentRepo);
      if (!rid) return;
      setLoading(true);
      setError(null);
      socket.emit('get-git-graph', {
        rid,
        branches: branches === null ? null : [branches],
        maxCommits: max,
      });
    },
    [socket, currentRepo]
  );

  // Socket イベントリスナー
  useEffect(() => {
    if (!socket) return;

    const handleGraph = (
      data: Parameters<ServerToClientEvents['git-graph']>[0]
    ) => {
      const currentRid = repositoryIdMap.getRid(currentRepoRef.current);
      if (data.rid === currentRid) {
        setGraph(data.graph);
        setLoading(false);
        setError(null);
      }
    };

    const handleCommitDetail = (
      data: Parameters<ServerToClientEvents['git-graph-commit-detail']>[0]
    ) => {
      const currentRid = repositoryIdMap.getRid(currentRepoRef.current);
      if (data.rid === currentRid) {
        setDetailByHash((prev) => ({ ...prev, [data.hash]: data.detail }));
        setDetailLoadingHash((h) => (h === data.hash ? null : h));
      }
    };

    const handleFileDiff = (
      data: Parameters<ServerToClientEvents['git-graph-file-diff']>[0]
    ) => {
      const currentRid = repositoryIdMap.getRid(currentRepoRef.current);
      if (data.rid === currentRid) {
        setFileDiff(data.detail);
        setFileDiffLoading(false);
      }
    };

    const handleError = (
      data: Parameters<ServerToClientEvents['git-graph-error']>[0]
    ) => {
      const currentRid = repositoryIdMap.getRid(currentRepoRef.current);
      if (data.rid === currentRid) {
        setLoading(false);
        setDetailLoadingHash(null);
        setFileDiffLoading(false);
        setError(data.message);
      }
    };

    socket.on('git-graph', handleGraph);
    socket.on('git-graph-commit-detail', handleCommitDetail);
    socket.on('git-graph-file-diff', handleFileDiff);
    socket.on('git-graph-error', handleError);

    return () => {
      socket.off('git-graph', handleGraph);
      socket.off('git-graph-commit-detail', handleCommitDetail);
      socket.off('git-graph-file-diff', handleFileDiff);
      socket.off('git-graph-error', handleError);
    };
  }, [socket]);

  // isActive かつ socket 接続時にグラフを要求（maxCommits / selectedBranch 変化でも再要求）
  useEffect(() => {
    if (!isActive || !socket || !currentRepo) return;
    requestGraph(selectedBranch, maxCommits);
  }, [isActive, socket, currentRepo, selectedBranch, maxCommits, requestGraph]);

  // リポジトリ切り替え時は詳細・diff・データをリセット
  useEffect(() => {
    setGraph(null);
    setDetailByHash({});
    setDetailLoadingHash(null);
    setFileDiff(null);
    setFileDiffHash(null);
    setMaxCommits(INITIAL_MAX_COMMITS);
    setSelectedBranch(null);
  }, [currentRepo]);

  const openGraphView = useCallback(() => {
    setIsActive(true);
    const urlParams = new URLSearchParams(window.location.search);
    urlParams.set('view', 'graph');
    const newUrl = `${window.location.pathname}?${urlParams.toString()}`;
    window.history.pushState({}, '', newUrl);
  }, []);

  const handleBack = useCallback(() => {
    setIsActive(false);
    setFileDiff(null);
    setFileDiffHash(null);
    const urlParams = new URLSearchParams(window.location.search);
    urlParams.delete('view');
    const newUrl = urlParams.toString()
      ? `${window.location.pathname}?${urlParams.toString()}`
      : window.location.pathname;
    window.history.pushState({}, '', newUrl);
  }, []);

  const syncActive = useCallback((active: boolean) => {
    setIsActive(active);
    if (!active) {
      setFileDiff(null);
      setFileDiffHash(null);
    }
  }, []);

  const refresh = useCallback(() => {
    setDetailByHash({});
    requestGraph(selectedBranch, maxCommits);
  }, [requestGraph, selectedBranch, maxCommits]);

  const loadMore = useCallback(() => {
    setMaxCommits((m) => m + LOAD_MORE_STEP);
  }, []);

  const setBranch = useCallback((name: string | null) => {
    setSelectedBranch(name);
    setMaxCommits(INITIAL_MAX_COMMITS);
    setDetailByHash({});
  }, []);

  const requestCommitDetail = useCallback(
    (hash: string) => {
      if (!socket || !currentRepo) return;
      const rid = repositoryIdMap.getRid(currentRepo);
      if (!rid) return;
      if (detailByHash[hash]) return; // 取得済みは再要求しない
      setDetailLoadingHash(hash);
      socket.emit('get-git-graph-commit-detail', { rid, hash });
    },
    [socket, currentRepo, detailByHash]
  );

  const requestFileDiff = useCallback(
    (hash: string, filename: string, oldFilename?: string) => {
      if (!socket || !currentRepo) return;
      const rid = repositoryIdMap.getRid(currentRepo);
      if (!rid) return;
      setFileDiff(null);
      setFileDiffHash(hash);
      setFileDiffLoading(true);
      socket.emit('get-git-graph-file-diff', {
        rid,
        hash,
        filename,
        oldFilename,
      });
    },
    [socket, currentRepo]
  );

  const closeFileDiff = useCallback(() => {
    setFileDiff(null);
    setFileDiffHash(null);
    setFileDiffLoading(false);
  }, []);

  const clearState = useCallback(() => {
    setIsActive(false);
    setGraph(null);
    setLoading(false);
    setError(null);
    setDetailByHash({});
    setDetailLoadingHash(null);
    setFileDiff(null);
    setFileDiffHash(null);
    setMaxCommits(INITIAL_MAX_COMMITS);
    setSelectedBranch(null);
  }, []);

  return {
    graph,
    loading,
    error,
    isActive,
    maxCommits,
    selectedBranch,
    detailByHash,
    detailLoadingHash,
    fileDiff,
    fileDiffLoading,
    fileDiffHash,
    openGraphView,
    handleBack,
    syncActive,
    refresh,
    loadMore,
    setBranch,
    requestCommitDetail,
    requestFileDiff,
    closeFileDiff,
    clearState,
  };
}
