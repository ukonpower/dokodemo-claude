import { spawn } from 'child_process';
import type { HandlerContext } from './types.js';
import type {
  GitDiffFile,
  GitDiffSummary,
  GitDiffDetail,
} from '../types/index.js';
import { repositoryIdManager } from '../services/repository-id-manager.js';
import { cleanChildEnv } from '../utils/clean-env.js';

/**
 * Git diffサマリーを取得
 * git diff --name-status と git diff --numstat を組み合わせて使用
 * また git status --porcelain でuntrackedファイルも取得
 */
async function getGitDiffSummary(repoPath: string): Promise<GitDiffSummary> {
  // git diff --name-status でファイル状態を取得
  const nameStatus = await runGitCommand(repoPath, ['diff', '--name-status']);
  // git diff --numstat で追加・削除行数を取得
  const numstat = await runGitCommand(repoPath, ['diff', '--numstat']);
  // git status --porcelain でuntrackedファイルを取得
  const statusPorcelain = await runGitCommand(repoPath, [
    'status',
    '--porcelain',
  ]);

  const files: GitDiffFile[] = [];
  let totalAdditions = 0;
  let totalDeletions = 0;

  // 処理済みファイルを追跡
  const processedFiles = new Set<string>();

  // name-statusの結果をパース
  const statusLines = nameStatus.split('\n').filter((line) => line.trim());
  const statusMap = new Map<
    string,
    { status: 'A' | 'M' | 'D' | 'R'; oldFilename?: string }
  >();

  for (const line of statusLines) {
    const parts = line.split('\t');
    if (parts.length >= 2) {
      const statusChar = parts[0].charAt(0);
      let status: 'A' | 'M' | 'D' | 'R';
      let filename: string;
      let oldFilename: string | undefined;

      switch (statusChar) {
        case 'A':
          status = 'A';
          filename = parts[1];
          break;
        case 'D':
          status = 'D';
          filename = parts[1];
          break;
        case 'R':
          status = 'R';
          oldFilename = parts[1];
          filename = parts[2] || parts[1];
          break;
        default:
          status = 'M';
          filename = parts[1];
      }

      statusMap.set(filename, { status, oldFilename });
    }
  }

  // numstatの結果をパース
  const numstatLines = numstat.split('\n').filter((line) => line.trim());

  for (const line of numstatLines) {
    const parts = line.split('\t');
    if (parts.length >= 3) {
      const additions = parts[0] === '-' ? 0 : parseInt(parts[0], 10) || 0;
      const deletions = parts[1] === '-' ? 0 : parseInt(parts[1], 10) || 0;
      const filename = parts[2];

      const statusInfo = statusMap.get(filename) || { status: 'M' as const };

      files.push({
        filename,
        status: statusInfo.status,
        additions,
        deletions,
        oldFilename: statusInfo.oldFilename,
      });

      totalAdditions += additions;
      totalDeletions += deletions;

      // 処理済みファイルを記録
      processedFiles.add(filename);
      statusMap.delete(filename);
    }
  }

  // numstatにないがname-statusにあるファイル（バイナリファイルなど）を追加
  for (const [filename, statusInfo] of statusMap) {
    files.push({
      filename,
      status: statusInfo.status,
      additions: 0,
      deletions: 0,
      oldFilename: statusInfo.oldFilename,
    });
    processedFiles.add(filename);
  }

  // git status --porcelain からuntrackedファイルを追加
  const porcelainLines = statusPorcelain
    .split('\n')
    .filter((line) => line.trim());
  for (const line of porcelainLines) {
    // 形式: XY filename (XY = 2文字のステータス)
    if (line.length < 4) continue;

    const indexStatus = line.charAt(0);
    const worktreeStatus = line.charAt(1);
    const filename = line.substring(3).trim();

    // すでに処理済みのファイルはスキップ
    if (processedFiles.has(filename)) continue;

    // untrackedファイル (??)
    if (indexStatus === '?' && worktreeStatus === '?') {
      files.push({
        filename,
        status: 'U',
        additions: 0,
        deletions: 0,
      });
      processedFiles.add(filename);
    }
  }

  return {
    files,
    totalAdditions,
    totalDeletions,
  };
}

/**
 * ファイルがuntrackedかどうかを確認
 */
async function isUntrackedFile(
  repoPath: string,
  filename: string
): Promise<boolean> {
  const status = await runGitCommand(repoPath, [
    'status',
    '--porcelain',
    '--',
    filename,
  ]);
  return status.startsWith('??');
}

/**
 * 特定ファイルのGit diff詳細を取得
 */
async function getGitDiffDetail(
  repoPath: string,
  filename: string
): Promise<GitDiffDetail> {
  // まずuntrackedファイルかどうかを確認
  const untracked = await isUntrackedFile(repoPath, filename);

  let diff: string;
  if (untracked) {
    // untrackedファイルの場合、git diff --no-index を使用
    try {
      diff = await runGitCommand(repoPath, [
        'diff',
        '--no-index',
        '/dev/null',
        filename,
      ]);
    } catch {
      // git diff --no-index は差分がある場合にexit code 1を返すので、
      // エラーでも出力があればそれを使用
      diff = await runGitCommandAllowNonZero(repoPath, [
        'diff',
        '--no-index',
        '/dev/null',
        filename,
      ]);
    }
  } else {
    diff = await runGitCommand(repoPath, ['diff', '--', filename]);
  }

  return {
    filename,
    diff,
  };
}

/**
 * Gitコマンドを実行するヘルパー関数
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
        reject(new Error(stderr || `Git command failed with code ${code}`));
      }
    });

    gitProcess.on('error', (err) => {
      reject(err);
    });
  });
}

/**
 * Gitコマンドを実行するヘルパー関数（非ゼロのexit codeを許容）
 * git diff --no-index は差分がある場合にexit code 1を返すため
 */
function runGitCommandAllowNonZero(
  repoPath: string,
  args: string[]
): Promise<string> {
  return new Promise((resolve, reject) => {
    const gitProcess = spawn('git', args, {
      cwd: repoPath,
      env: cleanChildEnv(),
    });
    let stdout = '';

    gitProcess.stdout.on('data', (data) => {
      stdout += data.toString();
    });

    gitProcess.on('exit', () => {
      resolve(stdout);
    });

    gitProcess.on('error', (err) => {
      reject(err);
    });
  });
}

/**
 * Socket.IOイベントハンドラーを登録
 */
export function registerDiffHandlers(ctx: HandlerContext): void {
  const { socket } = ctx;

  // 差分サマリー取得
  socket.on('get-git-diff-summary', async (data) => {
    const { rid } = data;

    const repoPath = repositoryIdManager.getPath(rid);

    try {
      const summary = await getGitDiffSummary(repoPath);
      socket.emit('git-diff-summary', { rid, summary });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : '差分の取得に失敗しました';
      socket.emit('git-diff-error', { rid, message });
    }
  });

  // 差分詳細取得
  socket.on('get-git-diff-detail', async (data) => {
    const { rid, filename } = data;

    const repoPath = repositoryIdManager.getPath(rid);

    try {
      const detail = await getGitDiffDetail(repoPath, filename);
      socket.emit('git-diff-detail', { rid, filename, detail });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : '差分の取得に失敗しました';
      socket.emit('git-diff-error', { rid, message });
    }
  });
}
