import { spawn } from 'child_process';
import { promises as fs } from 'fs';
import path from 'path';
import type { HandlerContext } from './types.js';
import type { GitRepository } from '../types/index.js';
import { PersistenceService } from '../services/persistence-service.js';
import { repositoryIdManager } from '../services/repository-id-manager.js';
import { emitIdMappingUpdated } from './id-mapping-helpers.js';
import { cleanChildEnv } from '../utils/clean-env.js';
import { getWorktrees, getWorktreeInfo } from '../utils/git-utils.js';
import { fileManager } from '../services/file-manager.js';
import type { ProcessManager } from '../process-manager.js';

// 最終アクセス時刻を保存するファイル名（processes/ 配下に永続化）
const REPO_LAST_ACCESS_FILE = 'repo-last-access.json';

/**
 * 最終アクセス時刻を読み込む
 *
 * 読み込みに失敗（ファイル破損・パースエラー・I/O エラー）した場合は null を返す。
 * 呼び出し元はこの結果を save に流用してはならない（既存データを上書きしてしまうため）。
 * 「ファイルが存在しない」だけは正常系として空オブジェクトを返す。
 */
async function loadRepoLastAccess(
  persistence: PersistenceService
): Promise<Record<string, number> | null> {
  const result = await persistence.load<Record<string, number>>(
    REPO_LAST_ACCESS_FILE
  );
  if (!result.ok) return null;
  return result.value ?? {};
}

/**
 * 最終アクセス時刻を保存する
 */
async function saveRepoLastAccess(
  persistence: PersistenceService,
  data: Record<string, number>
): Promise<void> {
  await persistence.save(REPO_LAST_ACCESS_FILE, data);
}

/**
 * リポジトリ一覧を「最近開いた順」でソートして送信するヘルパー
 *
 * 並び順はサーバー側で確定させ、フロントは受け取った配列をそのまま描画する。
 */
async function emitReposList(
  socket: HandlerContext['socket'],
  repositories: GitRepository[],
  persistence: PersistenceService
): Promise<void> {
  // 読み込み失敗時はソートキー無しとして扱い、配列順そのままで返す。
  // ここで {} を保存し直してはいけない（破損ファイルを正常データで上書きしてしまう）。
  const lastAccessTimes = (await loadRepoLastAccess(persistence)) ?? {};
  const sortedRepos = [...repositories].sort((a, b) => {
    const tA = lastAccessTimes[a.path] || 0;
    const tB = lastAccessTimes[b.path] || 0;
    return tB - tA;
  });
  socket.emit('repos-list', { repos: sortedRepos });
}

/**
 * 削除済みの worktree パスから親リポジトリを推測する。
 *
 * `getMainRepoPath` は `.git` の gitlink 判定をするが、worktree が既に
 * 削除されたケースではディレクトリ自体が存在しないため判定できない。
 * このため純粋にパス文字列だけで親を推測する。誤った推測を避けるため、
 * 推測結果が実在しなければ `fallbackParentExists: false` を返し、
 * クライアント側で home へ戻すなどの判断ができるようにする。
 */
async function resolveDeletedWorktreeFallback(repoPath: string): Promise<{
  fallbackParentPath?: string;
  fallbackParentExists?: boolean;
}> {
  let parentPath: string | undefined;

  // 旧構造: {親}/.worktrees/{ブランチ}
  if (repoPath.includes('/.worktrees/')) {
    const head = repoPath.split('/.worktrees/')[0];
    if (head) parentPath = head;
  }

  // 新構造: {親_dir}/.dokodemo-worktrees/{プロジェクト名}/{ブランチ}
  if (!parentPath) {
    const match = repoPath.match(
      /^(.+)\/\.dokodemo-worktrees\/([^/]+)\/[^/]+/
    );
    if (match) {
      parentPath = path.resolve(match[1], match[2]);
    }
  }

  if (!parentPath || parentPath === repoPath) return {};

  let fallbackParentExists = false;
  try {
    const stat = await fs.stat(parentPath);
    fallbackParentExists = stat.isDirectory();
  } catch {
    fallbackParentExists = false;
  }

  return { fallbackParentPath: parentPath, fallbackParentExists };
}

/**
 * リポジトリ削除に伴う永続データの後始末。
 *
 * ディレクトリを消しただけでは uploads・ワークツリーのメモ・並び順・同期設定・
 * リポジトリ固有のカスタム送信ボタンが残り続けるため、まとめて破棄する。
 * どれか一つが失敗しても残りは処理する（掃除漏れよりは部分成功を優先）。
 */
async function cleanupRepositoryPersistedData(
  processManager: ProcessManager,
  repoPath: string,
  worktreePaths: string[],
  persistence: PersistenceService
): Promise<void> {
  // アップロードファイル（本体 + 各ワークツリー）
  for (const target of [repoPath, ...worktreePaths]) {
    const rid = repositoryIdManager.tryGetId(target);
    if (rid) await fileManager.removeRepositoryUploads(rid);
  }

  // 評価リクエスト（受信箱は親リポジトリ単位。添付画像は uploads ごと消えている）
  {
    const rid = repositoryIdManager.tryGetId(repoPath);
    if (rid) {
      await processManager.reviewRequestManager
        .removeRepository(rid)
        .catch(() => {});
    }
  }

  // ワークツリーのメモ
  for (const worktreePath of worktreePaths) {
    await processManager.worktreeMemoManager
      .remove(worktreePath)
      .catch(() => {});
  }

  // ワークツリーの並び順・同期設定（親リポジトリ単位）
  await processManager.worktreeSortOrderManager.remove(repoPath).catch(() => {});
  await processManager.worktreeSyncManager.remove(repoPath).catch(() => {});

  // リポジトリ固有のカスタム送信ボタン（本体 + 各ワークツリー）
  for (const target of [repoPath, ...worktreePaths]) {
    await processManager.customAiButtonManager
      .removeByRepository(target)
      .catch(() => {});
  }

  // 最終アクセス時刻
  const lastAccessTimes = await loadRepoLastAccess(persistence);
  if (lastAccessTimes) {
    let changed = false;
    for (const target of [repoPath, ...worktreePaths]) {
      if (target in lastAccessTimes) {
        delete lastAccessTimes[target];
        changed = true;
      }
    }
    if (changed) await saveRepoLastAccess(persistence, lastAccessTimes);
  }
}

/**
 * リポジトリ関連のSocket.IOイベントハンドラーを登録
 */
export function registerRepositoryHandlers(ctx: HandlerContext): void {
  const {
    socket,
    repositories,
    reposDir,
    processManager,
    persistenceService,
    loadExistingRepos,
  } = ctx;

  // リポジトリ一覧の送信
  socket.on('list-repos', async () => {
    await loadExistingRepos();
    await emitReposList(socket, repositories, persistenceService);
  });

  // ディレクトリの存在確認（前回開いた worktree が削除されていないかの判定用）
  // exists=false の場合、パス形状から worktree の親リポジトリを推測し、
  // その親リポの存在確認結果も同梱する。クライアントは「削除済み worktree
  // → 親リポへ自動フォールバック」を 1 往復で実現できる。
  socket.on('check-repo-path', async (data) => {
    const { path: repoPath } = data;
    if (!repoPath) {
      socket.emit('repo-path-checked', { path: repoPath, exists: false });
      return;
    }
    try {
      const stat = await fs.stat(repoPath);
      const exists = stat.isDirectory();
      if (exists) {
        socket.emit('repo-path-checked', { path: repoPath, exists: true });
        return;
      }
      const fallback = await resolveDeletedWorktreeFallback(repoPath);
      socket.emit('repo-path-checked', {
        path: repoPath,
        exists: false,
        ...fallback,
      });
    } catch {
      const fallback = await resolveDeletedWorktreeFallback(repoPath);
      socket.emit('repo-path-checked', {
        path: repoPath,
        exists: false,
        ...fallback,
      });
    }
  });

  // リポジトリアクセス時刻の更新
  socket.on('update-repo-access', async (data) => {
    const { path: repoPath } = data;
    try {
      const lastAccessTimes = await loadRepoLastAccess(persistenceService);
      // 読み込み失敗時は save をスキップ。空オブジェクトで上書きすると
      // 全リポジトリのアクセス履歴が消えてソート順がリセットされてしまう。
      if (lastAccessTimes === null) {
        console.error(
          'リポジトリアクセス時刻の読み込みに失敗したため更新をスキップしました'
        );
        return;
      }
      lastAccessTimes[repoPath] = Date.now();
      await saveRepoLastAccess(persistenceService, lastAccessTimes);
    } catch (error) {
      console.error('リポジトリアクセス時刻の更新エラー:', error);
    }
  });

  // リポジトリのプロセス状態を取得
  socket.on('get-repos-process-status', () => {
    const repositoryData = repositories.map((repo) => ({
      path: repo.path,
      rid: repositoryIdManager.getId(repo.path),
    }));
    const statuses =
      processManager.getAllRepositoriesProcessStatus(repositoryData);
    socket.emit('repos-process-status', { statuses });
  });

  // リポジトリの削除
  socket.on('delete-repo', async (data) => {
    const { path: repoPath, name } = data;

    try {
      const repoIndex = repositories.findIndex((r) => r.path === repoPath);
      if (repoIndex === -1) {
        // ワークツリーは repositories に載らない。素の rm で消すと親リポジトリ側に
        // 登録が残るため、ここでは削除せずワークツリー削除へ誘導する。
        const isWorktree = getWorktreeInfo(repoPath).isWorktree;
        socket.emit('repo-deleted', {
          success: false,
          message: isWorktree
            ? 'ワークツリーはここからは削除できません。ワークツリータブの削除を使ってください'
            : `リポジトリ「${name}」が見つかりません`,
          path: repoPath,
        });
        return;
      }

      // ワークツリーは親リポジトリの外（.dokodemo-worktrees 配下）にあるため、
      // 親を消しただけでは gitdir が壊れた状態で取り残される。先に列挙しておく。
      const worktreePaths = (await getWorktrees(repoPath).catch(() => []))
        .filter((wt) => !wt.isMain && wt.path !== repoPath)
        .map((wt) => wt.path);

      // プロセス停止は削除前に行う（PTY が消えたディレクトリを掴んだままになるのを防ぐ）
      for (const worktreePath of worktreePaths) {
        await processManager.cleanupRepositoryProcesses(worktreePath);
      }
      await processManager.cleanupRepositoryProcesses(repoPath);

      await fs.rm(repoPath, { recursive: true, force: true });
      for (const worktreePath of worktreePaths) {
        await fs.rm(worktreePath, { recursive: true, force: true });
      }
      // ワークツリーの親ディレクトリ（.dokodemo-worktrees/<プロジェクト名>）ごと掃除。
      // 表示名（クライアント指定）ではなく実パスから引く
      const worktreeRoot = repositoryIdManager.getPath(
        `wt:${path.basename(repoPath)}`
      );
      await fs.rm(worktreeRoot, { recursive: true, force: true }).catch(() => {});

      repositories.splice(repoIndex, 1);

      await cleanupRepositoryPersistedData(
        processManager,
        repoPath,
        worktreePaths,
        persistenceService
      );

      // 全クライアントに最新の id-mapping を通知
      await emitIdMappingUpdated(ctx.io, repositories);

      socket.emit('repo-deleted', {
        success: true,
        message:
          worktreePaths.length > 0
            ? `リポジトリ「${name}」とワークツリー${worktreePaths.length}件を削除しました`
            : `リポジトリ「${name}」を削除しました`,
        path: repoPath,
      });
      emitReposList(socket, repositories, persistenceService);
    } catch {
      socket.emit('repo-deleted', {
        success: false,
        message: `リポジトリ削除エラー`,
        path: repoPath,
      });
    }
  });

  // リポジトリのプロセスを停止（リポジトリは削除しない）
  socket.on('stop-repo-processes', async (data) => {
    const { rid } = data;

    try {
      // ridからrepositoryPathを取得
      const repositoryPath = repositoryIdManager.getPath(rid);
      const exists = await fs
        .access(repositoryPath)
        .then(() => true)
        .catch(() => false);
      if (!exists) {
        socket.emit('repo-processes-stopped', {
          success: false,
          message: `リポジトリID「${rid}」が見つかりません`,
          rid,
          aiSessionsClosed: 0,
          terminalsClosed: 0,
        });
        return;
      }

      const result =
        await processManager.stopRepositoryProcesses(repositoryPath);

      socket.emit('repo-processes-stopped', {
        success: result.success,
        message: result.success
          ? `プロセスを停止しました（AIセッション: ${result.aiSessionsClosed}件、ターミナル: ${result.terminalsClosed}件）`
          : 'プロセスの停止中にエラーが発生しました',
        rid,
        aiSessionsClosed: result.aiSessionsClosed,
        terminalsClosed: result.terminalsClosed,
      });
    } catch (error) {
      socket.emit('repo-processes-stopped', {
        success: false,
        message: `プロセス停止エラー: ${error}`,
        rid,
        aiSessionsClosed: 0,
        terminalsClosed: 0,
      });
    }
  });

  // リポジトリのクローン
  socket.on('clone-repo', async (data) => {
    const { url, name } = data;
    const repoPath = path.join(reposDir, name);

    try {
      const existingRepo = repositories.find((r) => r.name === name);
      if (existingRepo) {
        socket.emit('repo-cloned', {
          success: false,
          message: `リポジトリ「${name}」は既に存在します`,
        });
        return;
      }

      const newRepo: GitRepository = {
        name,
        url,
        path: repoPath,
        status: 'cloning',
      };
      repositories.push(newRepo);
      emitReposList(socket, repositories, persistenceService);

      const gitProcess = spawn('git', ['clone', url, repoPath], {
        env: cleanChildEnv(),
      });

      const cloneTimeout = setTimeout(() => {
        gitProcess.kill('SIGTERM');
        const repo = repositories.find((r) => r.name === name);
        if (repo) {
          repo.status = 'error';
          socket.emit('repo-cloned', {
            success: false,
            message: `リポジトリ「${name}」のクローンがタイムアウトしました`,
          });
          emitReposList(socket, repositories, persistenceService);
        }
      }, 600000);

      gitProcess.on('exit', (code) => {
        clearTimeout(cloneTimeout);
        const repo = repositories.find((r) => r.name === name);
        if (repo) {
          if (code === 0) {
            repo.status = 'ready';
            // 全クライアントに最新の id-mapping を通知
            void emitIdMappingUpdated(ctx.io, repositories);
            socket.emit('repo-cloned', {
              success: true,
              message: `リポジトリ「${name}」のクローンが完了しました`,
              repo,
            });
          } else {
            repo.status = 'error';
            socket.emit('repo-cloned', {
              success: false,
              message: `リポジトリ「${name}」のクローンに失敗しました`,
            });
          }
          emitReposList(socket, repositories, persistenceService);
        }
      });
    } catch {
      socket.emit('repo-cloned', {
        success: false,
        message: `クローンエラー`,
      });
    }
  });

  // 新規リポジトリの作成 (git init)
  socket.on('create-repo', async (data) => {
    const { name } = data;
    const repoPath = path.join(reposDir, name);

    try {
      const existingRepo = repositories.find((r) => r.name === name);
      if (existingRepo) {
        socket.emit('repo-created', {
          success: false,
          message: `リポジトリ「${name}」は既に存在します`,
        });
        return;
      }

      await fs.mkdir(repoPath, { recursive: true });

      const newRepo: GitRepository = {
        name,
        url: '',
        path: repoPath,
        status: 'creating',
      };
      repositories.push(newRepo);
      emitReposList(socket, repositories, persistenceService);

      const gitInitProcess = spawn('git', ['init'], {
        cwd: repoPath,
        env: cleanChildEnv(),
      });

      const initTimeout = setTimeout(() => {
        gitInitProcess.kill('SIGTERM');
        const repo = repositories.find((r) => r.name === name);
        if (repo) {
          repo.status = 'error';
          socket.emit('repo-created', {
            success: false,
            message: `リポジトリ「${name}」の作成がタイムアウトしました`,
          });
          emitReposList(socket, repositories, persistenceService);
        }
      }, 30000);

      gitInitProcess.on('exit', (code) => {
        clearTimeout(initTimeout);
        const repo = repositories.find((r) => r.name === name);
        if (repo) {
          if (code === 0) {
            repo.status = 'ready';
            // 全クライアントに最新の id-mapping を通知
            void emitIdMappingUpdated(ctx.io, repositories);
            socket.emit('repo-created', {
              success: true,
              message: `リポジトリ「${name}」を作成しました`,
              repo,
            });
          } else {
            repo.status = 'error';
            socket.emit('repo-created', {
              success: false,
              message: `リポジトリ「${name}」の作成に失敗しました`,
            });
          }
          emitReposList(socket, repositories, persistenceService);
        }
      });
    } catch {
      socket.emit('repo-created', {
        success: false,
        message: `作成エラー`,
      });
    }
  });
}
