/**
 * ワークツリー同期処理
 * 設定エントリに従って worktree へコピーまたはシンボリックリンクを作成する。
 */

import path from 'path';
import { promises as fs } from 'fs';
import type {
  WorktreeSyncEntry,
  WorktreeSyncResult,
} from '../types/index.js';

async function copyRecursive(src: string, dest: string): Promise<void> {
  const stat = await fs.lstat(src);
  if (stat.isSymbolicLink()) {
    const linkTarget = await fs.readlink(src);
    await fs.symlink(linkTarget, dest);
    return;
  }
  if (stat.isDirectory()) {
    await fs.mkdir(dest, { recursive: true });
    const entries = await fs.readdir(src);
    for (const name of entries) {
      await copyRecursive(path.join(src, name), path.join(dest, name));
    }
    return;
  }
  await fs.copyFile(src, dest);
}

async function applyEntry(
  parentRepoPath: string,
  worktreePath: string,
  entry: WorktreeSyncEntry
): Promise<WorktreeSyncResult> {
  const src = path.join(parentRepoPath, entry.path);
  const dest = path.join(worktreePath, entry.path);

  try {
    await fs.access(src);
  } catch {
    return {
      path: entry.path,
      mode: entry.mode,
      success: false,
      error: '親リポジトリに対象が存在しません',
    };
  }

  try {
    // 既存の dest があれば一旦削除（コピー/リンクで上書きするため）
    try {
      await fs.rm(dest, { recursive: true, force: true });
    } catch {
      // 失敗しても続行
    }

    // 親ディレクトリは worktree 直下とは限らない（将来のサブパス対応を考慮）
    await fs.mkdir(path.dirname(dest), { recursive: true });

    if (entry.mode === 'link') {
      // 絶対パスでシンボリックリンクを作成
      await fs.symlink(src, dest);
    } else {
      await copyRecursive(src, dest);
    }
    return { path: entry.path, mode: entry.mode, success: true };
  } catch (e) {
    return {
      path: entry.path,
      mode: entry.mode,
      success: false,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

/**
 * 設定エントリに従って worktree 側にコピー/リンクを実行する。
 * 各エントリの成否はレスポンスに含める（失敗しても処理は続行）。
 */
export async function applySyncEntries(
  parentRepoPath: string,
  worktreePath: string,
  entries: WorktreeSyncEntry[]
): Promise<WorktreeSyncResult[]> {
  const results: WorktreeSyncResult[] = [];
  for (const entry of entries) {
    results.push(await applyEntry(parentRepoPath, worktreePath, entry));
  }
  return results;
}
