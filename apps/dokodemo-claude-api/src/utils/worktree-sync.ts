/**
 * ワークツリー同期処理
 * - 親リポジトリの .gitignore からコピー/リンク候補を抽出
 * - 設定エントリに従って worktree へコピーまたはシンボリックリンクを作成
 */

import path from 'path';
import { promises as fs } from 'fs';
import type {
  WorktreeSyncEntry,
  WorktreeSyncResult,
} from '../types/index.js';

// 通常コピー/リンクの対象にしないことが多い大規模ディレクトリ
const EXCLUDED_NAMES = new Set([
  'node_modules',
  'dist',
  'build',
  '.next',
  '.nuxt',
  '.turbo',
  '.cache',
  '.parcel-cache',
  '.pnpm-store',
  '.yarn',
  'coverage',
  'out',
  'tmp',
  'target',
  '.vite',
  '.expo',
  '.swc',
  '__pycache__',
  '.tox',
  'venv',
  '.venv',
  '.gradle',
  '.terraform',
  '.idea',
  '.DS_Store',
]);

function isLikelyPattern(line: string): boolean {
  return /[*?[\]]/.test(line);
}

function normalizeIgnoreLine(rawLine: string): string | null {
  const line = rawLine.trim();
  if (!line) return null;
  if (line.startsWith('#')) return null;
  if (line.startsWith('!')) return null; // 否定パターンはスキップ
  if (isLikelyPattern(line)) return null;
  // 先頭の / と末尾の / を除去（gitignore 表記）
  let normalized = line.replace(/^\//, '').replace(/\/$/, '');
  if (!normalized) return null;
  // 親参照を含むパスは弾く
  if (normalized.startsWith('..') || normalized.includes('/../')) return null;
  // ネストされたパスは取り扱わない（最上位のみ提案）
  if (normalized.includes('/')) return null;
  return normalized;
}

/**
 * 親リポジトリの .gitignore からエントリを読み、巨大ディレクトリを除外したうえで
 * 「親リポジトリ内で実在する」もののみを候補として返す。
 */
export async function getSyncSuggestions(
  parentRepoPath: string
): Promise<string[]> {
  let ignoreContent = '';
  try {
    ignoreContent = await fs.readFile(
      path.join(parentRepoPath, '.gitignore'),
      'utf-8'
    );
  } catch {
    return [];
  }

  const candidates = new Set<string>();
  for (const rawLine of ignoreContent.split(/\r?\n/)) {
    const normalized = normalizeIgnoreLine(rawLine);
    if (!normalized) continue;
    if (EXCLUDED_NAMES.has(normalized)) continue;
    candidates.add(normalized);
  }

  const existing: string[] = [];
  for (const name of candidates) {
    const fullPath = path.join(parentRepoPath, name);
    try {
      await fs.access(fullPath);
      existing.push(name);
    } catch {
      // 実在しないものは候補にしない
    }
  }
  existing.sort((a, b) => a.localeCompare(b));
  return existing;
}

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
