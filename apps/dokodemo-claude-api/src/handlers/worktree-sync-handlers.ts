/**
 * ワークツリー同期設定ハンドラ
 * 親リポジトリごとの「worktree 作成時にコピー/リンクするファイル」設定の取得・保存を扱う。
 */

import path from 'path';
import { promises as fs } from 'fs';
import type { HandlerContext } from './types.js';
import { resolveRepositoryPath } from '../utils/resolve-repository-path.js';
import { repositoryIdManager } from '../services/repository-id-manager.js';
import { getMainRepoPath } from '../utils/git-utils.js';

// 候補列挙時に除外するエントリ（.git は同期させない）
const SYNC_CANDIDATE_EXCLUDED = new Set(['.git']);

// 親リポジトリルート配下に収まっているかを確認
function isInsideRoot(root: string, target: string): boolean {
  const resolved = path.resolve(root, target);
  return resolved === root || resolved.startsWith(root + path.sep);
}

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

    socket.emit('worktree-sync-config', {
      prid,
      parentRepoPath,
      entries,
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
    socket.emit('worktree-sync-config', {
      prid,
      parentRepoPath,
      entries: result.value,
    });
  });

  // 親リポジトリ内の指定ディレクトリ直下を列挙し、同期対象候補として返す
  socket.on('list-worktree-sync-candidates', async (data) => {
    const repoPath = resolveRepositoryPath({
      rid: data.prid,
      repositoryPath: data.parentRepoPath,
    });
    if (!repoPath) return;

    const parentRepoPath = getMainRepoPath(repoPath);
    const prid = repositoryIdManager.tryGetId(parentRepoPath);
    const rawDirPath = (data.dirPath ?? '').replace(/^\/+/, '').replace(/\/+$/, '');

    // パストラバーサル防止
    if (rawDirPath.includes('..') || !isInsideRoot(parentRepoPath, rawDirPath)) {
      socket.emit('worktree-sync-candidates', {
        prid,
        parentRepoPath,
        dirPath: rawDirPath,
        entries: [],
      });
      return;
    }

    const targetDir = path.resolve(parentRepoPath, rawDirPath);

    try {
      const dirents = await fs.readdir(targetDir, { withFileTypes: true });
      const entries = dirents
        .filter((d) => !(rawDirPath === '' && SYNC_CANDIDATE_EXCLUDED.has(d.name)))
        .map((d) => ({
          name: d.name,
          type: d.isDirectory() ? ('directory' as const) : ('file' as const),
        }))
        .sort((a, b) => {
          if (a.type !== b.type) return a.type === 'directory' ? -1 : 1;
          return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
        });

      socket.emit('worktree-sync-candidates', {
        prid,
        parentRepoPath,
        dirPath: rawDirPath,
        entries,
      });
    } catch {
      socket.emit('worktree-sync-candidates', {
        prid,
        parentRepoPath,
        dirPath: rawDirPath,
        entries: [],
      });
    }
  });
}
