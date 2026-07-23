import { useEffect } from 'react';
import type { UseRepositoryReturn } from '@/features/repo/hooks/useRepository';
import type { UseFileViewerReturn } from '@/features/files/hooks/useFileViewer';
import type { UseGitDiffReturn } from '@/features/git/hooks/useGitDiff';

/**
 * 現在のリポジトリ・ビュー状態に応じてページタイトル（document.title）を設定する
 * 副作用専用フック（戻り値なし）
 */
export function useDocumentTitle(
  repository: UseRepositoryReturn,
  fileViewer: UseFileViewerReturn,
  gitDiff: UseGitDiffReturn
): void {
  useEffect(() => {
    const repoInfo = repository.repositories.find((r) => r.path === repository.currentRepo);
    let repoName: string;
    if (repoInfo?.isWorktree && repoInfo?.parentRepoName && repoInfo?.worktreeBranch) {
      repoName = `${repoInfo.parentRepoName} / ${repoInfo.worktreeBranch}`;
    } else if (repoInfo) {
      repoName = repoInfo.name;
    } else if (repository.currentRepo) {
      repoName = repository.currentRepo.split('/').filter(Boolean).pop() || 'Repository';
    } else {
      document.title = 'dokodemo-claude';
      return;
    }

    if (fileViewer.isActive) {
      if (fileViewer.selectedFilePath) {
        const fileName = fileViewer.selectedFilePath.split('/').pop() || 'Files';
        document.title = `${fileName} | ${repoName}`;
      } else {
        document.title = `Files | ${repoName}`;
      }
    } else if (gitDiff.currentView === 'diff' && gitDiff.diffViewFilename) {
      document.title = `Diff | ${repoName}`;
    } else {
      document.title = repoName;
    }
  }, [
    repository.currentRepo,
    repository.repositories,
    fileViewer.isActive,
    fileViewer.selectedFilePath,
    gitDiff.currentView,
    gitDiff.diffViewFilename,
  ]);
}
