import type { HandlerContext } from './types.js';
import type { GitWorktree, GitWorktreePrInfo } from '../types/index.js';
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
  pullBranch,
  getBranchSyncStatus,
  fetchRemote,
  pushBranch,
} from '../utils/git-utils.js';
import { getWorktreePrsByBranch } from '../utils/gh-utils.js';
import { startBranchWatching } from '../services/branch-watcher.js';
import { worktreeMemoSummaryService } from '../services/worktree-memo-summary-service.js';
import { repositoryIdManager } from '../services/repository-id-manager.js';
import { emitIdMappingUpdated } from './id-mapping-helpers.js';
import { resolveRepositoryPath } from '../utils/resolve-repository-path.js';
import type {
  WorktreeSortOrderManager,
  WorktreeMemoManager,
} from '../managers/index.js';

// ワークツリー取得の進行中リクエストを管理（同時実行防止）
const pendingWorktreeRequests = new Map<string, Promise<GitWorktree[]>>();

// 並び順マネージャーの参照（server.ts 起動時に注入）
let sortOrderManager: WorktreeSortOrderManager | null = null;

// メモマネージャーの参照（server.ts 起動時に注入）
let memoManager: WorktreeMemoManager | null = null;

/**
 * ワークツリー並び順マネージャーを注入する。
 * addWorktreeIds が emit 時に保存済みの並び順を適用するために使用する。
 */
export function setWorktreeSortOrderManager(
  manager: WorktreeSortOrderManager
): void {
  sortOrderManager = manager;
}

/**
 * ワークツリーメモマネージャーを注入する。
 * addWorktreeIds が emit 時に各ワークツリーのメモを同梱するために使用する。
 */
export function setWorktreeMemoManager(manager: WorktreeMemoManager): void {
  memoManager = manager;
}

// ワークツリー結果のキャッシュ（短時間の重複リクエスト対策）
const worktreeCache = new Map<
  string,
  { worktrees: GitWorktree[]; timestamp: number }
>();
const CACHE_TTL_MS = 1000; // 1秒間キャッシュ

/**
 * ワークツリーに wtid を付与する。
 * managed dir 外（Cursor 等の外部ツールが登録した worktree）は除外する。
 * parentRepoPath を渡すと、保存済みのタブ並び順を適用する。
 */
export function addWorktreeIds(
  worktrees: GitWorktree[],
  parentRepoPath?: string,
): Array<GitWorktree & { wtid: string }> {
  const result: Array<GitWorktree & { wtid: string }> = [];
  for (const wt of worktrees) {
    const wtid = repositoryIdManager.tryGetId(wt.path);
    if (wtid === undefined) continue;
    result.push({
      ...wt,
      wtid,
      memo: memoManager?.get(wt.path),
      memoSummary: worktreeMemoSummaryService.getSummary(wt.path),
    });
  }
  if (parentRepoPath && sortOrderManager) {
    return sortOrderManager.applyOrder(parentRepoPath, result);
  }
  return result;
}

// PR 情報の短期キャッシュ（gh CLI 呼び出しを抑制）
const PR_CACHE_TTL_MS = 30 * 1000;
const prCache = new Map<
  string,
  { map: Map<string, GitWorktreePrInfo>; timestamp: number }
>();

async function getWorktreePrsCached(
  parentRepoPath: string
): Promise<Map<string, GitWorktreePrInfo>> {
  const cached = prCache.get(parentRepoPath);
  if (cached && Date.now() - cached.timestamp < PR_CACHE_TTL_MS) {
    return cached.map;
  }
  const map = await getWorktreePrsByBranch(parentRepoPath);
  prCache.set(parentRepoPath, { map, timestamp: Date.now() });
  return map;
}

/**
 * worktrees-list イベントの payload を構築する。
 * - wtid 付与・並び順適用・メモ付与・PR 情報付与をまとめる。
 */
export async function buildWorktreesListPayload(
  worktrees: GitWorktree[],
  parentRepoPath: string
): Promise<{
  worktrees: Array<GitWorktree & { wtid: string }>;
  prid: string | undefined;
  parentRepoPath: string;
}> {
  const prid = repositoryIdManager.tryGetId(parentRepoPath);
  const base = addWorktreeIds(worktrees, parentRepoPath);
  let enriched = base;
  try {
    const prMap = await getWorktreePrsCached(parentRepoPath);
    if (prMap.size > 0) {
      enriched = base.map((wt) => {
        const pr = prMap.get(wt.branch);
        return pr ? { ...wt, prInfo: pr } : wt;
      });
    }
  } catch {
    // PR 取得失敗時は通常の payload を返す
  }
  return { worktrees: enriched, prid, parentRepoPath };
}

/**
 * 指定された親リポジトリの PR キャッシュを破棄する。
 * worktree 作成・削除・マージ後など、PR 状態が変わった可能性がある場面で呼ぶ。
 */
export function invalidatePrCache(parentRepoPath: string): void {
  prCache.delete(parentRepoPath);
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

        // ワークツリータブのブランチ名を同期するため worktrees-list を再 emit
        const mainRepoPath = getMainRepoPath(repositoryPath);
        worktreeCache.delete(mainRepoPath);
        const worktrees = await getWorktrees(mainRepoPath);
        if (worktrees.length > 0) {
          worktreeCache.set(mainRepoPath, {
            worktrees,
            timestamp: Date.now(),
          });
        }
        socket.emit(
          'worktrees-list',
          await buildWorktreesListPayload(worktrees, mainRepoPath)
        );
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

      // キャッシュをチェック（TTL内ならキャッシュを返す）
      const cached = worktreeCache.get(mainRepoPath);
      if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
        socket.emit(
          'worktrees-list',
          await buildWorktreesListPayload(cached.worktrees, mainRepoPath)
        );
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
          socket.emit(
            'worktrees-list',
            await buildWorktreesListPayload(
              existingCache.worktrees,
              mainRepoPath
            )
          );
          return;
        }
      }

      socket.emit(
        'worktrees-list',
        await buildWorktreesListPayload(worktrees, mainRepoPath)
      );
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
        invalidatePrCache(parentRepoPath);

        const worktrees = await getWorktrees(parentRepoPath);

        // キャッシュを更新
        worktreeCache.set(parentRepoPath, {
          worktrees,
          timestamp: Date.now(),
        });

        socket.emit(
          'worktrees-list',
          await buildWorktreesListPayload(worktrees, parentRepoPath)
        );
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
        // 削除したワークツリーのメモも掃除する
        await processManager.worktreeMemoManager.remove(worktreePath);

        // 全クライアントへ最新の id-mapping を通知（ワークツリー削除を反映）
        void emitIdMappingUpdated(ctx.io, ctx.repositories);

        // キャッシュを無効化して、次回のlist-worktreesで最新データを取得
        worktreeCache.delete(parentRepoPath);
        invalidatePrCache(parentRepoPath);

        const worktrees = await getWorktrees(parentRepoPath);
        const filteredWorktrees = worktrees.filter(
          (wt) => wt.path !== worktreePath
        );

        // キャッシュを更新（フィルタリング済みのデータで）
        worktreeCache.set(parentRepoPath, {
          worktrees: filteredWorktrees,
          timestamp: Date.now(),
        });

        socket.emit(
          'worktrees-list',
          await buildWorktreesListPayload(filteredWorktrees, parentRepoPath)
        );

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

        // ワークツリータブのブランチ名を同期するため worktrees-list を再 emit
        const mainRepoPath = getMainRepoPath(repositoryPath);
        worktreeCache.delete(mainRepoPath);
        const worktrees = await getWorktrees(mainRepoPath);
        if (worktrees.length > 0) {
          worktreeCache.set(mainRepoPath, {
            worktrees,
            timestamp: Date.now(),
          });
        }
        socket.emit(
          'worktrees-list',
          await buildWorktreesListPayload(worktrees, mainRepoPath)
        );
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

  // 現在ブランチの pull (--ff-only)
  socket.on('pull-branch', async (data) => {
    const { rid: inputRid, repositoryPath: rawPath } = data;
    const repositoryPath = resolveRepositoryPath({
      rid: inputRid,
      repositoryPath: rawPath,
    });
    if (!repositoryPath) return;
    const rid = repositoryIdManager.tryGetId(repositoryPath);

    // 開始イベント（モーダル表示などのトリガー）
    socket.emit('branch-pull-started', { rid });

    try {
      const result = await pullBranch(repositoryPath, (chunk, stream) => {
        // stdout/stderr のチャンクを逐次配信
        socket.emit('branch-pull-progress', { rid, chunk, stream });
      });

      socket.emit('branch-pulled', {
        success: result.success,
        message: result.message,
        output: result.output,
        rid,
      });

      if (result.success) {
        // HEAD ファイル自体が変わらない可能性があるため、明示的に再 emit
        const branches = await getBranches(repositoryPath);
        socket.emit('branches-list', { branches, rid });
      }
    } catch (error) {
      socket.emit('branch-pulled', {
        success: false,
        message: `pull エラー: ${error instanceof Error ? error.message : '不明なエラー'}`,
        output: '',
        rid,
      });
    }
  });

  // 現在ブランチの ahead/behind と upstream を取得
  // fetch: true のとき git fetch で remote-tracking ref を最新化してから計算する
  // （手動リフレッシュ・タブ復帰時用。fetch 失敗時はローカル値で応答する）
  socket.on('get-branch-sync-status', async (data) => {
    const { rid, fetch: withFetch } = data;
    const repositoryPath = resolveRepositoryPath({ rid });
    if (!repositoryPath) return;

    try {
      if (withFetch) {
        await fetchRemote(repositoryPath);
      }
      const status = await getBranchSyncStatus(repositoryPath);
      socket.emit('branch-sync-status', { rid, ...status });
    } catch {
      socket.emit('branch-sync-status', {
        rid,
        upstream: null,
        ahead: 0,
        behind: 0,
      });
    }
  });

  // 現在ブランチの push
  socket.on('push-branch', async (data) => {
    const { rid } = data;
    const repositoryPath = resolveRepositoryPath({ rid });
    if (!repositoryPath) return;

    // 開始イベント（モーダル表示などのトリガー）
    socket.emit('branch-push-started', { rid });

    try {
      const result = await pushBranch(repositoryPath, (chunk, stream) => {
        // stdout/stderr のチャンクを逐次配信
        socket.emit('branch-push-progress', { rid, chunk, stream });
      });

      socket.emit('branch-pushed', {
        success: result.success,
        message: result.message,
        rid,
      });
    } catch (error) {
      socket.emit('branch-pushed', {
        success: false,
        message: `push エラー: ${error instanceof Error ? error.message : '不明なエラー'}`,
        rid,
      });
    }
  });

  // ワークツリータブの並び順を保存
  socket.on('save-worktree-sort-order', async (data) => {
    const repoPath = resolveRepositoryPath({
      rid: data.prid,
      repositoryPath: data.parentRepoPath,
    });
    if (!repoPath) return;

    const parentRepoPath = getMainRepoPath(repoPath);
    const prid = repositoryIdManager.tryGetId(parentRepoPath);

    const result = await processManager.worktreeSortOrderManager.save(
      parentRepoPath,
      data.orderedPaths
    );
    if (!result.ok) {
      socket.emit('worktree-sort-order-saved', {
        success: false,
        message: result.error.message,
        prid,
        parentRepoPath,
      });
      return;
    }

    socket.emit('worktree-sort-order-saved', {
      success: true,
      prid,
      parentRepoPath,
    });

    // 並び順を適用した最新一覧を全クライアントへ通知
    const cached = worktreeCache.get(parentRepoPath);
    const worktrees = cached?.worktrees ?? (await getWorktrees(parentRepoPath));
    ctx.io.emit(
      'worktrees-list',
      await buildWorktreesListPayload(worktrees, parentRepoPath)
    );
  });

  // ワークツリーのメモを保存
  socket.on('save-worktree-memo', async (data) => {
    const worktreePath = repositoryIdManager.getPath(data.rid);
    if (!worktreePath) return;

    const result = await processManager.worktreeMemoManager.save(
      worktreePath,
      data.memo ?? ''
    );
    if (!result.ok) {
      socket.emit('worktree-memo-saved', {
        success: false,
        message: result.error.message,
        rid: data.rid,
      });
      return;
    }

    socket.emit('worktree-memo-saved', { success: true, rid: data.rid });

    // メモを同梱した最新一覧を全クライアントへ通知
    const parentRepoPath = getMainRepoPath(worktreePath);
    const cached = worktreeCache.get(parentRepoPath);
    const worktrees = cached?.worktrees ?? (await getWorktrees(parentRepoPath));
    ctx.io.emit(
      'worktrees-list',
      await buildWorktreesListPayload(worktrees, parentRepoPath)
    );
  });
}
