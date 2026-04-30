import * as fs from 'fs';
import * as path from 'path';
import type { TypedServer } from '../handlers/types.js';
import { getBranches } from '../utils/git-utils.js';
import { repositoryIdManager } from './repository-id-manager.js';

interface WatcherEntry {
  watcher: fs.FSWatcher;
  repoPath: string;
  debounceTimer?: ReturnType<typeof setTimeout>;
}

const watchers = new Map<string, WatcherEntry>();
const DEBOUNCE_MS = 200;

/**
 * 指定された repoPath から HEAD ファイルの絶対パスを解決する
 * - 通常リポジトリ: <repo>/.git/HEAD
 * - worktree: <repo>/.git は "gitdir: <main>/.git/worktrees/<name>" を指すファイル
 *   実体は <main>/.git/worktrees/<name>/HEAD
 */
function resolveHeadFile(repoPath: string): string | null {
  try {
    const gitPath = path.join(repoPath, '.git');
    const stat = fs.statSync(gitPath);
    if (stat.isDirectory()) {
      return path.join(gitPath, 'HEAD');
    }
    // worktree の場合: .git はファイルで gitdir: ... が書かれている
    const content = fs.readFileSync(gitPath, 'utf-8');
    const m = content.match(/^gitdir:\s*(.+)$/m);
    if (!m) return null;
    const gitdir = m[1].trim();
    const absGitdir = path.isAbsolute(gitdir)
      ? gitdir
      : path.resolve(repoPath, gitdir);
    return path.join(absGitdir, 'HEAD');
  } catch {
    return null;
  }
}

/**
 * 指定リポジトリの HEAD ファイルを監視し、変更があれば branches-list を broadcast
 */
export function startBranchWatching(repoPath: string, io: TypedServer): void {
  const rid = repositoryIdManager.tryGetId(repoPath);
  if (!rid) return;
  if (watchers.has(rid)) return;

  const headFile = resolveHeadFile(repoPath);
  if (!headFile) return;

  try {
    // HEAD ファイル自体ではなく親ディレクトリを監視（macOS の fs.watch 対策）
    const watchDir = path.dirname(headFile);
    const headBasename = path.basename(headFile);
    const watcher = fs.watch(watchDir, (_eventType, filename) => {
      if (filename !== headBasename) return;
      const entry = watchers.get(rid);
      if (!entry) return;
      if (entry.debounceTimer) clearTimeout(entry.debounceTimer);
      entry.debounceTimer = setTimeout(async () => {
        try {
          const branches = await getBranches(repoPath);
          io.emit('branches-list', { branches, rid });
        } catch {
          // 取得失敗時は何もしない
        }
      }, DEBOUNCE_MS);
    });

    watcher.on('error', (err) => {
      console.error(`[branch-watcher] rid=${rid} エラー:`, err.message);
      stopBranchWatching(rid);
    });

    watchers.set(rid, { watcher, repoPath });
  } catch (error) {
    console.error(`[branch-watcher] 監視開始失敗: rid=${rid}`, error);
  }
}

export function stopBranchWatching(rid: string): void {
  const entry = watchers.get(rid);
  if (!entry) return;
  if (entry.debounceTimer) clearTimeout(entry.debounceTimer);
  entry.watcher.close();
  watchers.delete(rid);
}

export function stopAllBranchWatching(): void {
  for (const rid of Array.from(watchers.keys())) {
    stopBranchWatching(rid);
  }
}
