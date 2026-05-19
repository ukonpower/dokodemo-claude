/**
 * ワークツリー同期設定マネージャー
 * 親リポジトリパス → エントリ配列 のマップを永続化する。
 * 新しい worktree 作成時にこの設定をデフォルト適用する想定。
 */

import path from 'path';
import type { WorktreeSyncEntry, WorktreeSyncMode } from '../types/index.js';
import { PersistenceService } from '../services/persistence-service.js';
import { Result, Ok, Err } from '../utils/result.js';
import { WorktreeSyncError } from '../utils/errors.js';

const FILE = 'worktree-sync-configs.json';

const VALID_MODES: WorktreeSyncMode[] = ['copy', 'link'];

function sanitizeRelativePath(rawPath: string): string | null {
  const trimmed = rawPath.trim();
  if (!trimmed) return null;
  // 絶対パス・親ディレクトリ参照は弾く
  if (path.isAbsolute(trimmed)) return null;
  const normalized = path.posix.normalize(trimmed.replace(/\\/g, '/'));
  if (normalized.startsWith('..') || normalized.includes('/../')) return null;
  if (normalized === '.' || normalized === '') return null;
  return normalized.replace(/^\.\//, '').replace(/\/+$/, '');
}

function sanitizeEntries(entries: WorktreeSyncEntry[]): WorktreeSyncEntry[] {
  const seen = new Set<string>();
  const result: WorktreeSyncEntry[] = [];
  for (const entry of entries) {
    const safePath = sanitizeRelativePath(entry.path);
    if (!safePath) continue;
    if (!VALID_MODES.includes(entry.mode)) continue;
    if (seen.has(safePath)) continue;
    seen.add(safePath);
    result.push({ path: safePath, mode: entry.mode });
  }
  return result;
}

export class WorktreeSyncManager {
  // key: parentRepoPath (絶対パス), value: エントリ配列
  private configs = new Map<string, WorktreeSyncEntry[]>();

  constructor(private readonly persistenceService: PersistenceService) {}

  async initialize(): Promise<void> {
    const result = await this.persistenceService.load<
      Record<string, WorktreeSyncEntry[]>
    >(FILE);
    if (!result.ok) {
      console.error('[WorktreeSyncManager] 復元に失敗:', result.error.message);
      return;
    }
    if (result.value === null) return;

    this.configs.clear();
    for (const [repoPath, entries] of Object.entries(result.value)) {
      if (!Array.isArray(entries)) continue;
      this.configs.set(repoPath, sanitizeEntries(entries));
    }
  }

  get(parentRepoPath: string): WorktreeSyncEntry[] {
    return this.configs.get(parentRepoPath) ?? [];
  }

  async save(
    parentRepoPath: string,
    entries: WorktreeSyncEntry[]
  ): Promise<Result<WorktreeSyncEntry[], WorktreeSyncError>> {
    if (!parentRepoPath) {
      return Err(WorktreeSyncError.invalidInput('parentRepoPath is empty'));
    }
    const sanitized = sanitizeEntries(entries);
    this.configs.set(parentRepoPath, sanitized);

    const persistResult = await this.persist();
    if (!persistResult.ok) {
      return Err(persistResult.error);
    }
    return Ok(sanitized);
  }

  private async persist(): Promise<Result<void, WorktreeSyncError>> {
    const data: Record<string, WorktreeSyncEntry[]> = {};
    for (const [key, entries] of this.configs.entries()) {
      data[key] = entries;
    }
    const result = await this.persistenceService.save(FILE, data);
    if (!result.ok) {
      return Err(WorktreeSyncError.persistFailed(result.error));
    }
    return Ok(undefined);
  }
}
