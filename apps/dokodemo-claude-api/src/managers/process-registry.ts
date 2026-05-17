/**
 * ProcessRegistry - プロセス状態の集中管理
 *
 * 責務:
 * - SessionId ↔ RepoId ↔ TerminalId の整合性を保証
 * - すべてのプロセス状態の集中管理
 * - O(1)での状態検索を提供
 */

import { AiProvider } from '../types/index.js';

/**
 * AI セッションのレコード
 */
export interface AiSessionRecord {
  sessionId: string;
  repositoryPath: string;
  provider: AiProvider;
  pid?: number;
  status: 'idle' | 'running' | 'stopped' | 'error';
  createdAt: number;
  lastAccessedAt: number;
}

/**
 * ターミナルのレコード
 */
export interface TerminalRecord {
  terminalId: string;
  repositoryPath: string;
  name: string;
  pid?: number;
  status: 'active' | 'exited';
  createdAt: number;
  lastAccessedAt: number;
}

/**
 * セッションキーを生成（プロバイダー情報を含む）
 */
export function createSessionKey(
  repositoryPath: string,
  provider: AiProvider
): string {
  return `${provider}:${repositoryPath}`;
}

/**
 * セッションキーをパース
 */
export function parseSessionKey(
  key: string
): { provider: AiProvider; repositoryPath: string } | null {
  const colonIndex = key.indexOf(':');
  if (colonIndex === -1) return null;
  const provider = key.slice(0, colonIndex) as AiProvider;
  const repositoryPath = key.slice(colonIndex + 1);
  return { provider, repositoryPath };
}

/**
 * ProcessRegistry - プロセス状態の集中管理クラス
 *
 * マルチインスタンス対応のため AI セッションは sessionId キーで管理する
 */
export class ProcessRegistry {
  // AI セッション管理（sessionId → record）
  private aiSessions = new Map<string, AiSessionRecord>();

  // ターミナル管理
  private terminals = new Map<string, TerminalRecord>(); // terminalId → record
  private terminalsByRepo = new Map<string, Set<string>>(); // repositoryPath → Set<terminalId>

  // カウンター
  private sessionCounter = 0;
  private terminalCounter = 0;

  /**
   * 新しいセッションIDを生成
   */
  generateSessionId(provider: AiProvider): string {
    return `${provider}-${++this.sessionCounter}-${Date.now()}`;
  }

  /**
   * 新しいターミナルIDを生成
   */
  generateTerminalId(): string {
    return `terminal-${++this.terminalCounter}-${Date.now()}`;
  }

  // ====================
  // AI セッション操作
  // ====================

  registerAiSession(record: AiSessionRecord): void {
    this.aiSessions.set(record.sessionId, record);
  }

  updateAiSession(
    sessionId: string,
    updates: Partial<Omit<AiSessionRecord, 'sessionId'>>
  ): boolean {
    const record = this.aiSessions.get(sessionId);
    if (!record) return false;
    Object.assign(record, updates, { lastAccessedAt: Date.now() });
    return true;
  }

  removeAiSession(sessionId: string): boolean {
    return this.aiSessions.delete(sessionId);
  }

  getAiSessionById(sessionId: string): AiSessionRecord | undefined {
    return this.aiSessions.get(sessionId);
  }

  /**
   * リポジトリパスとプロバイダーで「最初に見つかった」AI セッションを返す
   * マルチインスタンス対応後はこのメソッドは曖昧なため非推奨
   */
  getAiSessionByRepo(
    repositoryPath: string,
    provider: AiProvider
  ): AiSessionRecord | undefined {
    for (const record of this.aiSessions.values()) {
      if (record.repositoryPath === repositoryPath && record.provider === provider) {
        return record;
      }
    }
    return undefined;
  }

  getAllAiSessions(): AiSessionRecord[] {
    return Array.from(this.aiSessions.values());
  }

  isValidAiSessionId(sessionId: string): boolean {
    return this.aiSessions.has(sessionId);
  }

  hasAiSessionForRepo(repositoryPath: string, provider: AiProvider): boolean {
    return this.getAiSessionByRepo(repositoryPath, provider) !== undefined;
  }

  // ====================
  // ターミナル操作
  // ====================

  /**
   * ターミナルを登録
   */
  registerTerminal(record: TerminalRecord): void {
    this.terminals.set(record.terminalId, record);

    // リポジトリ別インデックスに追加
    if (!this.terminalsByRepo.has(record.repositoryPath)) {
      this.terminalsByRepo.set(record.repositoryPath, new Set());
    }
    this.terminalsByRepo.get(record.repositoryPath)!.add(record.terminalId);
  }

  /**
   * ターミナルを更新
   */
  updateTerminal(
    terminalId: string,
    updates: Partial<Omit<TerminalRecord, 'terminalId'>>
  ): boolean {
    const record = this.terminals.get(terminalId);
    if (!record) return false;

    Object.assign(record, updates, { lastAccessedAt: Date.now() });
    return true;
  }

  /**
   * ターミナルを削除
   */
  removeTerminal(terminalId: string): boolean {
    const record = this.terminals.get(terminalId);
    if (!record) return false;

    this.terminals.delete(terminalId);

    // リポジトリ別インデックスから削除
    const repoTerminals = this.terminalsByRepo.get(record.repositoryPath);
    if (repoTerminals) {
      repoTerminals.delete(terminalId);
      if (repoTerminals.size === 0) {
        this.terminalsByRepo.delete(record.repositoryPath);
      }
    }

    return true;
  }

  /**
   * ターミナルIDでターミナルを取得
   */
  getTerminalById(terminalId: string): TerminalRecord | undefined {
    return this.terminals.get(terminalId);
  }

  /**
   * リポジトリパスで全てのターミナルを取得
   */
  getTerminalsByRepo(repositoryPath: string): TerminalRecord[] {
    const terminalIds = this.terminalsByRepo.get(repositoryPath);
    if (!terminalIds) return [];

    return Array.from(terminalIds)
      .map((id) => this.terminals.get(id))
      .filter((t): t is TerminalRecord => t !== undefined);
  }

  /**
   * 全てのターミナルを取得
   */
  getAllTerminals(): TerminalRecord[] {
    return Array.from(this.terminals.values());
  }

  /**
   * ターミナルIDが有効かどうかを確認
   */
  isValidTerminalId(terminalId: string): boolean {
    return this.terminals.has(terminalId);
  }

  // ====================
  // 統計・ヘルスチェック
  // ====================

  /**
   * リポジトリごとのプロセス統計を取得
   */
  getRepoStats(repositoryPath: string): {
    aiSessionCount: number;
    terminalCount: number;
  } {
    const aiSessionCount = Array.from(this.aiSessions.values()).filter(
      (s) => s.repositoryPath === repositoryPath
    ).length;

    const terminalCount = this.terminalsByRepo.get(repositoryPath)?.size ?? 0;

    return { aiSessionCount, terminalCount };
  }

  /**
   * 全体の統計を取得
   */
  getOverallStats(): {
    totalAiSessions: number;
    totalTerminals: number;
    activeAiSessions: number;
    activeTerminals: number;
  } {
    const aiSessions = Array.from(this.aiSessions.values());
    const terminals = Array.from(this.terminals.values());

    return {
      totalAiSessions: aiSessions.length,
      totalTerminals: terminals.length,
      activeAiSessions: aiSessions.filter(
        (s) => s.status === 'running' || s.status === 'idle'
      ).length,
      activeTerminals: terminals.filter((t) => t.status === 'active').length,
    };
  }

  /**
   * 全ての状態をクリア（テスト用）
   */
  clear(): void {
    this.aiSessions.clear();
    this.terminals.clear();
    this.terminalsByRepo.clear();
    this.sessionCounter = 0;
    this.terminalCounter = 0;
  }
}
