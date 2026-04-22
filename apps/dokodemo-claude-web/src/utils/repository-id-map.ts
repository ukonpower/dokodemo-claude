import { IdMappingData } from '../types';

/**
 * フロントエンド側でリポジトリパスとIDの相互変換を管理するクラス
 * バックエンドから送信されるIDマッピングを保持し、
 * WebSocket通信時にパスからIDを取得するために使用
 */
class RepositoryIdMap {
  private pathToId: Map<string, string> = new Map();
  private idToPath: Map<string, string> = new Map();
  private worktreePathToId: Map<string, string> = new Map();
  private worktreeIdToPath: Map<string, string> = new Map();

  /**
   * バックエンドから送信されたIDマッピングデータで更新
   */
  update(data: IdMappingData): void {
    // リポジトリマッピングを更新
    this.pathToId.clear();
    this.idToPath.clear();
    for (const repo of data.repositories) {
      this.pathToId.set(repo.path, repo.id);
      this.idToPath.set(repo.id, repo.path);
    }

    // ワークツリーマッピングを更新
    this.worktreePathToId.clear();
    this.worktreeIdToPath.clear();
    for (const worktree of data.worktrees) {
      this.worktreePathToId.set(worktree.path, worktree.id);
      this.worktreeIdToPath.set(worktree.id, worktree.path);
    }
  }

  /**
   * パスからIDを取得（リポジトリまたはワークツリー）
   * 登録されていない場合はundefined
   */
  getRid(path: string): string | undefined {
    return this.pathToId.get(path) || this.worktreePathToId.get(path);
  }

  /**
   * IDからパスを取得（リポジトリまたはワークツリー）
   */
  getPath(rid: string): string | undefined {
    return this.idToPath.get(rid) || this.worktreeIdToPath.get(rid);
  }

  /**
   * リポジトリパスからリポジトリIDを取得
   */
  getRepoId(path: string): string | undefined {
    return this.pathToId.get(path);
  }

  /**
   * ワークツリーパスからワークツリーIDを取得
   */
  getWorktreeId(path: string): string | undefined {
    return this.worktreePathToId.get(path);
  }

  /**
   * 登録されている全てのマッピングを取得（デバッグ用）
   */
  getAllMappings(): {
    repositories: Array<{ id: string; path: string }>;
    worktrees: Array<{ id: string; path: string }>;
  } {
    const repositories: Array<{ id: string; path: string }> = [];
    const worktrees: Array<{ id: string; path: string }> = [];

    for (const [path, id] of this.pathToId) {
      repositories.push({ id, path });
    }
    for (const [path, id] of this.worktreePathToId) {
      worktrees.push({ id, path });
    }

    return { repositories, worktrees };
  }

  /**
   * マッピングをクリア
   */
  clear(): void {
    this.pathToId.clear();
    this.idToPath.clear();
    this.worktreePathToId.clear();
    this.worktreeIdToPath.clear();
  }
}

// シングルトンインスタンスをエクスポート
export const repositoryIdMap = new RepositoryIdMap();
