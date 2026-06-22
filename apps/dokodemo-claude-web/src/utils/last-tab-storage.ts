/**
 * 親リポジトリ -> 最後に選んだ worktree のパス、および
 * worktree（currentRepo）-> 最後にアクティブだった AI タブの安定キーを
 * localStorage に保存・復元するユーティリティ。
 *
 * - 親リポマップは単一キーに JSON で `Record<parentRepoPath, lastWorktreePath>`
 *   を載せる（探索 O(1)、肥大化しにくい）
 * - AI タブはリポジトリ単位でキーを分割（既存 useAppSettings と同じ流儀）
 * - instanceId はサーバ揮発のため保存せず、provider + isPrimary + subOrder の
 *   安定キーで再特定する
 */

import type { AiProvider } from '../types';

const LAST_WORKTREE_KEY = 'last-worktree-for-parent';

export function getLastWorktreeForParent(parentRepoPath: string): string | null {
  if (!parentRepoPath) return null;
  try {
    const raw = localStorage.getItem(LAST_WORKTREE_KEY);
    if (!raw) return null;
    const map = JSON.parse(raw) as Record<string, string>;
    return map[parentRepoPath] ?? null;
  } catch {
    return null;
  }
}

export function setLastWorktreeForParent(
  parentRepoPath: string,
  worktreePath: string
): void {
  if (!parentRepoPath || !worktreePath) return;
  try {
    const raw = localStorage.getItem(LAST_WORKTREE_KEY);
    const map = raw ? (JSON.parse(raw) as Record<string, string>) : {};
    map[parentRepoPath] = worktreePath;
    localStorage.setItem(LAST_WORKTREE_KEY, JSON.stringify(map));
  } catch {
    /* ignore */
  }
}

export interface SavedAiTab {
  provider: AiProvider;
  isPrimary: boolean;
  /**
   * 非プライマリの場合: 同 provider のサブインスタンスを order 昇順で並べた
   * ときの 0-indexed な位置。プライマリの場合は undefined。
   */
  subOrder?: number;
}

function aiTabKey(repoPath: string): string {
  return `last-active-ai-tab-${encodeURIComponent(repoPath)}`;
}

export function getLastAiTab(repoPath: string): SavedAiTab | null {
  if (!repoPath) return null;
  try {
    const raw = localStorage.getItem(aiTabKey(repoPath));
    return raw ? (JSON.parse(raw) as SavedAiTab) : null;
  } catch {
    return null;
  }
}

export function setLastAiTab(repoPath: string, tab: SavedAiTab): void {
  if (!repoPath) return;
  try {
    localStorage.setItem(aiTabKey(repoPath), JSON.stringify(tab));
  } catch {
    /* ignore */
  }
}
