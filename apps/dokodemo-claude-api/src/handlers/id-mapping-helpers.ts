import type { GitRepository } from '../types/index.js';
import { repositoryIdManager } from '../services/repository-id-manager.js';
import { getWorktrees } from '../utils/git-utils.js';
import type { TypedServer, TypedSocket } from './types.js';

/**
 * リポジトリ一覧から worktree を含めた IdMappingData を構築する
 */
export async function buildIdMapping(
  repositories: GitRepository[],
): Promise<ReturnType<typeof repositoryIdManager.buildMappings>> {
  const allWorktrees: Array<{ path: string; parentRepoPath: string }> = [];
  for (const repo of repositories) {
    try {
      const worktrees = await getWorktrees(repo.path);
      for (const wt of worktrees) {
        if (wt.isMain) continue;
        // Cursor など外部ツールが登録した managed dir 外の worktree は除外
        if (repositoryIdManager.tryGetId(wt.path) === undefined) continue;
        allWorktrees.push({ path: wt.path, parentRepoPath: repo.path });
      }
    } catch {
      // worktree 取得に失敗したリポジトリは無視
    }
  }
  return repositoryIdManager.buildMappings(repositories, allWorktrees);
}

/**
 * 現在のリポジトリ/worktree 構成から id-mapping-updated を全クライアントへ送信する
 */
export async function emitIdMappingUpdated(
  io: TypedServer,
  repositories: GitRepository[],
): Promise<void> {
  const mapping = await buildIdMapping(repositories);
  io.emit('id-mapping-updated', mapping);
}

/**
 * 単一クライアントへ id-mapping を送信（接続初期化用）
 */
export async function emitIdMappingTo(
  socket: TypedSocket,
  repositories: GitRepository[],
): Promise<void> {
  const mapping = await buildIdMapping(repositories);
  socket.emit('id-mapping', mapping);
}
