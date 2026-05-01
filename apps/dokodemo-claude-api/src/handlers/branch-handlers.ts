import type { HandlerContext } from './types.js';
import type { GitWorktree } from '../types/index.js';
import {
  getBranches,
  switchBranch,
  getWorktrees,
  createWorktree,
  deleteWorktree,
  deleteBranch,
  deleteRemoteBranch,
  getMainRepoPath,
  mergeWorktreeBranch,
  createBranch,
} from '../utils/git-utils.js';
import { startBranchWatching } from '../services/branch-watcher.js';
import { repositoryIdManager } from '../services/repository-id-manager.js';
import { emitIdMappingUpdated } from './id-mapping-helpers.js';
import { resolveRepositoryPath } from '../utils/resolve-repository-path.js';

// ワークツリー取得の進行中リクエストを管理（同時実行防止）
const pendingWorktreeRequests = new Map<string, Promise<GitWorktree[]>>();

// ワークツリー結果のキャッシュ（短時間の重複リクエスト対策）
const worktreeCache = new Map<
  string,
  { worktrees: GitWorktree[]; timestamp: number }
>();
const CACHE_TTL_MS = 1000; // 1秒間キャッシュ

/**
 * ワークツリーに wtid を付与する。
 * managed dir 外（Cursor 等の外部ツールが登録した worktree）は除外する。
 */
function addWorktreeIds(
  worktrees: GitWorktree[],
): Array<GitWorktree & { wtid: string }> {
  const result: Array<GitWorktree & { wtid: string }> = [];
  for (const wt of worktrees) {
    const wtid = repositoryIdManager.tryGetId(wt.path);
    if (wtid === undefined) continue;
    result.push({ ...wt, wtid });
  }
  return result;
}

/**
 * ブランチ・ワークツリー関連のSocket.IOイベントハンドラーを登録
 */
export function registerBranchHandlers(ctx: HandlerContext): void {
  const { socket, processManager } = ctx;

  // ブランチ一覧の取得
  socket.on('list-branches', async (data) => {
    const { rid: inputRid, repositoryPath: rawPath } = data;
    const repositoryPath = resolveRepositoryPath({
      rid: inputRid,
      repositoryPath: rawPath,
    });
    if (!repositoryPath) return;
    const rid = repositoryIdManager.tryGetId(repositoryPath);

    try {
      const branches = await getBranches(repositoryPath);
      socket.emit('branches-list', { branches, rid });
      // HEAD監視を開始（既に監視中なら no-op）
      startBranchWatching(repositoryPath, ctx.io);
    } catch {
      socket.emit('branches-list', { branches: [], rid });
    }
  });

  // ブランチの切り替え
  socket.on('switch-branch', async (data) => {
    const { rid: inputRid, repositoryPath: rawPath, branchName } = data;
    const repositoryPath = resolveRepositoryPath({
      rid: inputRid,
      repositoryPath: rawPath,
    });
    if (!repositoryPath) return;
    const rid = repositoryIdManager.tryGetId(repositoryPath);

    try {
      const result = await switchBranch(repositoryPath, branchName);

      if (result.success) {
        const branches = await getBranches(repositoryPath);
        const currentBranch =
          branches.find((b) => b.current)?.name || branchName;

        socket.emit('branch-switched', {
          success: true,
          message: result.message,
          currentBranch,
          rid,
        });

        socket.emit('branches-list', { branches, rid });
      } else {
        socket.emit('branch-switched', {
          success: false,
          message: result.message,
          currentBranch: '',
          rid,
        });
      }
    } catch {
      socket.emit('branch-switched', {
        success: false,
        message: `ブランチ切り替えエラー`,
        currentBranch: '',
        rid,
      });
    }
  });

  // ワークツリー一覧の取得（同時実行防止＋キャッシュ付き）
  socket.on('list-worktrees', async (data) => {
    const { rid: inputRid, repositoryPath: rawPath } = data;
    const repositoryPath = resolveRepositoryPath({
      rid: inputRid,
      repositoryPath: rawPath,
    });
    if (!repositoryPath) return;

    try {
      const mainRepoPath = getMainRepoPath(repositoryPath);
      const prid = repositoryIdManager.tryGetId(mainRepoPath);

      // キャッシュをチェック（TTL内ならキャッシュを返す）
      const cached = worktreeCache.get(mainRepoPath);
      if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
        socket.emit('worktrees-list', {
          worktrees: addWorktreeIds(cached.worktrees),
          prid,
          parentRepoPath: mainRepoPath,
        });
        return;
      }

      // 同じリポジトリに対する進行中のリクエストがあれば再利用
      let worktreesPromise = pendingWorktreeRequests.get(mainRepoPath);
      if (!worktreesPromise) {
        worktreesPromise = getWorktrees(mainRepoPath);
        pendingWorktreeRequests.set(mainRepoPath, worktreesPromise);

        // リクエスト完了後にマップから削除
        worktreesPromise.finally(() => {
          pendingWorktreeRequests.delete(mainRepoPath);
        });
      }

      const worktrees = await worktreesPromise;

      // 結果が空でない場合のみキャッシュを更新（空の結果は異常の可能性が高い）
      if (worktrees.length > 0) {
        worktreeCache.set(mainRepoPath, { worktrees, timestamp: Date.now() });
      } else {
        // 結果が空だが、キャッシュに有効な結果がある場合はそれを使用
        const existingCache = worktreeCache.get(mainRepoPath);
        if (existingCache && existingCache.worktrees.length > 0) {
          socket.emit('worktrees-list', {
            worktrees: addWorktreeIds(existingCache.worktrees),
            prid,
            parentRepoPath: mainRepoPath,
          });
          return;
        }
      }

      socket.emit('worktrees-list', {
        worktrees: addWorktreeIds(worktrees),
        prid,
        parentRepoPath: mainRepoPath,
      });
    } catch {
      const mainRepoPath = getMainRepoPath(repositoryPath);
      const prid = repositoryIdManager.tryGetId(mainRepoPath);
      socket.emit('worktrees-list', {
        worktrees: [],
        prid,
        parentRepoPath: mainRepoPath,
      });
    }
  });

  // ワークツリーの作成
  socket.on('create-worktree', async (data) => {
    // pridからparentRepoPathを解決
    const parentRepoPath = resolveRepositoryPath({
      rid: data.prid,
      repositoryPath: data.parentRepoPath,
    });
    if (!parentRepoPath) return;

    const worktreeData = { ...data, parentRepoPath };

    try {
      const result = await createWorktree(worktreeData);
      const prid = repositoryIdManager.tryGetId(parentRepoPath);

      // ワークツリー作成成功時にwtidを追加
      if (result.success && result.worktree) {
        const wtid = repositoryIdManager.getId(result.worktree.path);
        socket.emit('worktree-created', {
          ...result,
          worktree: { ...result.worktree, wtid },
        });
      } else {
        socket.emit('worktree-created', result);
      }

      if (result.success) {
        // IDマッピングの更新を全クライアントに通知
        void emitIdMappingUpdated(ctx.io, ctx.repositories);

        // キャッシュを無効化して最新データを取得
        worktreeCache.delete(parentRepoPath);

        const worktrees = await getWorktrees(parentRepoPath);

        // キャッシュを更新
        worktreeCache.set(parentRepoPath, {
          worktrees,
          timestamp: Date.now(),
        });

        socket.emit('worktrees-list', {
          worktrees: addWorktreeIds(worktrees),
          prid,
          parentRepoPath,
        });
      }
    } catch (error) {
      socket.emit('worktree-created', {
        success: false,
        message: `ワークツリー作成エラー: ${error instanceof Error ? error.message : '不明なエラー'}`,
      });
    }
  });

  // ワークツリーのマージ（削除せずにマージのみ）
  socket.on('merge-worktree', async (data) => {
    // wtidとpridからパスを解決
    const worktreePath = resolveRepositoryPath({
      rid: data.wtid,
      repositoryPath: data.worktreePath,
    });
    const parentRepoPath = resolveRepositoryPath({
      rid: data.prid,
      repositoryPath: data.parentRepoPath,
    });
    if (!worktreePath || !parentRepoPath) return;
    const wtid = repositoryIdManager.tryGetId(worktreePath);

    try {
      const mergeResult = await mergeWorktreeBranch(
        worktreePath,
        parentRepoPath
      );

      socket.emit('worktree-merged', {
        success: mergeResult.success,
        message: mergeResult.message,
        wtid,
        mergeResult: mergeResult.success
          ? {
              mergedBranch: mergeResult.mergedBranch,
              targetBranch: mergeResult.targetBranch,
            }
          : {
              conflictFiles: mergeResult.conflictFiles,
              errorDetails: mergeResult.errorDetails,
            },
      });
    } catch (error) {
      socket.emit('worktree-merged', {
        success: false,
        message: `マージエラー: ${error instanceof Error ? error.message : '不明なエラー'}`,
        wtid,
      });
    }
  });

  // ワークツリーの削除（マージなし）
  socket.on('delete-worktree', async (data) => {
    // wtidとpridからパスを解決
    const worktreePath = resolveRepositoryPath({
      rid: data.wtid,
      repositoryPath: data.worktreePath,
    });
    const parentRepoPath = resolveRepositoryPath({
      rid: data.prid,
      repositoryPath: data.parentRepoPath,
    });
    if (!worktreePath || !parentRepoPath) return;

    const { deleteBranch: deleteBranchOption, branchName } = data;

    const wtid = repositoryIdManager.tryGetId(worktreePath);
    const prid = repositoryIdManager.tryGetId(parentRepoPath);

    try {
      await processManager.cleanupRepositoryProcesses(worktreePath);

      // ワークツリー削除実行（オプションでブランチも削除）
      const result = await deleteWorktree(worktreePath, parentRepoPath, {
        deleteBranch: deleteBranchOption,
        branchName,
      });

      socket.emit('worktree-deleted', {
        ...result,
        wtid,
        worktreePath,
      });

      if (result.success) {
        // 全クライアントへ最新の id-mapping を通知（ワークツリー削除を反映）
        void emitIdMappingUpdated(ctx.io, ctx.repositories);

        // キャッシュを無効化して、次回のlist-worktreesで最新データを取得
        worktreeCache.delete(parentRepoPath);

        const worktrees = await getWorktrees(parentRepoPath);
        const filteredWorktrees = worktrees.filter(
          (wt) => wt.path !== worktreePath
        );

        // キャッシュを更新（フィルタリング済みのデータで）
        worktreeCache.set(parentRepoPath, {
          worktrees: filteredWorktrees,
          timestamp: Date.now(),
        });

        socket.emit('worktrees-list', {
          worktrees: addWorktreeIds(filteredWorktrees),
          prid,
          parentRepoPath,
        });

        // ブランチ削除した場合はブランチ一覧も更新
        if (deleteBranchOption && branchName) {
          const branches = await getBranches(parentRepoPath);
          const rid = repositoryIdManager.tryGetId(parentRepoPath);
          socket.emit('branches-list', {
            branches,
            rid,
          });
        }
      }
    } catch (error) {
      socket.emit('worktree-deleted', {
        success: false,
        message: `ワークツリー削除エラー: ${error instanceof Error ? error.message : '不明なエラー'}`,
        wtid,
      });
    }
  });

  // ブランチの削除
  socket.on('delete-branch', async (data) => {
    const {
      rid: inputRid,
      repositoryPath: rawPath,
      branchName,
      deleteRemote,
    } = data;
    const repositoryPath = resolveRepositoryPath({
      rid: inputRid,
      repositoryPath: rawPath,
    });
    if (!repositoryPath) return;
    const rid = repositoryIdManager.tryGetId(repositoryPath);

    try {
      // ローカルブランチの削除
      const result = await deleteBranch(repositoryPath, branchName);

      // リモートブランチ削除の結果
      let remoteDeleteResult:
        | { attempted: boolean; success: boolean; message?: string }
        | undefined;

      // ローカル削除成功かつリモート削除も要求された場合
      if (result.success && deleteRemote) {
        remoteDeleteResult = await deleteRemoteBranch(
          repositoryPath,
          branchName
        );
      }

      socket.emit('branch-deleted', {
        ...result,
        branchName,
        rid,
        remoteDeleteResult,
      });

      if (result.success) {
        // ブランチ一覧を更新
        const branches = await getBranches(repositoryPath);
        socket.emit('branches-list', { branches, rid });
      }
    } catch (error) {
      socket.emit('branch-deleted', {
        success: false,
        message: `ブランチ削除エラー: ${error instanceof Error ? error.message : '不明なエラー'}`,
        branchName,
        rid,
      });
    }
  });

  // ブランチの作成（git checkout -b）
  socket.on('create-branch', async (data) => {
    const {
      rid: inputRid,
      repositoryPath: rawPath,
      branchName,
      baseBranch,
    } = data;
    const repositoryPath = resolveRepositoryPath({
      rid: inputRid,
      repositoryPath: rawPath,
    });
    if (!repositoryPath) return;
    const rid = repositoryIdManager.tryGetId(repositoryPath);

    try {
      const result = await createBranch(repositoryPath, branchName, baseBranch);
      socket.emit('branch-created', { ...result, branchName, rid });

      if (result.success) {
        // 作成→自動切替なので branches-list を再取得して emit
        const branches = await getBranches(repositoryPath);
        socket.emit('branches-list', { branches, rid });
      }
    } catch (error) {
      socket.emit('branch-created', {
        success: false,
        message: `ブランチ作成エラー: ${error instanceof Error ? error.message : '不明なエラー'}`,
        branchName,
        rid,
      });
    }
  });
}
