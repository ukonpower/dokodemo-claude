import { spawn } from 'child_process';
import { promises as fs } from 'fs';
import path from 'path';
import type { HandlerContext } from './types.js';
import type { GitRepository } from '../types/index.js';
import { PersistenceService } from '../services/persistence-service.js';
import { repositoryIdManager } from '../services/repository-id-manager.js';
import { emitIdMappingUpdated } from './id-mapping-helpers.js';
import { cleanChildEnv } from '../utils/clean-env.js';

// 最終アクセス時刻を保存するファイル名（processes/ 配下に永続化）
const REPO_LAST_ACCESS_FILE = 'repo-last-access.json';

/**
 * 最終アクセス時刻を読み込む
 */
async function loadRepoLastAccess(
  persistence: PersistenceService
): Promise<Record<string, number>> {
  const result = await persistence.load<Record<string, number>>(
    REPO_LAST_ACCESS_FILE
  );
  if (!result.ok) return {};
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
  const lastAccessTimes = await loadRepoLastAccess(persistence);
  const sortedRepos = [...repositories].sort((a, b) => {
    const tA = lastAccessTimes[a.path] || 0;
    const tB = lastAccessTimes[b.path] || 0;
    return tB - tA;
  });
  socket.emit('repos-list', { repos: sortedRepos });
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
  socket.on('check-repo-path', async (data) => {
    const { path: repoPath } = data;
    if (!repoPath) {
      socket.emit('repo-path-checked', { path: repoPath, exists: false });
      return;
    }
    try {
      const stat = await fs.stat(repoPath);
      socket.emit('repo-path-checked', {
        path: repoPath,
        exists: stat.isDirectory(),
      });
    } catch {
      socket.emit('repo-path-checked', { path: repoPath, exists: false });
    }
  });

  // リポジトリアクセス時刻の更新
  socket.on('update-repo-access', async (data) => {
    const { path: repoPath } = data;
    try {
      const lastAccessTimes = await loadRepoLastAccess(persistenceService);
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
        socket.emit('repo-deleted', {
          success: false,
          message: `リポジトリ「${name}」が見つかりません`,
          path: repoPath,
        });
        return;
      }

      await fs.rm(repoPath, { recursive: true, force: true });
      repositories.splice(repoIndex, 1);
      await processManager.cleanupRepositoryProcesses(repoPath);

      // 全クライアントに最新の id-mapping を通知
      await emitIdMappingUpdated(ctx.io, repositories);

      socket.emit('repo-deleted', {
        success: true,
        message: `リポジトリ「${name}」を削除しました`,
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
