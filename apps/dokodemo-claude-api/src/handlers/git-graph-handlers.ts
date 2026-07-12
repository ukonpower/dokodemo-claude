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

/** 未コミット変更を表すセンチネル hash（クライアントの UNCOMMITTED_HASH と合わせる） */
const UNCOMMITTED_HASH = '*';

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
        // merge conflict 等はメッセージが stdout に出るため両方を見る
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

/**
 * 他の worktree がチェックアウト中のローカルブランチ refname の集合を返す。
 * `git worktree list --porcelain` の `branch refs/heads/xxx` 行を集める。
 * 現在の worktree 自身のブランチ（currentRef）は 'head' 扱いなので除外する。
 */
async function getWorktreeCheckedOutRefs(
  repoPath: string,
  currentRef: string | null
): Promise<Set<string>> {
  const refs = new Set<string>();
  try {
    const out = await runGitCommand(repoPath, [
      'worktree',
      'list',
      '--porcelain',
    ]);
    for (const line of out.split('\n')) {
      if (!line.startsWith('branch ')) continue;
      const refname = line.slice('branch '.length).trim();
      if (refname && refname !== currentRef) refs.add(refname);
    }
  } catch {
    // worktree 非対応・失敗時は空集合（印を付けないだけ）
  }
  return refs;
}

async function buildRefIndex(
  repoPath: string,
  currentRef: string | null,
  worktreeRefs: Set<string>
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
    let worktree = false;
    if (refname.startsWith('refs/heads/')) {
      name = refname.slice('refs/heads/'.length);
      // 現在ブランチは type 'head' として強調
      type = currentRef && refname === currentRef ? 'head' : 'branch';
      // 他の worktree がチェックアウト中のブランチには印を付ける
      worktree = type === 'branch' && worktreeRefs.has(refname);
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

    const ref: GitGraphRef = worktree ? { name, type, worktree } : { name, type };
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
      currentBranch: null,
      uncommitted: null,
      branchOptions: [],
      remotes: await getRemotes(repoPath),
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
  const currentBranch =
    currentRef && currentRef.startsWith('refs/heads/')
      ? currentRef.slice('refs/heads/'.length)
      : null;

  const worktreeRefs = await getWorktreeCheckedOutRefs(repoPath, currentRef);
  const refIndex = await buildRefIndex(repoPath, currentRef, worktreeRefs);

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
    currentBranch,
    uncommitted,
    branchOptions: refIndex.branchOptions,
    remotes: await getRemotes(repoPath),
    moreAvailable,
  };
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
 * checkout / merge の positional 引数として安全な名前かを確認する
 * （オプションインジェクション・制御文字混入の防止）
 */
function isSafeRefArg(name: string): boolean {
  return (
    name.length > 0 &&
    !name.startsWith('-') &&
    // eslint-disable-next-line no-control-regex
    !/[\s\x00-\x1f]/.test(name)
  );
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
  // -U999999: 全行をコンテキストに含め、行を飛ばさないdiffを返す（左右分割表示用）
  let diff = await runGitCommandAllowNonZero(repoPath, [
    'diff',
    '-U999999',
    `${hash}^!`,
    '--',
    ...pathspec,
  ]);

  // 初回コミット等で空になる場合は diff-tree にフォールバック
  if (!diff.trim()) {
    diff = await runGitCommandAllowNonZero(repoPath, [
      'diff-tree',
      '-p',
      '-U999999',
      '--root',
      hash,
      '--',
      ...pathspec,
    ]);
  }

  return { filename, diff };
}

/**
 * `git status --porcelain=v1 -z` の XY コードから GitGraphFileChange.status を判定する
 */
function statusFromCode(x: string, y: string): GitGraphFileChange['status'] {
  if (x === '?' && y === '?') return 'A'; // untracked を「追加」相当で表示
  if (x === 'R' || y === 'R') return 'R';
  if (x === 'D' || y === 'D') return 'D';
  if (x === 'A' || y === 'A') return 'A';
  return 'M';
}

/**
 * 未コミット変更（作業ツリー + index）を GitGraphCommitDetail として返す。
 * hash に UNCOMMITTED_HASH（'*'）を入れ、parents は HEAD にする。
 */
async function getUncommittedDetail(
  repoPath: string
): Promise<GitGraphCommitDetail> {
  let headHash = '';
  try {
    headHash = (await runGitCommand(repoPath, ['rev-parse', 'HEAD'])).trim();
  } catch {
    headHash = '';
  }

  // -z: XY + SP + path + NUL、rename の場合は続けて orig_path + NUL
  const statusOut = await runGitCommand(repoPath, [
    'status',
    '--porcelain=v1',
    '-z',
    '--untracked-files=all',
  ]);

  const files: GitGraphFileChange[] = [];
  const tokens = statusOut.split(NUL);
  // 末尾は空文字になるので末尾要素は空扱い
  for (let i = 0; i < tokens.length; i++) {
    const entry = tokens[i];
    if (!entry || entry.length < 3) continue;
    const x = entry.charAt(0);
    const y = entry.charAt(1);
    const path = entry.slice(3); // 3 文字目は SP
    const status = statusFromCode(x, y);
    let filename = path;
    let oldFilename: string | undefined;
    if (x === 'R' || y === 'R' || x === 'C' || y === 'C') {
      // 直後のエントリが rename 元
      const orig = tokens[i + 1];
      if (orig) {
        oldFilename = orig;
        i += 1;
      }
    }
    files.push({
      filename,
      oldFilename,
      status,
      additions: 0,
      deletions: 0,
    });
  }

  // numstat（tracked の add/del）で埋める。untracked は対象外
  if (headHash) {
    try {
      const numstatOut = await runGitCommand(repoPath, [
        'diff',
        'HEAD',
        '--numstat',
        '--find-renames',
      ]);
      const numMap = new Map<
        string,
        { additions: number; deletions: number }
      >();
      for (const line of numstatOut.split('\n')) {
        if (!line.trim()) continue;
        const cols = line.split('\t');
        if (cols.length < 3) continue;
        const additions = cols[0] === '-' ? 0 : parseInt(cols[0], 10) || 0;
        const deletions = cols[1] === '-' ? 0 : parseInt(cols[1], 10) || 0;
        const pathField =
          cols.length >= 4 ? cols[cols.length - 1] : numstatNewPath(cols[2]);
        numMap.set(pathField, { additions, deletions });
      }
      for (const f of files) {
        const n = numMap.get(f.filename);
        if (n) {
          f.additions = n.additions;
          f.deletions = n.deletions;
        }
      }
    } catch {
      // numstat 失敗時は 0 のまま
    }
  }

  return {
    hash: UNCOMMITTED_HASH,
    parents: headHash ? [headHash] : [],
    author: '',
    email: '',
    authorDate: 0,
    committer: '',
    commitDate: 0,
    body: 'Uncommitted Changes',
    files,
  };
}

/**
 * 未コミット変更 1 ファイル分の diff を取得する（HEAD → 作業ツリー）。
 * - 追跡外（untracked）は `diff --no-index /dev/null <file>` で全行追加として返す
 */
async function getUncommittedFileDiff(
  repoPath: string,
  filename: string,
  oldFilename?: string
): Promise<GitDiffDetail> {
  const pathspec = oldFilename ? [oldFilename, filename] : [filename];
  // HEAD → 作業ツリー（staged/unstaged 両方を含む）
  let diff = await runGitCommandAllowNonZero(repoPath, [
    'diff',
    'HEAD',
    '-U999999',
    '--',
    ...pathspec,
  ]);

  if (!diff.trim()) {
    // untracked / HEAD 不在（空リポジトリ）等は no-index で全行追加として表示
    diff = await runGitCommandAllowNonZero(repoPath, [
      'diff',
      '--no-index',
      '-U999999',
      '--',
      '/dev/null',
      filename,
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
      const detail =
        hash === UNCOMMITTED_HASH
          ? await getUncommittedDetail(repoPath)
          : await getGitGraphCommitDetail(repoPath, hash);
      socket.emit('git-graph-commit-detail', { rid, hash, detail });
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : 'コミット詳細の取得に失敗しました';
      socket.emit('git-graph-error', { rid, message });
    }
  });

  // チェックアウト（ローカルブランチ / リモートブランチ / コミット）
  socket.on('git-graph-checkout', async (data) => {
    const { rid, kind, name, localName } = data;
    const repoPath = repositoryIdManager.getPath(rid);
    try {
      if (!isSafeRefArg(name)) {
        throw new Error(`不正な名前です: ${name}`);
      }
      if (kind === 'remote') {
        // origin/foo → foo をデフォルトのローカルブランチ名にする
        const local = localName ?? name.split('/').slice(1).join('/');
        if (!isSafeRefArg(local)) {
          throw new Error(`不正なブランチ名です: ${local}`);
        }
        await runGitCommand(repoPath, [
          'checkout',
          '-b',
          local,
          '--track',
          name,
        ]);
      } else {
        await runGitCommand(repoPath, ['checkout', name]);
      }
      socket.emit('git-graph-action-result', {
        rid,
        action: 'checkout',
        success: true,
        message: `チェックアウトしました: ${name}`,
      });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'チェックアウトに失敗しました';
      socket.emit('git-graph-action-result', {
        rid,
        action: 'checkout',
        success: false,
        message,
      });
    }
  });

  // マージ（現在のブランチへ target をマージ）
  socket.on('git-graph-merge', async (data) => {
    const { rid, target, noFF, squash, noCommit } = data;
    const repoPath = repositoryIdManager.getPath(rid);
    try {
      if (!isSafeRefArg(target)) {
        throw new Error(`不正な名前です: ${target}`);
      }
      const args = ['merge'];
      if (squash) {
        args.push('--squash');
      } else if (noFF) {
        args.push('--no-ff');
      }
      if (noCommit) args.push('--no-commit');
      args.push(target);
      await runGitCommand(repoPath, args);
      socket.emit('git-graph-action-result', {
        rid,
        action: 'merge',
        success: true,
        message: `マージしました: ${target}`,
      });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'マージに失敗しました';
      socket.emit('git-graph-action-result', {
        rid,
        action: 'merge',
        success: false,
        message,
      });
    }
  });

  // remotes 一覧取得（グラフ未表示でも push 先選択できるよう単体で提供）
  socket.on('git-graph-remotes', async (data) => {
    const { rid } = data;
    const repoPath = repositoryIdManager.getPath(rid);
    const remotes = await getRemotes(repoPath);
    socket.emit('git-graph-remotes-result', { rid, remotes });
  });

  // pull（現在のブランチを upstream から pull）
  socket.on('git-graph-pull', async (data) => {
    const { rid } = data;
    const repoPath = repositoryIdManager.getPath(rid);
    try {
      await runGitCommand(repoPath, ['pull']);
      socket.emit('git-graph-action-result', {
        rid,
        action: 'pull',
        success: true,
        message: 'pull しました',
      });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'pull に失敗しました';
      socket.emit('git-graph-action-result', {
        rid,
        action: 'pull',
        success: false,
        message,
      });
    }
  });

  // push（現在のブランチを指定 remote / upstream に push）
  socket.on('git-graph-push', async (data) => {
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
      socket.emit('git-graph-action-result', {
        rid,
        action: 'push',
        success: true,
        message: force ? `force push しました${dest}` : `push しました${dest}`,
      });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'push に失敗しました';
      socket.emit('git-graph-action-result', {
        rid,
        action: 'push',
        success: false,
        message,
      });
    }
  });

  // fetch（origin から fetch）
  socket.on('git-graph-fetch', async (data) => {
    const { rid, prune } = data;
    const repoPath = repositoryIdManager.getPath(rid);
    try {
      const args = ['fetch', '--all'];
      if (prune) args.push('--prune');
      await runGitCommand(repoPath, args);
      socket.emit('git-graph-action-result', {
        rid,
        action: 'fetch',
        success: true,
        message: 'fetch しました',
      });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'fetch に失敗しました';
      socket.emit('git-graph-action-result', {
        rid,
        action: 'fetch',
        success: false,
        message,
      });
    }
  });

  // ファイル diff 取得
  socket.on('get-git-graph-file-diff', async (data) => {
    const { rid, hash, filename, oldFilename } = data;
    const repoPath = repositoryIdManager.getPath(rid);
    try {
      const detail =
        hash === UNCOMMITTED_HASH
          ? await getUncommittedFileDiff(repoPath, filename, oldFilename)
          : await getGitGraphFileDiff(repoPath, hash, filename, oldFilename);
      socket.emit('git-graph-file-diff', { rid, hash, detail });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'diff の取得に失敗しました';
      socket.emit('git-graph-error', { rid, message });
    }
  });
}
