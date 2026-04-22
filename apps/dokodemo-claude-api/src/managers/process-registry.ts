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
 */
export class ProcessRegistry {
  // AI セッション管理
  private aiSessions = new Map<string, AiSessionRecord>(); // sessionKey → record
  private aiSessionIdIndex = new Map<string, string>(); // sessionId → sessionKey (O(1)検索用)

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

  /**
   * AI セッションを登録
   */
  registerAiSession(record: AiSessionRecord): void {
    const sessionKey = createSessionKey(record.repositoryPath, record.provider);
    this.aiSessions.set(sessionKey, record);
    this.aiSessionIdIndex.set(record.sessionId, sessionKey);
  }

  /**
   * AI セッションを更新
   */
  updateAiSession(
    sessionId: string,
    updates: Partial<Omit<AiSessionRecord, 'sessionId'>>
  ): boolean {
    const sessionKey = this.aiSessionIdIndex.get(sessionId);
    if (!sessionKey) return false;

    const record = this.aiSessions.get(sessionKey);
    if (!record) return false;

    Object.assign(record, updates, { lastAccessedAt: Date.now() });
    return true;
  }

  /**
   * AI セッションを削除
   */
  removeAiSession(sessionId: string): boolean {
    const sessionKey = this.aiSessionIdIndex.get(sessionId);
    if (!sessionKey) return false;

    this.aiSessions.delete(sessionKey);
    this.aiSessionIdIndex.delete(sessionId);
    return true;
  }

  /**
   * セッションIDで AI セッションを取得
   */
  getAiSessionById(sessionId: string): AiSessionRecord | undefined {
    const sessionKey = this.aiSessionIdIndex.get(sessionId);
    if (!sessionKey) return undefined;
    return this.aiSessions.get(sessionKey);
  }

  /**
   * リポジトリパスとプロバイダーで AI セッションを取得
   */
  getAiSessionByRepo(
    repositoryPath: string,
    provider: AiProvider
  ): AiSessionRecord | undefined {
    const sessionKey = createSessionKey(repositoryPath, provider);
    return this.aiSessions.get(sessionKey);
  }

  /**
   * 全ての AI セッションを取得
   */
  getAllAiSessions(): AiSessionRecord[] {
    return Array.from(this.aiSessions.values());
  }

  /**
   * セッションIDが有効かどうかを確認
   */
  isValidAiSessionId(sessionId: string): boolean {
    return this.aiSessionIdIndex.has(sessionId);
  }

  /**
   * リポジトリパスで AI セッションが存在するかを確認
   */
  hasAiSessionForRepo(repositoryPath: string, provider: AiProvider): boolean {
    const sessionKey = createSessionKey(repositoryPath, provider);
    return this.aiSessions.has(sessionKey);
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
    this.aiSessionIdIndex.clear();
    this.terminals.clear();
    this.terminalsByRepo.clear();
    this.sessionCounter = 0;
    this.terminalCounter = 0;
  }
}
