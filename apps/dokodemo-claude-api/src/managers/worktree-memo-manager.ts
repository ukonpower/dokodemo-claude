/**
 * ワークツリーメモマネージャー
 * ワークツリーパス → メモ本文 のマップを永続化する。
 * メモは自由記述の文字列。本文中の URL はフロントエンドの表示時に自動リンク化する。
 */

import { PersistenceService } from '../services/persistence-service.js';
import { Result, Ok, Err } from '../utils/result.js';
import { PersistenceError } from '../utils/errors.js';

const FILE = 'worktree-memos.json';

export class WorktreeMemoManager {
  // key: worktreePath (絶対パス), value: メモ本文
  private memos = new Map<string, string>();

  // メモ変更の通知先（要約サービスがメモに追従するために使用。削除は空文字で通知）
  private onChange: ((worktreePath: string, memo: string) => void) | null =
    null;

  constructor(private readonly persistenceService: PersistenceService) {}

  /**
   * メモ変更の通知先を登録する。
   */
  setOnChange(callback: (worktreePath: string, memo: string) => void): void {
    this.onChange = callback;
  }

  /**
   * 全メモを返す（要約サービスの突き合わせ用）。
   */
  entries(): ReadonlyMap<string, string> {
    return this.memos;
  }

  async initialize(): Promise<void> {
    const result =
      await this.persistenceService.load<Record<string, string>>(FILE);
    if (!result.ok) {
      console.error('[WorktreeMemoManager] 復元に失敗:', result.error.message);
      return;
    }
    if (result.value === null) return;

    this.memos.clear();
    for (const [worktreePath, memo] of Object.entries(result.value)) {
      if (typeof memo === 'string' && memo.length > 0) {
        this.memos.set(worktreePath, memo);
      }
    }
  }

  get(worktreePath: string): string | undefined {
    return this.memos.get(worktreePath);
  }

  /**
   * メモを保存する。空文字はメモ削除と等価に扱い、残骸を残さない。
   */
  async save(
    worktreePath: string,
    memo: string
  ): Promise<Result<string, PersistenceError>> {
    if (!worktreePath) {
      return Err(
        PersistenceError.writeFailed(FILE, new Error('worktreePath is empty'))
      );
    }
    const trimmed = (memo ?? '').trim();
    if (trimmed === '') {
      this.memos.delete(worktreePath);
    } else {
      this.memos.set(worktreePath, trimmed);
    }

    const persistResult = await this.persist();
    if (!persistResult.ok) {
      return Err(persistResult.error);
    }
    this.onChange?.(worktreePath, trimmed);
    return Ok(trimmed);
  }

  /**
   * ワークツリー削除時にメモも掃除する。
   */
  async remove(worktreePath: string): Promise<void> {
    if (this.memos.delete(worktreePath)) {
      await this.persist();
      this.onChange?.(worktreePath, '');
    }
  }

  private async persist(): Promise<Result<void, PersistenceError>> {
    const data: Record<string, string> = {};
    for (const [key, memo] of this.memos.entries()) {
      data[key] = memo;
    }
    return this.persistenceService.save(FILE, data);
  }
}
