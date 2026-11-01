import { spawn } from 'child_process';
import { cleanChildEnv } from '../utils/clean-env.js';
import type { SelfBranch } from '../types/index.js';

/**
 * dokodemo-claude 自身のリポジトリに対する git 操作をまとめたサービス。
 *
 * - 更新先として選べるブランチ（main + 未マージの release/*）の列挙
 * - 指定ブランチへの切り替えを含む最新化（更新ボタンの実体）
 *
 * 切り替え時は追跡ファイルのローカル変更を破棄する（npm install で
 * package-lock.json が書き換わるため、素の switch はほぼ必ず失敗するため）。
 * untracked ファイル（.env など）には手を触れない。
 */

export interface SelfGitResult {
  code: number | null;
  stdout: string;
  stderr: string;
}

/**
 * 自身のリポジトリで git コマンドを実行する（タイムアウト付き）
 */
export function runSelfGit(
  repoRoot: string,
  args: string[],
  timeoutMs: number
): Promise<SelfGitResult> {
  return new Promise((resolve) => {
    const gitProcess = spawn('git', args, {
      cwd: repoRoot,
      env: cleanChildEnv(),
    });
    let stdout = '';
    let stderr = '';
    let settled = false;

    const settle = (code: number | null): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ code, stdout, stderr });
    };

    const timer = setTimeout(() => {
      gitProcess.kill('SIGTERM');
      settle(null);
    }, timeoutMs);

    gitProcess.stdout.on('data', (data) => {
      stdout += data.toString();
    });
    gitProcess.stderr.on('data', (data) => {
      stderr += data.toString();
    });
    gitProcess.on('error', () => settle(null));
    gitProcess.on('exit', (code) => settle(code));
  });
}

/**
 * release/vX.Y.Z のバージョンを比較用の数値配列にする（数値でない部分は 0 扱い）
 */
function parseReleaseVersion(name: string): number[] {
  const match = name.match(/release\/v?(\d+)\.(\d+)\.(\d+)/);
  if (!match) return [0, 0, 0];
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

function compareReleaseDesc(a: string, b: string): number {
  const va = parseReleaseVersion(a);
  const vb = parseReleaseVersion(b);
  for (let i = 0; i < 3; i++) {
    if (va[i] !== vb[i]) return vb[i] - va[i];
  }
  return b.localeCompare(a);
}

/**
 * 現在チェックアウト中のブランチ名を取得する（detached HEAD 等では空文字）
 */
async function getCurrentBranch(repoRoot: string): Promise<string> {
  const result = await runSelfGit(
    repoRoot,
    ['rev-parse', '--abbrev-ref', 'HEAD'],
    5000
  );
  if (result.code !== 0) return '';
  const name = result.stdout.trim();
  return name === 'HEAD' ? '' : name;
}

/**
 * origin/<branch> に対して未取り込みのコミット数を取得する
 */
async function getBehindCount(
  repoRoot: string,
  branch: string
): Promise<number> {
  const result = await runSelfGit(
    repoRoot,
    ['rev-list', '--count', `HEAD..origin/${branch}`],
    10000
  );
  if (result.code !== 0) return 0;
  const count = parseInt(result.stdout.trim(), 10);
  return Number.isFinite(count) ? count : 0;
}

/**
 * 更新先として選べるブランチ一覧を返す。
 *
 * 候補は main と「main へ未マージの release/*」のみ（運用上この 2 種しか選ばない）。
 * 現在チェックアウト中のブランチが候補に無い場合（feature ブランチで動かしている等）は
 * 先頭に足して、そのまま最新化できるようにする。
 */
export async function getSelfBranches(repoRoot: string): Promise<{
  success: boolean;
  current: string;
  branches: SelfBranch[];
  message?: string;
}> {
  // fetch 失敗（オフライン等）は無視し、手元の remote-tracking ref で組み立てる
  await runSelfGit(repoRoot, ['fetch', '--prune', '--quiet'], 30000);

  const current = await getCurrentBranch(repoRoot);

  // origin/HEAD は "origin" として混ざるため refname から剥がして除外する
  const refsResult = await runSelfGit(
    repoRoot,
    ['for-each-ref', '--format=%(refname)', 'refs/remotes/origin'],
    10000
  );
  if (refsResult.code !== 0) {
    return {
      success: false,
      current,
      branches: [],
      message: 'リモートブランチの一覧取得に失敗しました',
    };
  }
  const remoteBranches = refsResult.stdout
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.startsWith('refs/remotes/origin/'))
    .map((line) => line.slice('refs/remotes/origin/'.length))
    .filter((name) => name && name !== 'HEAD');

  // main に取り込み済みの release は候補から外す
  const mergedResult = await runSelfGit(
    repoRoot,
    ['branch', '-r', '--merged', 'origin/main', '--list', 'origin/release/*'],
    10000
  );
  const mergedReleases = new Set(
    mergedResult.stdout
      .split('\n')
      .map((line) => line.trim().replace(/^origin\//, ''))
      .filter(Boolean)
  );

  const releases = remoteBranches
    .filter((name) => name.startsWith('release/') && !mergedReleases.has(name))
    .sort(compareReleaseDesc);

  const names = [
    ...(remoteBranches.includes('main') ? ['main'] : []),
    ...releases,
  ];
  if (current && !names.includes(current)) {
    names.unshift(current);
  }

  const branches = await Promise.all(
    names.map(async (name) => ({
      name,
      isCurrent: name === current,
      // リモートに無いブランチ（ローカル専用）は比較できないので 0 のまま
      behind: remoteBranches.includes(name)
        ? await getBehindCount(repoRoot, name)
        : 0,
    }))
  );

  return { success: true, current, branches };
}

/**
 * 自身を最新化する。branch 指定時はそのブランチへ切り替えてから最新化する。
 *
 * 追跡ファイルのローカル変更（package-lock.json 等）は破棄する。
 * ローカルコミットが分岐している場合は fast-forward できないためエラーにする。
 */
export async function updateSelf(
  repoRoot: string,
  branch?: string
): Promise<{
  success: boolean;
  message: string;
  output: string;
  branch: string;
  branchChanged: boolean;
}> {
  const logs: string[] = [];
  const record = (label: string, result: SelfGitResult): void => {
    const text = `${result.stdout}${result.stderr}`.trim();
    logs.push(text ? `$ git ${label}\n${text}` : `$ git ${label}`);
  };

  const fetchResult = await runSelfGit(repoRoot, ['fetch', '--prune'], 60000);
  record('fetch --prune', fetchResult);
  if (fetchResult.code !== 0) {
    return {
      success: false,
      message: 'git fetch に失敗しました',
      output: logs.join('\n\n'),
      branch: '',
      branchChanged: false,
    };
  }

  const current = await getCurrentBranch(repoRoot);
  const target = branch?.trim() || current;
  if (!target) {
    return {
      success: false,
      message: 'ブランチが特定できませんでした（detached HEAD の可能性があります）',
      output: logs.join('\n\n'),
      branch: '',
      branchChanged: false,
    };
  }

  const remoteExists = await runSelfGit(
    repoRoot,
    ['rev-parse', '--verify', '--quiet', `refs/remotes/origin/${target}`],
    5000
  );
  if (remoteExists.code !== 0) {
    return {
      success: false,
      message: `origin/${target} が見つかりません`,
      output: logs.join('\n\n'),
      branch: target,
      branchChanged: false,
    };
  }

  // npm install で package-lock.json が書き換わっている前提なので、
  // switch / merge の前に追跡ファイルの変更を破棄する（untracked は残す）
  const resetResult = await runSelfGit(repoRoot, ['reset', '--hard'], 30000);
  record('reset --hard', resetResult);

  const branchChanged = target !== current;
  if (branchChanged) {
    const localExists = await runSelfGit(
      repoRoot,
      ['rev-parse', '--verify', '--quiet', `refs/heads/${target}`],
      5000
    );
    const switchArgs =
      localExists.code === 0
        ? ['switch', target]
        : ['switch', '--track', `origin/${target}`];
    const switchResult = await runSelfGit(repoRoot, switchArgs, 60000);
    record(switchArgs.join(' '), switchResult);
    if (switchResult.code !== 0) {
      return {
        success: false,
        message: `${target} への切り替えに失敗しました`,
        output: logs.join('\n\n'),
        branch: target,
        branchChanged: false,
      };
    }
  }

  const mergeResult = await runSelfGit(
    repoRoot,
    ['merge', '--ff-only', `origin/${target}`],
    60000
  );
  record(`merge --ff-only origin/${target}`, mergeResult);
  if (mergeResult.code !== 0) {
    return {
      success: false,
      message: `origin/${target} へ fast-forward できませんでした（ローカルコミットが分岐している可能性があります）`,
      output: logs.join('\n\n'),
      branch: target,
      branchChanged,
    };
  }

  // 既存ローカルブランチで upstream が未設定でも更新チェックが働くようにしておく
  await runSelfGit(
    repoRoot,
    ['branch', '--set-upstream-to', `origin/${target}`, target],
    5000
  );

  return {
    success: true,
    message: '',
    output: logs.join('\n\n'),
    branch: target,
    branchChanged,
  };
}
