import * as fs from 'fs';
import * as path from 'path';
import type { TypedServer } from '../handlers/types.js';

// ファイル変更イベントの除外ディレクトリ
const EXCLUDED_DIRS = new Set([
  '.git',
  'node_modules',
  'dist',
  '.next',
  '__pycache__',
  '.venv',
  '.cache',
  '.turbo',
  '.nx',
]);

/**
 * デバウンスされた変更イベント情報
 */
interface PendingChange {
  path: string;
  type: 'change' | 'rename';
  timer: ReturnType<typeof setTimeout>;
}

/**
 * リポジトリごとの watcher 情報
 */
interface WatcherEntry {
  watcher: fs.FSWatcher;
  repoPath: string;
  pendingChanges: Map<string, PendingChange>;
}

// デバウンス間隔（ms）
const DEBOUNCE_MS = 300;

// リポジトリごとの watcher を管理するMap
const watchers = new Map<string, WatcherEntry>();

/**
 * パスが除外ディレクトリに含まれるかチェック
 */
function isExcludedPath(relativePath: string): boolean {
  const parts = relativePath.split(path.sep);
  return parts.some((part) => EXCLUDED_DIRS.has(part));
}

/**
 * ファイル監視を開始
 */
export function startWatching(rid: string, repoPath: string, io: TypedServer): void {
  // 既に監視中の場合は一旦停止
  if (watchers.has(rid)) {
    stopWatching(rid);
  }

  try {
    const watcher = fs.watch(repoPath, { recursive: true }, (eventType, filename) => {
      if (!filename) return;

      // 除外ディレクトリのイベントはスキップ
      if (isExcludedPath(filename)) return;

      const entry = watchers.get(rid);
      if (!entry) return;

      const changeType = eventType === 'rename' ? 'rename' : 'change';

      // 既存のデバウンスタイマーをクリア
      const existing = entry.pendingChanges.get(filename);
      if (existing) {
        clearTimeout(existing.timer);
      }

      // デバウンスして通知
      const timer = setTimeout(() => {
        entry.pendingChanges.delete(filename);

        // Socket.IO で全クライアントに通知
        io.emit('file-changed', {
          rid,
          path: filename,
          type: changeType,
        });
      }, DEBOUNCE_MS);

      entry.pendingChanges.set(filename, {
        path: filename,
        type: changeType,
        timer,
      });
    });

    // エラーハンドリング
    watcher.on('error', (error) => {
      console.error(`[file-watcher] rid=${rid} の監視でエラー:`, error.message);
      stopWatching(rid);
    });

    watchers.set(rid, {
      watcher,
      repoPath,
      pendingChanges: new Map(),
    });
  } catch (error) {
    console.error(`[file-watcher] 監視開始に失敗: rid=${rid}`, error);
  }
}

/**
 * ファイル監視を停止
 */
export function stopWatching(rid: string): void {
  const entry = watchers.get(rid);
  if (!entry) return;

  // 保留中のタイマーをクリア
  for (const pending of entry.pendingChanges.values()) {
    clearTimeout(pending.timer);
  }

  entry.watcher.close();
  watchers.delete(rid);
}

/**
 * 全ての監視を停止
 */
export function stopAll(): void {
  for (const rid of watchers.keys()) {
    stopWatching(rid);
  }
}

/**
 * 指定リポジトリが監視中かどうか
 */
export function isWatching(rid: string): boolean {
  return watchers.has(rid);
}
