import { spawn } from 'child_process';
import { promises as fs } from 'fs';
import path from 'path';
import type {
  GitBranch,
  GitWorktree,
  WorktreeCreateRequest,
} from '../types/index.js';
import { cleanChildEnv } from './clean-env.js';

/**
 * 指定されたディレクトリからリポジトリルート（.gitがあるディレクトリ）を探す
 */
export async function findRepositoryRoot(
  startPath: string
): Promise<string | null> {
  let currentPath = path.resolve(startPath);
  const root = path.parse(currentPath).root;

  while (currentPath !== root) {
    try {
      const gitPath = path.join(currentPath, '.git');
      await fs.stat(gitPath);
      // .git がディレクトリ（通常リポジトリ）でもファイル（worktree）でもリポジトリルート
      return currentPath;
    } catch {
      // .gitが見つからない場合は親ディレクトリへ
    }
    currentPath = path.dirname(currentPath);
  }

  return null;
}

/**
 * ブランチ一覧を取得
 */
export async function getBranches(repoPath: string): Promise<GitBranch[]> {
  return new Promise((resolve) => {
    const gitProcess = spawn('git', ['branch', '-a'], {
      cwd: repoPath,
      env: cleanChildEnv(),
    });
    let output = '';

    gitProcess.stdout.on('data', (data) => {
      output += data.toString();
    });

    gitProcess.on('exit', (code) => {
      if (code !== 0) {
        resolve([]);
        return;
      }

      const branches: GitBranch[] = [];
      const lines = output.split('\n').filter((line) => line.trim());

      lines.forEach((line) => {
        const trimmedLine = line.trim();
        const isCurrent = trimmedLine.startsWith('*');
        const branchName = trimmedLine
          .replace(/^[\*\+]?\s+/, '') // * (現在のブランチ), + (ワークツリーで使用中) を除去
          .replace(/^remotes\//, '');

        // リモートブランチは remotes/origin/ で始まる
        if (branchName.startsWith('origin/')) {
          // リモートブランチ（origin/HEADは除外）
          if (!branchName.includes('HEAD')) {
            branches.push({
              name: branchName.replace('origin/', ''),
              current: false,
              remote: 'origin',
            });
          }
        } else {
          // ローカルブランチ
          branches.push({
            name: branchName,
            current: isCurrent,
            remote: undefined,
          });
        }
      });

      // 重複を除去（ローカルブランチを優先）
      const uniqueBranches: GitBranch[] = [];
      const branchNames = new Set<string>();

      // まずローカルブランチを追加
      branches
        .filter((b) => !b.remote)
        .forEach((branch) => {
          uniqueBranches.push(branch);
          branchNames.add(branch.name);
        });

      // リモートブランチのうち、ローカルに存在しないものを追加
      branches
        .filter((b) => b.remote && !branchNames.has(b.name))
        .forEach((branch) => {
          uniqueBranches.push(branch);
        });

      resolve(uniqueBranches);
    });

    gitProcess.on('error', () => {
      resolve([]);
    });
  });
}

/**
 * ブランチを切り替え
 */
export async function switchBranch(
  repoPath: string,
  branchName: string
): Promise<{ success: boolean; message: string }> {
  return new Promise((resolve) => {
    const gitProcess = spawn('git', ['checkout', branchName], {
      cwd: repoPath,
      env: cleanChildEnv(),
    });
    let output = '';
    let errorOutput = '';

    gitProcess.stdout.on('data', (data) => {
      output += data.toString();
    });

    gitProcess.stderr.on('data', (data) => {
      errorOutput += data.toString();
    });

    gitProcess.on('exit', (code) => {
      if (code === 0) {
        resolve({
          success: true,
          message: `ブランチ「${branchName}」に切り替えました`,
        });
      } else {
        resolve({
          success: false,
          message: `ブランチ切り替えエラー: ${errorOutput || output}`,
        });
      }
    });

    gitProcess.on('error', (err) => {
      resolve({
        success: false,
        message: `ブランチ切り替えエラー: ${err.message}`,
      });
    });
  });
}

/**
 * 現在のブランチを pull (--ff-only)
 * fast-forward 不可の場合は git 自身が失敗で抜けるため、
 * 作業ツリーが中途半端なマージ状態になることはない。
 */
export async function pullBranch(
  repoPath: string
): Promise<{ success: boolean; message: string; output: string }> {
  return new Promise((resolve) => {
    const gitProcess = spawn('git', ['pull', '--ff-only'], {
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

    const timeout = setTimeout(() => {
      gitProcess.kill('SIGTERM');
      resolve({
        success: false,
        message: 'git pull がタイムアウトしました',
        output: stdout + stderr,
      });
    }, 60000);

    gitProcess.on('exit', (code) => {
      clearTimeout(timeout);
      if (code === 0) {
        resolve({
          success: true,
          message: 'pull が完了しました',
          output: stdout || stderr,
        });
      } else {
        resolve({
          success: false,
          message: 'pull に失敗しました',
          output: stderr || stdout,
        });
      }
    });

    gitProcess.on('error', (err) => {
      clearTimeout(timeout);
      resolve({
        success: false,
        message: `pull エラー: ${err.message}`,
        output: '',
      });
    });
  });
}

/**
 * ブランチを作成して切り替え (`git checkout -b`)
 */
export async function createBranch(
  repoPath: string,
  branchName: string,
  baseBranch?: string
): Promise<{ success: boolean; message: string }> {
  return new Promise((resolve) => {
    const args = ['checkout', '-b', branchName];
    if (baseBranch) {
      args.push(baseBranch);
    }

    const gitProcess = spawn('git', args, {
      cwd: repoPath,
      env: cleanChildEnv(),
    });
    let errorOutput = '';

    gitProcess.stderr.on('data', (data) => {
      errorOutput += data.toString();
    });

    gitProcess.on('exit', (code) => {
      if (code === 0) {
        resolve({
          success: true,
          message: `ブランチ「${branchName}」を作成して切り替えました`,
        });
      } else {
        resolve({
          success: false,
          message: `ブランチ作成エラー: ${errorOutput.trim() || '不明なエラー'}`,
        });
      }
    });

    gitProcess.on('error', (err) => {
      resolve({
        success: false,
        message: `ブランチ作成エラー: ${err.message}`,
      });
    });
  });
}

/**
 * ワークツリー一覧を取得
 */
export async function getWorktrees(repoPath: string): Promise<GitWorktree[]> {
  return new Promise((resolve) => {
    const gitProcess = spawn('git', ['worktree', 'list', '--porcelain'], {
      cwd: repoPath,
      env: cleanChildEnv(),
    });
    let output = '';

    gitProcess.stdout.on('data', (data) => {
      output += data.toString();
    });

    // closeイベントを使用（exitではなく）
    // exitはプロセス終了時に発火するが、stdoutにまだデータが残っている可能性がある
    // closeはstdioストリームが完全に閉じられた後に発火するので、全データを確実に取得できる
    gitProcess.on('close', (code) => {
      if (code !== 0) {
        resolve([]);
        return;
      }

      const worktrees: GitWorktree[] = [];
      const blocks = output.split('\n\n').filter((b) => b.trim());

      blocks.forEach((block) => {
        const lines = block.split('\n');
        const worktree: Partial<GitWorktree> = { parentRepoPath: repoPath };

        lines.forEach((line) => {
          if (line.startsWith('worktree ')) {
            worktree.path = line.substring(9);
          } else if (line.startsWith('HEAD ')) {
            worktree.head = line.substring(5);
          } else if (line.startsWith('branch ')) {
            worktree.branch = line.substring(7).replace('refs/heads/', '');
          } else if (line === 'bare') {
            // bare repositoryは無視
          } else if (line === 'detached') {
            worktree.branch = 'detached HEAD';
          }
        });

        // メインワークツリーかどうかを判定
        worktree.isMain = worktree.path === repoPath;

        if (worktree.path && worktree.branch && worktree.head) {
          worktrees.push(worktree as GitWorktree);
        }
      });

      resolve(worktrees);
    });

    gitProcess.on('error', () => {
      resolve([]);
    });
  });
}

/**
 * ワークツリーを作成
 */
export async function createWorktree(
  data: WorktreeCreateRequest
): Promise<{ success: boolean; message: string; worktree?: GitWorktree }> {
  const { parentRepoPath, branchName, baseBranch, useExistingBranch } = data;
  const worktreePath = getWorktreePath(parentRepoPath, branchName);

  // ディレクトリが既に存在するかチェック
  try {
    await fs.access(worktreePath);
    return {
      success: false,
      message: `ワークツリー「${branchName}」は既に存在します`,
    };
  } catch {
    // 存在しない場合は続行
  }

  // .dokodemo-worktreesディレクトリを作成（エラーハンドリング追加）
  const worktreesDir = getWorktreeBasePath(parentRepoPath);
  try {
    await fs.mkdir(worktreesDir, { recursive: true });
  } catch (error) {
    return {
      success: false,
      message: `worktreeディレクトリの作成に失敗: ${error instanceof Error ? error.message : '不明なエラー'}`,
    };
  }

  // git worktree add コマンド構築
  const args = ['worktree', 'add'];
  if (useExistingBranch) {
    args.push(worktreePath, branchName);
  } else {
    args.push('-b', branchName, worktreePath);
    if (baseBranch) {
      args.push(baseBranch);
    }
  }

  return new Promise((resolve) => {
    const gitProcess = spawn('git', args, {
      cwd: parentRepoPath,
      env: cleanChildEnv(),
    });
    let stderr = '';

    gitProcess.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    gitProcess.on('exit', async (code) => {
      if (code === 0) {
        const worktrees = await getWorktrees(parentRepoPath);
        const newWorktree = worktrees.find((w) => w.path === worktreePath);
        resolve({
          success: true,
          message: `ワークツリー「${branchName}」を作成しました`,
          worktree: newWorktree,
        });
      } else {
        resolve({
          success: false,
          message: `ワークツリーの作成に失敗しました: ${stderr}`,
        });
      }
    });

    gitProcess.on('error', (err) => {
      resolve({
        success: false,
        message: `ワークツリーの作成に失敗しました: ${err.message}`,
      });
    });
  });
}

/**
 * Gitコマンドを実行するヘルパー関数
 */
function execGitCommand(
  args: string[],
  cwd: string
): Promise<{ code: number; stderr: string }> {
  return new Promise((resolve) => {
    const gitProcess = spawn('git', args, { cwd, env: cleanChildEnv() });
    let stderr = '';

    gitProcess.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    gitProcess.on('close', (code) => {
      resolve({ code: code ?? 1, stderr });
    });

    gitProcess.on('error', (err) => {
      resolve({ code: 1, stderr: err.message });
    });
  });
}

/**
 * ワークツリーを削除
 */
export async function deleteWorktree(
  worktreePath: string,
  parentRepoPath: string,
  options?: { deleteBranch?: boolean; branchName?: string }
): Promise<{ success: boolean; message: string }> {
  // 1. 通常の --force で試行
  let result = await execGitCommand(
    ['worktree', 'remove', worktreePath, '--force'],
    parentRepoPath
  );

  // 2. 失敗した場合、--force --force を試行（ダーティなワークツリーも強制削除）
  if (result.code !== 0) {
    result = await execGitCommand(
      ['worktree', 'remove', worktreePath, '--force', '--force'],
      parentRepoPath
    );
  }

  // 3. それでも失敗した場合、ディレクトリを直接削除
  if (result.code !== 0) {
    try {
      await fs.rm(worktreePath, { recursive: true, force: true });
      await execGitCommand(['worktree', 'prune'], parentRepoPath);
    } catch {
      return { success: false, message: `削除に失敗: ${result.stderr}` };
    }
  } else {
    // Gitの参照をクリーンアップ（失敗しても続行）
    await execGitCommand(['worktree', 'prune'], parentRepoPath);
  }

  // 残存ディレクトリがあれば削除
  await fs.rm(worktreePath, { recursive: true, force: true }).catch(() => {});

  // オプション: ブランチも削除
  if (options?.deleteBranch && options?.branchName) {
    const branchDeleteResult = await deleteBranch(
      parentRepoPath,
      options.branchName
    );
    if (!branchDeleteResult.success) {
      return {
        success: true,
        message: `ワークツリーを削除しました（ブランチ削除に失敗: ${branchDeleteResult.message}）`,
      };
    }
    return {
      success: true,
      message: `ワークツリーとブランチ「${options.branchName}」を削除しました`,
    };
  }

  return { success: true, message: 'ワークツリーを削除しました' };
}

/**
 * ブランチを削除
 */
export async function deleteBranch(
  repoPath: string,
  branchName: string
): Promise<{ success: boolean; message: string }> {
  // 保護されたブランチのチェック（main, master）
  if (branchName === 'main' || branchName === 'master') {
    return {
      success: false,
      message: `ブランチ「${branchName}」は保護されているため削除できません`,
    };
  }

  // 現在のブランチかどうかチェック
  const currentBranch = await getCurrentBranch(repoPath);
  if (currentBranch === branchName) {
    return {
      success: false,
      message: `ブランチ「${branchName}」は現在チェックアウト中のため削除できません`,
    };
  }

  // ワークツリーで使用中かチェック
  const worktrees = await getWorktrees(repoPath);
  const usedByWorktree = worktrees.find((wt) => wt.branch === branchName);
  if (usedByWorktree) {
    return {
      success: false,
      message: `ブランチ「${branchName}」はワークツリーで使用中のため削除できません`,
    };
  }

  // ブランチ削除を実行
  const result = await execGitCommand(['branch', '-D', branchName], repoPath);

  if (result.code === 0) {
    return {
      success: true,
      message: `ブランチ「${branchName}」を削除しました`,
    };
  } else {
    return {
      success: false,
      message: result.stderr.trim() || 'ブランチの削除に失敗しました',
    };
  }
}

/**
 * リモートブランチを削除
 */
export async function deleteRemoteBranch(
  repoPath: string,
  branchName: string,
  remoteName: string = 'origin'
): Promise<{ attempted: boolean; success: boolean; message?: string }> {
  const result = await execGitCommand(
    ['push', remoteName, '--delete', branchName],
    repoPath
  );

  if (result.code === 0) {
    return {
      attempted: true,
      success: true,
      message: `リモートブランチ「${remoteName}/${branchName}」を削除しました`,
    };
  } else {
    // リモートに存在しない場合のエラーを判別
    if (
      result.stderr.includes('remote ref does not exist') ||
      result.stderr.includes('unable to delete') ||
      result.stderr.includes('could not read from remote')
    ) {
      return {
        attempted: true,
        success: false,
        message: `リモートブランチ「${remoteName}/${branchName}」は存在しないか、削除できません`,
      };
    }
    return {
      attempted: true,
      success: false,
      message: result.stderr.trim() || 'リモートブランチの削除に失敗しました',
    };
  }
}

/**
 * 親リポジトリパスを取得（ワークツリーの場合は親を返す）
 */
export function getMainRepoPath(repoPath: string): string {
  // 旧構造: {親}/.worktrees/{ブランチ}
  if (repoPath.includes('/.worktrees/')) {
    return repoPath.split('/.worktrees/')[0];
  }

  // 新構造: {親}/../.dokodemo-worktrees/{プロジェクト名}/{ブランチ}
  const match = repoPath.match(/^(.+?)\/\.dokodemo-worktrees\/([^/]+)\//);
  if (match) {
    // match[1]: {親}のパス, match[2]: プロジェクト名
    return path.resolve(match[1], match[2]);
  }

  return repoPath;
}

/**
 * ワークツリー情報を取得
 * @returns ワークツリーの場合は { isWorktree: true, parentRepoName, worktreeBranch }、それ以外は { isWorktree: false }
 */
export function getWorktreeInfo(repoPath: string): {
  isWorktree: boolean;
  parentRepoName?: string;
  worktreeBranch?: string;
} {
  // 旧構造チェック
  if (repoPath.includes('/.worktrees/')) {
    const parts = repoPath.split('/.worktrees/');
    const parentRepoPath = parts[0];
    const worktreeBranch = parts[1];
    const parentRepoName = path.basename(parentRepoPath);
    return {
      isWorktree: true,
      parentRepoName,
      worktreeBranch,
    };
  }

  // 新構造チェック: {親}/../.dokodemo-worktrees/{プロジェクト名}/{ブランチ}
  const match = repoPath.match(/^(.+?)\/\.dokodemo-worktrees\/([^/]+)\/(.+)$/);
  if (match) {
    const parentRepoName = match[2]; // プロジェクト名
    const worktreeBranch = match[3]; // ブランチ名（スラッシュ含む可能性あり）
    return {
      isWorktree: true,
      parentRepoName,
      worktreeBranch,
    };
  }

  return { isWorktree: false };
}

/**
 * リポジトリのリモートURLを取得
 */
export async function getRemoteUrl(repoPath: string): Promise<string | null> {
  return new Promise((resolve) => {
    const gitProcess = spawn('git', ['config', '--get', 'remote.origin.url'], {
      cwd: repoPath,
      env: cleanChildEnv(),
    });
    let output = '';

    gitProcess.stdout.on('data', (data) => {
      output += data.toString();
    });

    gitProcess.on('exit', (code) => {
      if (code === 0) {
        const remoteUrl = output.trim();
        // HTTPSまたはSSH形式のURLをHTTPSのブラウザURL形式に変換
        // git@github.com:user/repo.git -> https://github.com/user/repo
        // https://github.com/user/repo.git -> https://github.com/user/repo
        let webUrl = remoteUrl;

        if (webUrl.startsWith('git@')) {
          // SSH形式: git@github.com:user/repo.git -> https://github.com/user/repo
          const sshMatch = webUrl.match(/^git@([^:]+):(.+?)(\.git)?$/);
          if (sshMatch) {
            webUrl = `https://${sshMatch[1]}/${sshMatch[2]}`;
          }
        } else if (
          webUrl.startsWith('https://') ||
          webUrl.startsWith('http://')
        ) {
          // HTTPS形式: https://github.com/user/repo.git
          webUrl = webUrl.replace(/\.git$/, '');
        }

        resolve(webUrl);
      } else {
        resolve(null);
      }
    });

    gitProcess.on('error', () => {
      resolve(null);
    });
  });
}

/**
 * package.jsonからnpmスクリプトを取得
 */
export async function getNpmScripts(
  repoPath: string
): Promise<Record<string, string>> {
  try {
    const packageJsonPath = path.join(repoPath, 'package.json');
    const packageJsonContent = await fs.readFile(packageJsonPath, 'utf-8');
    const packageJson = JSON.parse(packageJsonContent);
    return packageJson.scripts || {};
  } catch {
    // package.jsonが存在しない、または読み取れない場合は空のオブジェクトを返す
    return {};
  }
}

/**
 * 現在のブランチ名を取得
 */
export async function getCurrentBranch(
  repoPath: string
): Promise<string | null> {
  return new Promise((resolve) => {
    const gitProcess = spawn('git', ['rev-parse', '--abbrev-ref', 'HEAD'], {
      cwd: repoPath,
      env: cleanChildEnv(),
    });
    let output = '';

    gitProcess.stdout.on('data', (data) => {
      output += data.toString();
    });

    gitProcess.on('exit', (code) => {
      if (code === 0) {
        resolve(output.trim());
      } else {
        resolve(null);
      }
    });

    gitProcess.on('error', () => {
      resolve(null);
    });
  });
}

/**
 * ワークツリーのブランチを親リポジトリの現在のブランチにマージ
 */
export async function mergeWorktreeBranch(
  worktreePath: string,
  parentRepoPath: string
): Promise<{
  success: boolean;
  message: string;
  mergedBranch?: string;
  targetBranch?: string;
  conflictFiles?: string[];
  errorDetails?: string;
}> {
  try {
    // Step 1: ワークツリーのブランチ名を取得
    const worktrees = await getWorktrees(parentRepoPath);
    const worktree = worktrees.find((w) => w.path === worktreePath);

    if (!worktree) {
      return {
        success: false,
        message: 'ワークツリーが見つかりません',
      };
    }

    const worktreeBranch = worktree.branch;

    if (worktreeBranch === 'detached HEAD') {
      return {
        success: false,
        message: 'detached HEAD状態のワークツリーはマージできません',
      };
    }

    // Step 2: 親リポジトリの現在のブランチを取得
    const targetBranch = await getCurrentBranch(parentRepoPath);

    if (!targetBranch) {
      return {
        success: false,
        message: '親リポジトリのブランチを特定できません',
      };
    }

    // Step 3: git merge --no-commit を実行（stderrも捕捉）
    const mergeResult = await new Promise<{ exitCode: number; stderr: string }>(
      (resolve) => {
        const mergeProcess = spawn(
          'git',
          ['merge', '--no-commit', worktreeBranch],
          {
            cwd: parentRepoPath,
            env: cleanChildEnv(),
          }
        );

        let stderrOutput = '';
        mergeProcess.stderr.on('data', (data) => {
          stderrOutput += data.toString();
        });

        mergeProcess.on('exit', (code) => {
          resolve({ exitCode: code ?? 1, stderr: stderrOutput });
        });

        mergeProcess.on('error', (err) => {
          resolve({ exitCode: 1, stderr: err.message });
        });
      }
    );

    // Step 4: コンフリクトチェック
    if (mergeResult.exitCode !== 0) {
      // コンフリクトファイルを取得
      const conflictFiles = await getConflictFiles(parentRepoPath);

      if (conflictFiles.length > 0) {
        // マージを中止
        await abortMerge(parentRepoPath);
        return {
          success: false,
          message: `コンフリクトが発生しました (${conflictFiles.length}ファイル)`,
          conflictFiles,
          errorDetails: mergeResult.stderr.trim() || undefined,
        };
      }

      // コンフリクト以外のエラー
      if (mergeResult.stderr) {
        await abortMerge(parentRepoPath);
        return {
          success: false,
          message: 'マージに失敗しました',
          errorDetails: mergeResult.stderr.trim(),
        };
      }
    }

    // Step 5: コミット（stderrも捕捉）
    const commitMessage = `Merge branch '${worktreeBranch}' into ${targetBranch}`;
    const commitResult = await new Promise<{
      success: boolean;
      stderr: string;
    }>((resolve) => {
      const commitProcess = spawn('git', ['commit', '-m', commitMessage], {
        cwd: parentRepoPath,
        env: cleanChildEnv(),
      });

      let stderrOutput = '';
      commitProcess.stderr.on('data', (data) => {
        stderrOutput += data.toString();
      });

      commitProcess.on('exit', (code) => {
        resolve({ success: code === 0, stderr: stderrOutput });
      });

      commitProcess.on('error', (err) => {
        resolve({ success: false, stderr: err.message });
      });
    });

    if (!commitResult.success) {
      return {
        success: false,
        message: 'マージのコミットに失敗しました',
        errorDetails: commitResult.stderr.trim() || undefined,
      };
    }

    return {
      success: true,
      message: `ブランチ「${worktreeBranch}」を「${targetBranch}」にマージしました`,
      mergedBranch: worktreeBranch,
      targetBranch,
    };
  } catch (error) {
    return {
      success: false,
      message: `マージエラー: ${error instanceof Error ? error.message : '不明なエラー'}`,
      errorDetails: error instanceof Error ? error.stack : undefined,
    };
  }
}

/**
 * コンフリクトファイル一覧を取得
 */
async function getConflictFiles(repoPath: string): Promise<string[]> {
  return new Promise((resolve) => {
    const gitProcess = spawn(
      'git',
      ['diff', '--name-only', '--diff-filter=U'],
      {
        cwd: repoPath,
        env: cleanChildEnv(),
      }
    );
    let output = '';

    gitProcess.stdout.on('data', (data) => {
      output += data.toString();
    });

    gitProcess.on('exit', (code) => {
      if (code === 0 && output.trim()) {
        const files = output.trim().split('\n');
        resolve(files);
      } else {
        resolve([]);
      }
    });

    gitProcess.on('error', () => {
      resolve([]);
    });
  });
}

/**
 * マージを中止
 */
async function abortMerge(repoPath: string): Promise<void> {
  return new Promise((resolve) => {
    const gitProcess = spawn('git', ['merge', '--abort'], {
      cwd: repoPath,
      env: cleanChildEnv(),
    });

    gitProcess.on('exit', () => {
      resolve();
    });

    gitProcess.on('error', () => {
      resolve();
    });
  });
}

/**
 * worktreeの基底ディレクトリパスを取得
 * @returns {親}/../.dokodemo-worktrees/{プロジェクト名}
 */
export function getWorktreeBasePath(parentRepoPath: string): string {
  const projectName = path.basename(parentRepoPath);
  return path.resolve(parentRepoPath, '..', '.dokodemo-worktrees', projectName);
}

/**
 * worktreeの完全なパスを取得
 * @returns {親}/../.dokodemo-worktrees/{プロジェクト名}/{ブランチ名}
 */
export function getWorktreePath(
  parentRepoPath: string,
  branchName: string
): string {
  const basePath = getWorktreeBasePath(parentRepoPath);
  return path.join(basePath, branchName);
}
