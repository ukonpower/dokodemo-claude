import { useMemo, useCallback } from 'react';
import { ArrowLeft } from 'lucide-react';
import FileTree from '../components/FileTree';
import FileContentViewer from '../components/FileContentViewer';
import type { UseFileViewerReturn } from '../hooks/useFileViewer';
import type { GitDiffSummary } from '../types';
import s from './FileViewerView.module.scss';

interface FileViewerViewProps {
  fileViewer: UseFileViewerReturn;
  repoName: string;
  diffSummary?: GitDiffSummary | null;
  rid?: string;
}

export function FileViewerView({
  fileViewer,
  repoName,
  diffSummary,
  rid,
}: FileViewerViewProps) {
  const isMobile = typeof window !== 'undefined' && window.innerWidth < 680;
  const showFileOnMobile = isMobile && fileViewer.selectedFilePath !== null;

  // Git変更ファイルのマップを生成
  const gitChangedFiles = useMemo(() => {
    if (!diffSummary?.files?.length) return undefined;
    const map = new Map<string, string>();
    for (const file of diffSummary.files) {
      map.set(file.filename, file.status);
    }
    return map;
  }, [diffSummary]);

  // 選択ファイルのGitステータス
  const selectedFileGitStatus = useMemo(() => {
    if (!gitChangedFiles || !fileViewer.selectedFilePath) return undefined;
    return gitChangedFiles.get(fileViewer.selectedFilePath);
  }, [gitChangedFiles, fileViewer.selectedFilePath]);

  // 削除ファイルを含むdirectoryCacheを生成
  const directoryCacheWithDeleted = useMemo(() => {
    if (!diffSummary?.files?.length) return fileViewer.directoryCache;

    const deletedFiles = diffSummary.files.filter((f) => f.status === 'D');
    if (deletedFiles.length === 0) return fileViewer.directoryCache;

    const cache = new Map(fileViewer.directoryCache);

    for (const file of deletedFiles) {
      const parts = file.filename.split('/');
      const fileName = parts[parts.length - 1];
      const dirPath = parts.length > 1 ? parts.slice(0, -1).join('/') : '';

      const dirEntries = cache.get(dirPath);
      if (dirEntries) {
        const alreadyExists = dirEntries.some((e) => e.path === file.filename);
        if (!alreadyExists) {
          cache.set(dirPath, [
            ...dirEntries,
            { name: fileName, path: file.filename, type: 'file' as const },
          ]);
        }
      }
    }

    return cache;
  }, [fileViewer.directoryCache, diffSummary]);

  // selectFileをラップしてgitStatusを渡す
  const handleSelectFile = useCallback(
    (path: string) => {
      const status = gitChangedFiles?.get(path);
      fileViewer.selectFile(path, status);
    },
    [fileViewer, gitChangedFiles]
  );

  return (
    <div className={s.root}>
      {/* ヘッダー */}
      <div className={s.header}>
        <button
          onClick={fileViewer.close}
          className={s.backButton}
        >
          <ArrowLeft size={20} />
        </button>
        <span className={s.headerTitle}>
          ファイル
        </span>
        <span className={s.headerRepoName}>{repoName}</span>
      </div>

      {/* コンテンツ */}
      {/* モバイル: 上下分割（ファイル選択時）、全画面時はファイル内容のみ */}
      <div className={s.mobileContent}>
        {/* ツリー部分（全画面時は非表示） */}
        {!fileViewer.isFullScreen && (
          <div className={showFileOnMobile ? s.mobileTreeCompact : s.mobileTreeFull}>
            <FileTree
              directoryCache={directoryCacheWithDeleted}
              expandedDirs={fileViewer.expandedDirs}
              selectedFilePath={fileViewer.selectedFilePath}
              onToggleDir={fileViewer.toggleDir}
              onSelectFile={handleSelectFile}
              gitChangedFiles={gitChangedFiles}
            />
          </div>
        )}

        {/* ファイル内容部分（ファイル選択時のみ表示） */}
        {showFileOnMobile && (
          <div className={fileViewer.isFullScreen ? s.mobileFileContentFullScreen : s.mobileFileContent}>
            <FileContentViewer
              content={fileViewer.fileContent}
              isLoading={fileViewer.isLoadingFile}
              error={fileViewer.error}
              onBack={fileViewer.backToTree}
              showBackButton={!fileViewer.isFullScreen}
              diffDetail={fileViewer.diffDetail}
              gitStatus={selectedFileGitStatus}
              isDiffMode={fileViewer.isDiffMode}
              onToggleDiffMode={fileViewer.toggleDiffMode}
              isFullScreen={fileViewer.isFullScreen}
              onToggleFullScreen={fileViewer.toggleFullScreen}
              rid={rid}
            />
          </div>
        )}
      </div>

      {/* デスクトップ: 左右分割、全画面時はファイル内容のみ */}
      <div className={s.desktopContent}>
        {/* 左: ファイルツリー（全画面時は非表示） */}
        {!fileViewer.isFullScreen && (
          <div className={s.desktopTree}>
            <FileTree
              directoryCache={directoryCacheWithDeleted}
              expandedDirs={fileViewer.expandedDirs}
              selectedFilePath={fileViewer.selectedFilePath}
              onToggleDir={fileViewer.toggleDir}
              onSelectFile={handleSelectFile}
              gitChangedFiles={gitChangedFiles}
            />
          </div>
        )}

        {/* 右: ファイル内容 */}
        <div className={s.desktopFileContent}>
          <FileContentViewer
            content={fileViewer.fileContent}
            isLoading={fileViewer.isLoadingFile}
            error={fileViewer.error}
            onBack={fileViewer.backToTree}
            diffDetail={fileViewer.diffDetail}
            gitStatus={selectedFileGitStatus}
            isDiffMode={fileViewer.isDiffMode}
            onToggleDiffMode={fileViewer.toggleDiffMode}
            isFullScreen={fileViewer.isFullScreen}
            onToggleFullScreen={fileViewer.toggleFullScreen}
            rid={rid}
          />
        </div>
      </div>
    </div>
  );
}
