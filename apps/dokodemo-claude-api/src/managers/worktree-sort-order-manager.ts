/**
 * ワークツリー並び順マネージャー
 * 親リポジトリパス → ワークツリーパスの並び順配列 のマップを永続化する。
 * フロントエンドでタブをドラッグ並び替えした結果を保持し、
 * worktrees-list 送信時にこの順序を適用する。
 */

import type { GitWorktree } from '../types/index.js';
import { PersistenceService } from '../services/persistence-service.js';
import { Result, Ok, Err } from '../utils/result.js';
import { PersistenceError } from '../utils/errors.js';

const FILE = 'worktree-sort-orders.json';

export class WorktreeSortOrderManager {
  // key: parentRepoPath (絶対パス), value: ワークツリーパスの並び順配列
  private orders = new Map<string, string[]>();

  constructor(private readonly persistenceService: PersistenceService) {}

  async initialize(): Promise<void> {
    const result = await this.persistenceService.load<Record<string, string[]>>(
      FILE
    );
    if (!result.ok) {
      console.error(
        '[WorktreeSortOrderManager] 復元に失敗:',
        result.error.message
      );
      return;
    }
    if (result.value === null) return;

    this.orders.clear();
    for (const [repoPath, paths] of Object.entries(result.value)) {
      if (!Array.isArray(paths)) continue;
      this.orders.set(
        repoPath,
        paths.filter((p): p is string => typeof p === 'string' && p.length > 0)
      );
    }
  }

  get(parentRepoPath: string): string[] {
    return this.orders.get(parentRepoPath) ?? [];
  }

  /**
   * 保存済みの並び順に従って worktrees を並び替える。
   * メインワークツリーは常に先頭。保存順に存在しないものは元の順序を保って末尾に置く。
   */
  applyOrder<T extends GitWorktree>(
    parentRepoPath: string,
    worktrees: T[]
  ): T[] {
    const order = this.orders.get(parentRepoPath);
    if (!order || order.length === 0) return worktrees;

    const indexOf = (p: string): number => {
      const i = order.indexOf(p);
      return i === -1 ? Number.MAX_SAFE_INTEGER : i;
    };

    // Array.prototype.sort は安定ソートのため、未登録要素は元の相対順を保つ
    return [...worktrees].sort((a, b) => {
      if (a.isMain !== b.isMain) return a.isMain ? -1 : 1;
      return indexOf(a.path) - indexOf(b.path);
    });
  }

  async save(
    parentRepoPath: string,
    orderedPaths: string[]
  ): Promise<Result<string[], PersistenceError>> {
    if (!parentRepoPath) {
      return Err(
        PersistenceError.writeFailed(FILE, new Error('parentRepoPath is empty'))
      );
    }
    const sanitized = orderedPaths.filter(
      (p) => typeof p === 'string' && p.length > 0
    );
    this.orders.set(parentRepoPath, sanitized);

    const persistResult = await this.persist();
    if (!persistResult.ok) {
      return Err(persistResult.error);
    }
    return Ok(sanitized);
  }

  private async persist(): Promise<Result<void, PersistenceError>> {
    const data: Record<string, string[]> = {};
    for (const [key, paths] of this.orders.entries()) {
      data[key] = paths;
    }
    return this.persistenceService.save(FILE, data);
  }
}
