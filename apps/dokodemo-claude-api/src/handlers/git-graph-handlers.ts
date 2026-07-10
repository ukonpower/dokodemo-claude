import { spawn } from 'child_process';
import type { HandlerContext } from './types.js';
import type {
  GitGraphData,
  GitGraphCommit,
  GitGraphRef,
  GitGraphCommitDetail,
  GitGraphFileChange,
  GitDiffDetail,
} from '../types/index.js';
import { repositoryIdManager } from '../services/repository-id-manager.js';
import { cleanChildEnv } from '../utils/clean-env.js';

const NUL = '\x00';

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
        reject(new Error(stderr || `Git command failed with code ${code}`));
      }
    });

    gitProcess.on('error', (err) => {
      reject(err);
    });
  });
}

/**
 * Gitコマンドを実行するヘルパー関数（非ゼロexit codeを許容）
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
 * for-each-ref の結果を解析する。
 * - refname → SHA→GitGraphRef[] のマップを構築（各コミットへ埋め込む用）
 * - branchOptions（ローカル→リモート順）
 * - 表示名 → refname のマップ（ブランチ絞り込み時に既知refのみ許可する用）
 */
interface RefIndex {
  refsBySha: Map<string, GitGraphRef[]>;
  branchOptions: { name: string; isRemote: boolean }[];
  displayNameToRefName: Map<string, string>;
}

async function buildRefIndex(
  repoPath: string,
  currentRef: string | null
): Promise<RefIndex> {
  const out = await runGitCommand(repoPath, [
    'for-each-ref',
    'refs/heads',
    'refs/tags',
    'refs/remotes',
    '--format=%(refname)%00%(objectname)%00%(*objectname)',
  ]);

  const refsBySha = new Map<string, GitGraphRef[]>();
  const localBranches: { name: string; isRemote: boolean }[] = [];
  const remoteBranches: { name: string; isRemote: boolean }[] = [];
  const displayNameToRefName = new Map<string, string>();

  const lines = out.split('\n').filter((line) => line.length > 0);
  for (const line of lines) {
    const [refname, objectname, peeledObjectname] = line.split(NUL);
    if (!refname) continue;

    // annotated tag は %(*objectname) が指すコミットを対象にする
    const targetSha =
      peeledObjectname && peeledObjectname.length > 0
        ? peeledObjectname
        : objectname;

    let type: GitGraphRef['type'];
    let name: string;
    if (refname.startsWith('refs/heads/')) {
      name = refname.slice('refs/heads/'.length);
      // 現在ブランチは type 'head' として強調
      type = currentRef && refname === currentRef ? 'head' : 'branch';
      localBranches.push({ name, isRemote: false });
      displayNameToRefName.set(name, refname);
    } else if (refname.startsWith('refs/remotes/')) {
      name = refname.slice('refs/remotes/'.length);
      // origin/HEAD は除外
      if (name.endsWith('/HEAD')) continue;
      type = 'remote';
      remoteBranches.push({ name, isRemote: true });
      displayNameToRefName.set(name, refname);
    } else if (refname.startsWith('refs/tags/')) {
      name = refname.slice('refs/tags/'.length);
      type = 'tag';
      displayNameToRefName.set(name, refname);
    } else {
      continue;
    }

    const ref: GitGraphRef = { name, type };
    const list = refsBySha.get(targetSha);
    if (list) {
      list.push(ref);
    } else {
      refsBySha.set(targetSha, [ref]);
    }
  }

  return {
    refsBySha,
    branchOptions: [...localBranches, ...remoteBranches],
    displayNameToRefName,
  };
}

/**
 * コミットグラフ用のデータを取得
 */
async function getGitGraph(
  repoPath: string,
  branches: string[] | null,
  maxCommits: number
): Promise<GitGraphData> {
  // HEAD の SHA（空リポジトリなら取得失敗 → commits 空で返す）
  let headHash = '';
  try {
    headHash = (await runGitCommand(repoPath, ['rev-parse', 'HEAD'])).trim();
  } catch {
    return {
      commits: [],
      headHash: '',
      uncommitted: null,
      branchOptions: [],
      moreAvailable: false,
    };
  }

  // 現在ブランチの ref 名（detached なら null）
  let currentRef: string | null = null;
  try {
    currentRef = (
      await runGitCommand(repoPath, ['symbolic-ref', '-q', 'HEAD'])
    ).trim();
    if (!currentRef) currentRef = null;
  } catch {
    currentRef = null;
  }

  const refIndex = await buildRefIndex(repoPath, currentRef);

  // ref 部分の引数を決める
  let refArgs: string[];
  if (branches === null) {
    refArgs = ['--branches', '--tags', '--remotes', 'HEAD'];
  } else {
    // for-each-ref に存在する表示名のみを refname へ解決して positional 引数に渡す
    // （不明な名前・オプション風の値は無視。オプションインジェクション防止）
    const resolved: string[] = [];
    for (const b of branches) {
      const refname = refIndex.displayNameToRefName.get(b);
      if (refname) resolved.push(refname);
    }
    // 何も解決できなければ HEAD にフォールバック（空グラフを避ける）
    refArgs = resolved.length > 0 ? resolved : ['HEAD'];
  }

  const logOut = await runGitCommand(repoPath, [
    'log',
    ...refArgs,
    '--date-order',
    `--max-count=${maxCommits + 1}`,
    // %x00 は git format 上で NUL を出力する指定
    '--pretty=format:%H%x00%P%x00%an%x00%ae%x00%at%x00%s',
  ]);

  const rawLines = logOut.split('\n').filter((line) => line.length > 0);
  const moreAvailable = rawLines.length > maxCommits;
  const lines = moreAvailable ? rawLines.slice(0, maxCommits) : rawLines;

  const commits: GitGraphCommit[] = lines.map((line) => {
    const parts = line.split(NUL);
    const hash = parts[0] ?? '';
    const parentStr = parts[1] ?? '';
    const author = parts[2] ?? '';
    const email = parts[3] ?? '';
    const at = parts[4] ?? '';
    const message = parts[5] ?? '';
    const parents = parentStr.split(' ').filter((p) => p.length > 0);
    return {
      hash,
      parents,
      author,
      email,
      date: parseInt(at, 10) || 0,
      message,
      refs: refIndex.refsBySha.get(hash) ?? [],
    };
  });

  // uncommitted（作業ツリーの変更ファイル数）
  const statusOut = await runGitCommand(repoPath, [
    'status',
    '--porcelain',
    '--untracked-files=all',
  ]);
  const changedCount = statusOut
    .split('\n')
    .filter((line) => line.trim().length > 0).length;
  const uncommitted = changedCount > 0 ? { fileCount: changedCount } : null;

  return {
    commits,
    headHash,
    uncommitted,
    branchOptions: refIndex.branchOptions,
    moreAvailable,
  };
}

/**
 * numstat のパスフィールドから rename 後（新）ファイル名を復元する。
 * 例: `dir/{old => new}/f.txt` → `dir/new/f.txt`、`old.txt => new.txt` → `new.txt`
 */
function numstatNewPath(p: string): string {
  const brace = p.match(/^(.*)\{(.*) => (.*)\}(.*)$/);
  if (brace) return `${brace[1]}${brace[3]}${brace[4]}`;
  const arrow = p.match(/^(.*) => (.*)$/);
  if (arrow) return arrow[2];
  return p;
}

/**
 * コミット詳細（メッセージ・author/committer・変更ファイル一覧）を取得
 */
async function getGitGraphCommitDetail(
  repoPath: string,
  hash: string
): Promise<GitGraphCommitDetail> {
  const showOut = await runGitCommand(repoPath, [
    'show',
    '--no-patch',
    '--pretty=format:%H%x00%P%x00%an%x00%ae%x00%at%x00%cn%x00%ct%x00%B',
    hash,
  ]);
  // %B は改行を含むため最終フィールド。先頭 7 個で split し、残りを body にする
  const parts = showOut.split(NUL);
  const resolvedHash = parts[0] ?? hash;
  const parentStr = parts[1] ?? '';
  const author = parts[2] ?? '';
  const email = parts[3] ?? '';
  const authorAt = parts[4] ?? '';
  const committer = parts[5] ?? '';
  const commitAt = parts[6] ?? '';
  const body = parts.slice(7).join(NUL).replace(/\n+$/, '');
  const parents = parentStr.split(' ').filter((p) => p.length > 0);

  // name-status と numstat を組み合わせて変更ファイルを構築
  const nameStatusOut = await runGitCommand(repoPath, [
    'diff-tree',
    '-r',
    '--root',
    '--find-renames',
    '--no-commit-id',
    '--name-status',
    hash,
  ]);
  const numstatOut = await runGitCommand(repoPath, [
    'diff-tree',
    '-r',
    '--root',
    '--find-renames',
    '--no-commit-id',
    '--numstat',
    hash,
  ]);

  // numstat: 新ファイル名 → { additions, deletions }
  const numstatMap = new Map<
    string,
    { additions: number; deletions: number }
  >();
  for (const line of numstatOut.split('\n')) {
    if (!line.trim()) continue;
    const cols = line.split('\t');
    if (cols.length < 3) continue;
    const additions = cols[0] === '-' ? 0 : parseInt(cols[0], 10) || 0;
    const deletions = cols[1] === '-' ? 0 : parseInt(cols[1], 10) || 0;
    // rename は `add\tdel\told\tnew`（-z 無し）または brace/arrow 形式
    const pathField =
      cols.length >= 4 ? cols[cols.length - 1] : numstatNewPath(cols[2]);
    numstatMap.set(pathField, { additions, deletions });
  }

  const files: GitGraphFileChange[] = [];
  for (const line of nameStatusOut.split('\n')) {
    if (!line.trim()) continue;
    const cols = line.split('\t');
    const statusChar = cols[0].charAt(0); // R100 → R に正規化
    let status: GitGraphFileChange['status'];
    let filename: string;
    let oldFilename: string | undefined;
    switch (statusChar) {
      case 'A':
        status = 'A';
        filename = cols[1];
        break;
      case 'D':
        status = 'D';
        filename = cols[1];
        break;
      case 'R':
        status = 'R';
        oldFilename = cols[1];
        filename = cols[2] || cols[1];
        break;
      default:
        status = 'M';
        filename = cols[1];
    }
    const nums = numstatMap.get(filename) || { additions: 0, deletions: 0 };
    files.push({
      filename,
      oldFilename,
      status,
      additions: nums.additions,
      deletions: nums.deletions,
    });
  }

  return {
    hash: resolvedHash,
    parents,
    author,
    email,
    authorDate: parseInt(authorAt, 10) || 0,
    committer,
    commitDate: parseInt(commitAt, 10) || 0,
    body,
    files,
  };
}

/**
 * コミット内の特定ファイルの diff を取得（既存 GitDiffDetail 形式）
 */
async function getGitGraphFileDiff(
  repoPath: string,
  hash: string,
  filename: string,
  oldFilename?: string
): Promise<GitDiffDetail> {
  const pathspec = oldFilename ? [oldFilename, filename] : [filename];

  // hash^! = そのコミット単体の diff（親との差分）
  let diff = await runGitCommandAllowNonZero(repoPath, [
    'diff',
    `${hash}^!`,
    '--',
    ...pathspec,
  ]);

  // 初回コミット等で空になる場合は diff-tree にフォールバック
  if (!diff.trim()) {
    diff = await runGitCommandAllowNonZero(repoPath, [
      'diff-tree',
      '-p',
      '--root',
      hash,
      '--',
      ...pathspec,
    ]);
  }

  return { filename, diff };
}

/**
 * Socket.IOイベントハンドラーを登録
 */
export function registerGitGraphHandlers(ctx: HandlerContext): void {
  const { socket } = ctx;

  // コミットグラフ取得
  socket.on('get-git-graph', async (data) => {
    const { rid, branches, maxCommits } = data;
    const repoPath = repositoryIdManager.getPath(rid);
    try {
      const graph = await getGitGraph(repoPath, branches, maxCommits);
      socket.emit('git-graph', { rid, graph });
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : 'コミットグラフの取得に失敗しました';
      socket.emit('git-graph-error', { rid, message });
    }
  });

  // コミット詳細取得
  socket.on('get-git-graph-commit-detail', async (data) => {
    const { rid, hash } = data;
    const repoPath = repositoryIdManager.getPath(rid);
    try {
      const detail = await getGitGraphCommitDetail(repoPath, hash);
      socket.emit('git-graph-commit-detail', { rid, hash, detail });
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : 'コミット詳細の取得に失敗しました';
      socket.emit('git-graph-error', { rid, message });
    }
  });

  // ファイル diff 取得
  socket.on('get-git-graph-file-diff', async (data) => {
    const { rid, hash, filename, oldFilename } = data;
    const repoPath = repositoryIdManager.getPath(rid);
    try {
      const detail = await getGitGraphFileDiff(
        repoPath,
        hash,
        filename,
        oldFilename
      );
      socket.emit('git-graph-file-diff', { rid, hash, detail });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'diff の取得に失敗しました';
      socket.emit('git-graph-error', { rid, message });
    }
  });
}
