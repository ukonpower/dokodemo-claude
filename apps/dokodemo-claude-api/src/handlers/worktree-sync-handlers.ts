/**
 * ワークツリー同期設定ハンドラ
 * 親リポジトリごとの「worktree 作成時にコピー/リンクするファイル」設定の取得・保存を扱う。
 */

import type { HandlerContext } from './types.js';
import { resolveRepositoryPath } from '../utils/resolve-repository-path.js';
import { repositoryIdManager } from '../services/repository-id-manager.js';
import { getMainRepoPath } from '../utils/git-utils.js';
import { getSyncSuggestions } from '../utils/worktree-sync.js';

export function registerWorktreeSyncHandlers(ctx: HandlerContext): void {
  const { socket, processManager } = ctx;
  const mgr = processManager.worktreeSyncManager;

  socket.on('get-worktree-sync-config', async (data) => {
    const repoPath = resolveRepositoryPath({
      rid: data.prid,
      repositoryPath: data.parentRepoPath,
    });
    if (!repoPath) return;

    const parentRepoPath = getMainRepoPath(repoPath);
    const prid = repositoryIdManager.tryGetId(parentRepoPath);
    const entries = mgr.get(parentRepoPath);
    const suggestions = await getSyncSuggestions(parentRepoPath);

    socket.emit('worktree-sync-config', {
      prid,
      parentRepoPath,
      entries,
      suggestions,
    });
  });

  socket.on('save-worktree-sync-config', async (data) => {
    const repoPath = resolveRepositoryPath({
      rid: data.prid,
      repositoryPath: data.parentRepoPath,
    });
    if (!repoPath) {
      socket.emit('worktree-sync-config-saved', {
        success: false,
        message: 'リポジトリパスを解決できませんでした',
      });
      return;
    }

    const parentRepoPath = getMainRepoPath(repoPath);
    const prid = repositoryIdManager.tryGetId(parentRepoPath);
    const result = await mgr.save(parentRepoPath, data.entries);
    if (!result.ok) {
      socket.emit('worktree-sync-config-saved', {
        success: false,
        message: result.error.message,
        prid,
        parentRepoPath,
      });
      return;
    }

    socket.emit('worktree-sync-config-saved', {
      success: true,
      message: '同期設定を保存しました',
      prid,
      parentRepoPath,
    });
    // 保存後の最新状態を返す
    const suggestions = await getSyncSuggestions(parentRepoPath);
    socket.emit('worktree-sync-config', {
      prid,
      parentRepoPath,
      entries: result.value,
      suggestions,
    });
  });
}
