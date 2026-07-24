import { useMemo, useCallback, useState, useEffect, useRef } from 'react';
import { ArrowLeft, GitCompare, FolderTree, GitFork } from 'lucide-react';
import FileTree from '@/features/files/components/FileTree';
import FileContentViewer from '@/features/files/components/FileContentViewer';
import DiffSummary from '@/features/git/components/DiffSummary';
import GitGraphView from './GitGraphView';
import { repositoryIdMap } from '@/shared/utils/repository-id-map';
import { useRepositoryContext } from '@/features/repo/providers/RepositoryProvider';
import {
  useGitDiffContext,
  useGitGraphContext,
} from '@/features/git/providers/GitProvider';
import { useFileViewerContext } from '@/features/files/providers/FilesProvider';
import s from './CodeBrowserView.module.scss';

/** 左サイドバーの表示モード */
export type CodeBrowserMode = 'changes' | 'tree' | 'graph';

const MODE_STORAGE_KEY = (repo: string) => `dokodemo-codebrowser-mode-${repo}`;

const MODES: { id: CodeBrowserMode; label: string; icon: typeof GitCompare }[] = [
  { id: 'changes', label: '変更', icon: GitCompare },
  { id: 'tree', label: 'ツリー', icon: FolderTree },
  { id: 'graph', label: 'グラフ', icon: GitFork },
];

function readInitialMode(currentRepo: string): CodeBrowserMode {
  const params = new URLSearchParams(window.location.search);
  const fromUrl = params.get('mode');
  if (fromUrl === 'changes' || fromUrl === 'tree' || fromUrl === 'graph') {
    return fromUrl;
  }
  // mode 未指定でファイルが指定されていればツリー起点
  if (params.get('file')) return 'tree';
  try {
    const saved = localStorage.getItem(MODE_STORAGE_KEY(currentRepo));
    if (saved === 'changes' || saved === 'tree' || saved === 'graph') {
      return saved;
    }
  } catch {
    /* noop */
  }
  return 'changes';
}

/**
 * 統合コード/git ブラウザ（VSCode の diff タブに近い 2 ペイン）。
 * 左サイドバーで「変更ファイル / ファイルツリー / グラフ」を切り替え、
 * 右ペインに選択したファイルの内容・差分・コミット差分を共通表示する。
 * AI/ターミナルのプロジェクトビューとは別ブラウザタブで開く。
 */
export function CodeBrowserView() {
  const { repository } = useRepositoryContext();
  const fileViewer = useFileViewerContext();
  const gitDiff = useGitDiffContext();
  const gitGraph = useGitGraphContext();

  const { currentRepo } = repository;
  const rid = repositoryIdMap.getRid(currentRepo) || '';

  // リポジトリ表示名の導出（worktree の場合、グラフ側は「親リポ / ブランチ」で表示）
  const repoInfo = repository.repositories.find(
    (r) => r.path === currentRepo
  );
  const repoName = repoInfo?.name || '';
  const graphRepoName =
    repoInfo?.isWorktree &&
    repoInfo?.parentRepoName &&
    repoInfo?.worktreeBranch
      ? `${repoInfo.parentRepoName} / ${repoInfo.worktreeBranch}`
      : repoInfo?.name ||
        currentRepo.split('/').filter(Boolean).pop() ||
        '';

  const [mode, setMode] = useState<CodeBrowserMode>(() =>
    readInitialMode(currentRepo)
  );

  const isMobile = typeof window !== 'undefined' && window.innerWidth < 680;
  const showFileOnMobile = isMobile && fileViewer.selectedFilePath !== null;

  // グラフモードのときだけグラフデータを購読する
  const { syncActive } = gitGraph;
  useEffect(() => {
    syncActive(mode === 'graph');
    return () => syncActive(false);
  }, [mode, syncActive]);

  // モード切替（localStorage と URL に反映）
  const changeMode = useCallback(
    (next: CodeBrowserMode) => {
      setMode(next);
      try {
        localStorage.setItem(MODE_STORAGE_KEY(currentRepo), next);
      } catch {
        /* noop */
      }
      const url = new URL(window.location.href);
      url.searchParams.set('mode', next);
      window.history.replaceState({}, '', url.toString());
    },
    [currentRepo]
  );

  // ブラウザ戻る/進むで mode を URL に追従
  useEffect(() => {
    const handlePopState = () => {
      const p = new URLSearchParams(window.location.search).get('mode');
      if (p === 'changes' || p === 'tree' || p === 'graph') setMode(p);
    };
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  // Git変更ファイルのマップ（ステータス参照用）
  const gitChangedFiles = useMemo(() => {
    if (!gitDiff.diffSummary?.files?.length) return undefined;
    const map = new Map<string, string>();
    for (const file of gitDiff.diffSummary.files) {
      map.set(file.filename, file.status);
    }
    return map;
  }, [gitDiff.diffSummary]);

  const selectedFileGitStatus = useMemo(() => {
    if (!gitChangedFiles || !fileViewer.selectedFilePath) return undefined;
    return gitChangedFiles.get(fileViewer.selectedFilePath);
  }, [gitChangedFiles, fileViewer.selectedFilePath]);

  // 削除ファイルもツリーに載せる（FileViewerView と同じ補完）
  const directoryCacheWithDeleted = useMemo(() => {
    const files = gitDiff.diffSummary?.files;
    if (!files?.length) return fileViewer.directoryCache;
    const deletedFiles = files.filter((f) => f.status === 'D');
    if (deletedFiles.length === 0) return fileViewer.directoryCache;

    const cache = new Map(fileViewer.directoryCache);
    for (const file of deletedFiles) {
      const parts = file.filename.split('/');
      const fileName = parts[parts.length - 1];
      const dirPath = parts.length > 1 ? parts.slice(0, -1).join('/') : '';
      const dirEntries = cache.get(dirPath);
      if (dirEntries && !dirEntries.some((e) => e.path === file.filename)) {
        cache.set(dirPath, [
          ...dirEntries,
          { name: fileName, path: file.filename, type: 'file' as const },
        ]);
      }
    }
    return cache;
  }, [fileViewer.directoryCache, gitDiff.diffSummary]);

  // ツリーからの選択（通常のファイル表示、変更ファイルなら差分も取得）
  const handleSelectFromTree = useCallback(
    (path: string) => {
      const status = gitChangedFiles?.get(path);
      fileViewer.selectFile(path, status, false);
    },
    [fileViewer, gitChangedFiles]
  );

  // 変更ファイル一覧からの選択（右ペインで差分モード起点で開く）
  const handleSelectFromChanges = useCallback(
    (path: string) => {
      const status = gitChangedFiles?.get(path);
      fileViewer.selectFile(path, status, true);
    },
    [fileViewer, gitChangedFiles]
  );

  // 別タブへの deep-link（?mode=changes&file=...）で開いたときだけ、初期ロードでは
  // 差分が取得されないため、その初期ファイルに限り一度だけ差分モードで開き直す。
  // 通常のクリック選択には干渉しない（初期URLのファイルのみ対象）。
  const initialFileRef = useRef(
    new URLSearchParams(window.location.search).get('file')
  );
  const reconciledRef = useRef(false);
  useEffect(() => {
    if (reconciledRef.current) return;
    const initialFile = initialFileRef.current;
    if (!initialFile) {
      reconciledRef.current = true;
      return;
    }
    if (mode !== 'changes') return;
    if (fileViewer.selectedFilePath !== initialFile || !gitChangedFiles) return;
    const status = gitChangedFiles.get(initialFile);
    reconciledRef.current = true;
    if (status && status !== 'D' && !fileViewer.diffDetail) {
      fileViewer.selectFile(initialFile, status, true);
    }
  }, [mode, fileViewer, gitChangedFiles]);

  const modeTabs = (
    <div className={s.modeTabs} role="tablist">
      {MODES.map(({ id, label, icon: Icon }) => (
        <button
          key={id}
          role="tab"
          aria-selected={mode === id}
          className={`${s.modeTab} ${mode === id ? s.modeTabActive : ''}`}
          onClick={() => changeMode(id)}
          title={label}
        >
          <Icon size={14} />
          <span className={s.modeTabLabel}>{label}</span>
        </button>
      ))}
    </div>
  );

  // 左サイドバーのリスト（変更 / ツリー）
  const listPanel =
    mode === 'changes' ? (
      <DiffSummary
        rid={rid}
        summary={gitDiff.diffSummary}
        isLoading={gitDiff.diffSummaryLoading}
        error={gitDiff.diffSummaryError}
        onRefresh={gitDiff.refreshDiffSummary}
        onFileClick={handleSelectFromChanges}
      />
    ) : (
      <FileTree
        directoryCache={directoryCacheWithDeleted}
        expandedDirs={fileViewer.expandedDirs}
        selectedFilePath={fileViewer.selectedFilePath}
        onToggleDir={fileViewer.toggleDir}
        onSelectFile={handleSelectFromTree}
        gitChangedFiles={gitChangedFiles}
      />
    );

  const contentPane = (mobile: boolean) => (
    <FileContentViewer
      content={fileViewer.fileContent}
      isLoading={fileViewer.isLoadingFile}
      error={fileViewer.error}
      onBack={fileViewer.backToTree}
      showBackButton={mobile && !fileViewer.isFullScreen}
      diffDetail={fileViewer.diffDetail}
      gitStatus={selectedFileGitStatus}
      isDiffMode={fileViewer.isDiffMode}
      onToggleDiffMode={fileViewer.toggleDiffMode}
      isFullScreen={fileViewer.isFullScreen}
      onToggleFullScreen={fileViewer.toggleFullScreen}
      rid={rid}
    />
  );

  return (
    <div className={s.root}>
      {/* ヘッダー（1 行）: 戻る + リポジトリ名 + モードタブ */}
      <div className={s.header}>
        <button onClick={fileViewer.close} className={s.backButton} title="閉じる">
          <ArrowLeft size={20} />
        </button>
        <span className={s.headerRepoName}>{repoName}</span>
        <span className={s.headerSpacer} />
        {modeTabs}
      </div>

      {/* コンテンツ */}
      {mode === 'graph' ? (
        <div className={s.graphArea}>
          <GitGraphView
            gitGraph={gitGraph}
            repoName={graphRepoName}
            rid={rid}
            embedded
          />
        </div>
      ) : (
        <>
          {/* モバイル: 上下分割 */}
          <div className={s.mobileContent}>
            {!fileViewer.isFullScreen && (
              <div
                className={
                  showFileOnMobile ? s.mobileListCompact : s.mobileListFull
                }
              >
                {listPanel}
              </div>
            )}
            {showFileOnMobile && (
              <div
                className={
                  fileViewer.isFullScreen
                    ? s.mobileFileContentFullScreen
                    : s.mobileFileContent
                }
              >
                {contentPane(true)}
              </div>
            )}
          </div>

          {/* デスクトップ: 左右分割 */}
          <div className={s.desktopContent}>
            {!fileViewer.isFullScreen && (
              <div className={s.desktopList}>{listPanel}</div>
            )}
            <div className={s.desktopFileContent}>{contentPane(false)}</div>
          </div>
        </>
      )}
    </div>
  );
}

export default CodeBrowserView;
