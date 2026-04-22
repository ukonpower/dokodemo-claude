import path from 'path';
import { IdMappingData } from '../types/index.js';

/**
 * リポジトリパスとIDの相互変換を提供するクラス
 *
 * rid はパスから決定的に計算される:
 * - 通常リポジトリ: REPOS_DIR からの相対パス（例: "dokodemo-claude"）
 * - ワークツリー  : "wt:" + WORKTREES_DIR からの相対パス（例: "wt:dokodemo-claude/feature/foo"）
 *
 * Map もカウンタも持たないため、再起動しても同じパスからは必ず同じ rid が得られる。
 * URL に埋め込む場合は ":" や "/" を含むため呼び出し側で encodeURIComponent すること。
 */
const WORKTREE_PREFIX = 'wt:';

class RepositoryIdManager {
  constructor(
    private readonly reposDir: string,
    private readonly worktreesDir: string,
  ) {}

  /**
   * パス → rid（決定的）
   * managed dir 外のパスを渡された場合は例外を投げる
   */
  getId(repoPath: string): string {
    const abs = path.resolve(repoPath);

    const reposRel = path.relative(this.reposDir, abs);
    if (reposRel && !reposRel.startsWith('..') && !path.isAbsolute(reposRel)) {
      return reposRel;
    }

    const wtRel = path.relative(this.worktreesDir, abs);
    if (wtRel && !wtRel.startsWith('..') && !path.isAbsolute(wtRel)) {
      return `${WORKTREE_PREFIX}${wtRel}`;
    }

    throw new Error(`Path is outside managed directories: ${repoPath}`);
  }

  /**
   * パス → rid（managed dir 外なら undefined を返す例外なし版）
   */
  tryGetId(repoPath: string): string | undefined {
    try {
      return this.getId(repoPath);
    } catch {
      return undefined;
    }
  }

  /**
   * rid → 絶対パス（決定的）
   */
  getPath(rid: string): string {
    if (rid.startsWith(WORKTREE_PREFIX)) {
      return path.resolve(this.worktreesDir, rid.slice(WORKTREE_PREFIX.length));
    }
    return path.resolve(this.reposDir, rid);
  }

  isWorktreeId(rid: string): boolean {
    return rid.startsWith(WORKTREE_PREFIX);
  }

  isRepoId(rid: string): boolean {
    return !this.isWorktreeId(rid);
  }

  /**
   * 既知のリポジトリ/ワークツリー一覧から id-mapping を構築（送信用）
   */
  buildMappings(
    repos: Array<{ path: string }>,
    worktrees: Array<{ path: string; parentRepoPath: string }>,
  ): IdMappingData {
    return {
      repositories: repos.map((r) => ({ id: this.getId(r.path), path: r.path })),
      worktrees: worktrees.map((w) => ({
        id: this.getId(w.path),
        path: w.path,
        parentId: this.getId(w.parentRepoPath),
      })),
    };
  }
}

export { RepositoryIdManager };

// 起動時に server.ts から initRepositoryIdManager() で初期化される
// 初期化前に repositoryIdManager を参照するとランタイムエラーになる点に注意
export let repositoryIdManager: RepositoryIdManager;

export function initRepositoryIdManager(
  reposDir: string,
  worktreesDir: string,
): void {
  repositoryIdManager = new RepositoryIdManager(reposDir, worktreesDir);
}
