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
  fileDiffFilename: string;

  // checkout / merge アクション
  actionInProgress: boolean;
  checkout: (
    kind: 'branch' | 'remote' | 'commit',
    name: string,
    localName?: string
  ) => void;
  merge: (
    target: string,
    opts: { noFF: boolean; squash: boolean; noCommit: boolean }
  ) => void;
  pull: () => void;
  push: (opts?: { remote?: string; force?: boolean; setUpstream?: boolean }) => void;
  fetch: (opts?: { prune?: boolean }) => void;
  // push 先選択用の remote 一覧と、その取得要求
  remotes: string[];
  requestRemotes: () => void;

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
  refreshFileDiff: () => void;
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

  const [actionInProgress, setActionInProgress] = useState(false);

  // push 先選択用の remote 一覧（グラフ未表示でも requestRemotes で取得できる）
  const [remotes, setRemotes] = useState<string[]>([]);

  const [fileDiff, setFileDiff] = useState<GitDiffDetail | null>(null);
  const [fileDiffLoading, setFileDiffLoading] = useState(false);
  const [fileDiffHash, setFileDiffHash] = useState<string | null>(null);
  const [fileDiffFilename, setFileDiffFilename] = useState('');
  const [fileDiffOldFilename, setFileDiffOldFilename] = useState<
    string | undefined
  >(undefined);

  const currentRepoRef = useRef(currentRepo);
  useEffect(() => {
    currentRepoRef.current = currentRepo;
  }, [currentRepo]);

  // id-mapping 到着時の再要求用（初回ロード時は rid 未解決で要求できないため）
  const isActiveRef = useRef(isActive);
  useEffect(() => {
    isActiveRef.current = isActive;
  }, [isActive]);
  const graphRef = useRef(graph);
  useEffect(() => {
    graphRef.current = graph;
  }, [graph]);
  const selectedBranchRef = useRef(selectedBranch);
  useEffect(() => {
    selectedBranchRef.current = selectedBranch;
  }, [selectedBranch]);
  const maxCommitsRef = useRef(maxCommits);
  useEffect(() => {
    maxCommitsRef.current = maxCommits;
  }, [maxCommits]);

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
        setRemotes(data.graph.remotes);
        setLoading(false);
        setError(null);
      }
    };

    const handleRemotesResult = (
      data: Parameters<ServerToClientEvents['git-graph-remotes-result']>[0]
    ) => {
      const currentRid = repositoryIdMap.getRid(currentRepoRef.current);
      if (data.rid === currentRid) {
        setRemotes(data.remotes);
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

    // checkout / merge の結果。成功時はグラフを再取得して反映する
    const handleActionResult = (
      data: Parameters<ServerToClientEvents['git-graph-action-result']>[0]
    ) => {
      const currentRid = repositoryIdMap.getRid(currentRepoRef.current);
      if (data.rid !== currentRid || !currentRid) return;
      setActionInProgress(false);
      if (data.success) {
        setError(null);
        setDetailByHash({});
        setLoading(true);
        socket.emit('get-git-graph', {
          rid: currentRid,
          branches:
            selectedBranchRef.current === null
              ? null
              : [selectedBranchRef.current],
          maxCommits: maxCommitsRef.current,
        });
      } else {
        setError(data.message);
      }
    };

    // IDマッピング受信時、グラフ表示中で未取得なら要求する
    // （?view=graph 直リンク/リロード時は初回要求時点で rid が未解決のため）
    const handleIdMapping = (
      data: Parameters<ServerToClientEvents['id-mapping']>[0]
    ) => {
      // 自身でマップを更新してから読み込む（他ハンドラとの順序に依存しない）
      repositoryIdMap.update(data);

      if (!isActiveRef.current || !currentRepoRef.current) return;
      if (graphRef.current) return;
      const rid = repositoryIdMap.getRid(currentRepoRef.current);
      if (!rid) return;
      setLoading(true);
      setError(null);
      socket.emit('get-git-graph', {
        rid,
        branches:
          selectedBranchRef.current === null
            ? null
            : [selectedBranchRef.current],
        maxCommits: maxCommitsRef.current,
      });
    };

    socket.on('git-graph', handleGraph);
    socket.on('git-graph-remotes-result', handleRemotesResult);
    socket.on('git-graph-commit-detail', handleCommitDetail);
    socket.on('git-graph-file-diff', handleFileDiff);
    socket.on('git-graph-error', handleError);
    socket.on('git-graph-action-result', handleActionResult);
    socket.on('id-mapping', handleIdMapping);
    socket.on('id-mapping-updated', handleIdMapping);

    return () => {
      socket.off('git-graph', handleGraph);
      socket.off('git-graph-remotes-result', handleRemotesResult);
      socket.off('git-graph-commit-detail', handleCommitDetail);
      socket.off('git-graph-file-diff', handleFileDiff);
      socket.off('git-graph-error', handleError);
      socket.off('git-graph-action-result', handleActionResult);
      socket.off('id-mapping', handleIdMapping);
      socket.off('id-mapping-updated', handleIdMapping);
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

  // グラフビューを別ブラウザタブで開く（元タブは現在のビューのまま維持する）
  const openGraphView = useCallback(() => {
    // 統合コード/git ブラウザをグラフモードで別ブラウザタブに開く
    const urlParams = new URLSearchParams(window.location.search);
    urlParams.set('view', 'files');
    urlParams.set('mode', 'graph');
    urlParams.delete('file');
    urlParams.delete('fullscreen');
    const url = `${window.location.pathname}?${urlParams.toString()}`;
    window.open(url, '_blank');
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
      // 未コミット変更は作業ツリーが変わり得るので毎回再要求する
      if (hash !== '*' && detailByHash[hash]) return;
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
      setFileDiffFilename(filename);
      setFileDiffOldFilename(oldFilename);
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

  const refreshFileDiff = useCallback(() => {
    if (!socket || !currentRepo || !fileDiffHash || !fileDiffFilename) return;
    const rid = repositoryIdMap.getRid(currentRepo);
    if (!rid) return;
    setFileDiffLoading(true);
    socket.emit('get-git-graph-file-diff', {
      rid,
      hash: fileDiffHash,
      filename: fileDiffFilename,
      oldFilename: fileDiffOldFilename,
    });
  }, [socket, currentRepo, fileDiffHash, fileDiffFilename, fileDiffOldFilename]);

  const closeFileDiff = useCallback(() => {
    setFileDiff(null);
    setFileDiffHash(null);
    setFileDiffFilename('');
    setFileDiffOldFilename(undefined);
    setFileDiffLoading(false);
  }, []);

  const checkout = useCallback(
    (kind: 'branch' | 'remote' | 'commit', name: string, localName?: string) => {
      if (!socket || !currentRepo) return;
      const rid = repositoryIdMap.getRid(currentRepo);
      if (!rid) return;
      setActionInProgress(true);
      setError(null);
      socket.emit('git-graph-checkout', { rid, kind, name, localName });
    },
    [socket, currentRepo]
  );

  const merge = useCallback(
    (
      target: string,
      opts: { noFF: boolean; squash: boolean; noCommit: boolean }
    ) => {
      if (!socket || !currentRepo) return;
      const rid = repositoryIdMap.getRid(currentRepo);
      if (!rid) return;
      setActionInProgress(true);
      setError(null);
      socket.emit('git-graph-merge', { rid, target, ...opts });
    },
    [socket, currentRepo]
  );

  const pull = useCallback(() => {
    if (!socket || !currentRepo) return;
    const rid = repositoryIdMap.getRid(currentRepo);
    if (!rid) return;
    setActionInProgress(true);
    setError(null);
    socket.emit('git-graph-pull', { rid });
  }, [socket, currentRepo]);

  const push = useCallback(
    (opts?: { remote?: string; force?: boolean; setUpstream?: boolean }) => {
      if (!socket || !currentRepo) return;
      const rid = repositoryIdMap.getRid(currentRepo);
      if (!rid) return;
      setActionInProgress(true);
      setError(null);
      socket.emit('git-graph-push', { rid, ...(opts ?? {}) });
    },
    [socket, currentRepo]
  );

  const fetchRemote = useCallback(
    (opts?: { prune?: boolean }) => {
      if (!socket || !currentRepo) return;
      const rid = repositoryIdMap.getRid(currentRepo);
      if (!rid) return;
      setActionInProgress(true);
      setError(null);
      socket.emit('git-graph-fetch', { rid, ...(opts ?? {}) });
    },
    [socket, currentRepo]
  );

  const requestRemotes = useCallback(() => {
    if (!socket || !currentRepo) return;
    const rid = repositoryIdMap.getRid(currentRepo);
    if (!rid) return;
    socket.emit('git-graph-remotes', { rid });
  }, [socket, currentRepo]);

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
    setActionInProgress(false);
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
    fileDiffFilename,
    actionInProgress,
    checkout,
    merge,
    pull,
    push,
    fetch: fetchRemote,
    remotes,
    requestRemotes,
    openGraphView,
    handleBack,
    syncActive,
    refresh,
    loadMore,
    setBranch,
    requestCommitDetail,
    requestFileDiff,
    refreshFileDiff,
    closeFileDiff,
    clearState,
  };
}
