import { spawn } from 'child_process';
import type { HandlerContext } from './types.js';
import { repositoryIdManager } from '../services/repository-id-manager.js';
import { cleanChildEnv } from '../utils/clean-env.js';

/**
 * Gitコマンドを実行するヘルパー関数
 * diff-handlers.ts と同じ spawn ラップ（cwd + cleanChildEnv）
 */
function runGitCommand(repoPath: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const gitProcess = spawn('git', args, {
      cwd: repoPath,
      env: cleanChildEnv(),
    });
    let stdout = '';
    let stderr = '';

    gitProcess.stdout.on('data', (data) => {
      stdout += data.toString();
    });

    gitProcess.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    gitProcess.on('exit', (code) => {
      if (code === 0) {
        resolve(stdout);
      } else {
        // conflict 等はメッセージが stdout に出るため両方を見る
        reject(
          new Error(
            stderr.trim() ||
              stdout.trim() ||
              `Git command failed with code ${code}`
          )
        );
      }
    });

    gitProcess.on('error', (err) => {
      reject(err);
    });
  });
}

/**
 * 登録済み remote 名の一覧を取得する（push 先選択用）
 */
async function getRemotes(repoPath: string): Promise<string[]> {
  try {
    const out = await runGitCommand(repoPath, ['remote']);
    return out
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0);
  } catch {
    return [];
  }
}

/**
 * Git操作（pull / push / fetch / remotes 一覧）の Socket.IO イベントハンドラーを登録
 */
export function registerGitActionHandlers(ctx: HandlerContext): void {
  const { socket } = ctx;

  // remotes 一覧取得（push 先選択用に単体で提供）
  socket.on('git-remotes', async (data) => {
    const { rid } = data;
    const repoPath = repositoryIdManager.getPath(rid);
    const remotes = await getRemotes(repoPath);
    socket.emit('git-remotes-result', { rid, remotes });
  });

  // pull（現在のブランチを upstream から pull）
  socket.on('git-pull', async (data) => {
    const { rid } = data;
    const repoPath = repositoryIdManager.getPath(rid);
    try {
      await runGitCommand(repoPath, ['pull']);
      socket.emit('git-action-result', {
        rid,
        action: 'pull',
        success: true,
        message: 'pull しました',
      });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'pull に失敗しました';
      socket.emit('git-action-result', {
        rid,
        action: 'pull',
        success: false,
        message,
      });
    }
  });

  // push（現在のブランチを指定 remote / upstream に push）
  socket.on('git-push', async (data) => {
    const { rid, remote, force, setUpstream } = data;
    const repoPath = repositoryIdManager.getPath(rid);
    try {
      // remote は必ず実在する登録済み remote に限定する（オプションインジェクション防止）
      let target: string | null = null;
      if (remote) {
        const remotes = await getRemotes(repoPath);
        if (!remotes.includes(remote)) {
          throw new Error(`remote "${remote}" が見つかりません`);
        }
        target = remote;
      }

      const args = ['push'];
      if (force) args.push('--force-with-lease');
      // -u は remote/ref 指定とセットでしか使えないため target がある時のみ付与
      if (setUpstream && target) args.push('-u');
      // remote 指定時は `push [-u] <remote> HEAD`、未指定時は追跡先へ暗黙 push
      if (target) args.push(target, 'HEAD');
      await runGitCommand(repoPath, args);
      const dest = target ? ` (${target})` : '';
      socket.emit('git-action-result', {
        rid,
        action: 'push',
        success: true,
        message: force ? `force push しました${dest}` : `push しました${dest}`,
      });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'push に失敗しました';
      socket.emit('git-action-result', {
        rid,
        action: 'push',
        success: false,
        message,
      });
    }
  });

  // fetch（全 remote から fetch）
  socket.on('git-fetch', async (data) => {
    const { rid, prune } = data;
    const repoPath = repositoryIdManager.getPath(rid);
    try {
      const args = ['fetch', '--all'];
      if (prune) args.push('--prune');
      await runGitCommand(repoPath, args);
      socket.emit('git-action-result', {
        rid,
        action: 'fetch',
        success: true,
        message: 'fetch しました',
      });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'fetch に失敗しました';
      socket.emit('git-action-result', {
        rid,
        action: 'fetch',
        success: false,
        message,
      });
    }
  });
}
