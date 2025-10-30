import { EventEmitter } from 'events';
import type { AiProvider, AiOutputLine } from '../types/index.js';
import { AiSessionManager, AiSessionInfo } from './ai-session-manager.js';
import { AiOutputManager } from './ai-output-manager.js';

/**
 * AI CLI統合管理クラス
 * AIセッション管理と出力管理を統合
 */
export class AiCliManager extends EventEmitter {
  private sessionManager: AiSessionManager;
  private outputManager: AiOutputManager;

  constructor(processesDir: string) {
    super();

    this.sessionManager = new AiSessionManager();
    this.outputManager = new AiOutputManager(processesDir);

    // セッションマネージャーのイベントを転送
    this.setupSessionEvents();
  }

  /**
   * セッションマネージャーのイベントを設定
   */
  private setupSessionEvents(): void {
    // セッション作成イベント
    this.sessionManager.on('session-created', (session: AiSessionInfo) => {
      this.emit('ai-session-created', {
        sessionId: session.sessionId,
        repositoryPath: session.repositoryPath,
        repositoryName: session.repositoryName,
        provider: session.provider,
      });

      // 後方互換性: Claudeセッションの場合は既存のイベントも発行
      if (session.provider === 'claude') {
        this.emit('claude-session-created', {
          id: session.sessionId,
          repositoryPath: session.repositoryPath,
          repositoryName: session.repositoryName,
        });
      }
    });

    // セッション出力イベント
    this.sessionManager.on('session-output', (data) => {
      // データを処理（ANSI制御コード等）
      const processedData = this.processOutputData(data.content);

      // 出力履歴に追加
      const outputLine = this.outputManager.addOutputLine(
        data.repositoryPath,
        data.provider,
        processedData,
        data.type
      );

      // 新しいイベント: 構造化されたAiOutputLineオブジェクトを発行
      this.emit('ai-output', {
        sessionId: data.sessionId,
        repositoryPath: data.repositoryPath,
        provider: data.provider,
        outputLine,
      });

      // 後方互換性: 既存のclaude-outputイベントも発行
      if (data.provider === 'claude') {
        this.emit('claude-output', {
          type: data.type,
          content: processedData,
          sessionId: data.sessionId,
          repositoryPath: data.repositoryPath,
        });
      }
    });

    // セッション終了イベント
    this.sessionManager.on('session-exit', (data) => {
      this.emit('ai-exit', {
        sessionId: data.sessionId,
        repositoryPath: data.repositoryPath,
        provider: data.provider,
        exitCode: data.exitCode,
        signal: data.signal,
      });

      // 後方互換性: Claudeセッションの場合は既存のイベントも発行
      if (data.provider === 'claude') {
        this.emit('claude-exit', {
          sessionId: data.sessionId,
          repositoryPath: data.repositoryPath,
          exitCode: data.exitCode,
          signal: data.signal,
        });
      }
    });
  }

  /**
   * 出力データを処理（ANSI制御コードの処理等）
   */
  private processOutputData(data: string): string {
    // ANSI制御コード等の処理が必要な場合はここで実装
    // 現状はそのまま返す
    return data;
  }

  /**
   * AIセッションを取得または作成
   */
  async getOrCreateSession(
    repositoryPath: string,
    repositoryName: string,
    provider: AiProvider,
    initialSize?: { cols: number; rows: number }
  ): Promise<AiSessionInfo> {
    return await this.sessionManager.getOrCreateSession(
      repositoryPath,
      repositoryName,
      provider,
      initialSize
    );
  }

  /**
   * AIセッションを強制的に再作成
   */
  async recreateSession(
    repositoryPath: string,
    repositoryName: string,
    provider: AiProvider,
    initialSize?: { cols: number; rows: number }
  ): Promise<AiSessionInfo> {
    // 出力履歴もクリア
    await this.outputManager.clearOutputHistory(repositoryPath, provider);

    // セッションを再作成
    return await this.sessionManager.recreateSession(
      repositoryPath,
      repositoryName,
      provider,
      initialSize
    );
  }

  /**
   * セッションIDからセッションを取得
   */
  getSession(sessionId: string): AiSessionInfo | undefined {
    return this.sessionManager.getSession(sessionId);
  }

  /**
   * リポジトリとプロバイダーからセッションを取得
   */
  getSessionByRepository(
    repositoryPath: string,
    provider: AiProvider
  ): AiSessionInfo | undefined {
    return this.sessionManager.getSessionByRepository(repositoryPath, provider);
  }

  /**
   * セッションにコマンドを送信
   */
  sendToSession(sessionId: string, command: string): boolean {
    return this.sessionManager.sendToSession(sessionId, command);
  }

  /**
   * セッションにシグナルを送信
   */
  sendSignalToSession(sessionId: string, signal: string): boolean {
    return this.sessionManager.sendSignalToSession(sessionId, signal);
  }

  /**
   * セッションをリサイズ
   */
  resizeSession(
    repositoryPath: string,
    provider: AiProvider,
    cols: number,
    rows: number
  ): boolean {
    return this.sessionManager.resizeSession(
      repositoryPath,
      provider,
      cols,
      rows
    );
  }

  /**
   * AI出力履歴を取得
   */
  async getOutputHistory(
    repositoryPath: string,
    provider: AiProvider
  ): Promise<AiOutputLine[]> {
    return await this.outputManager.getOutputHistory(repositoryPath, provider);
  }

  /**
   * AI出力履歴をクリア
   */
  async clearOutputHistory(
    repositoryPath: string,
    provider: AiProvider
  ): Promise<boolean> {
    return await this.outputManager.clearOutputHistory(
      repositoryPath,
      provider
    );
  }

  /**
   * 特定のリポジトリの全セッションと出力履歴をクリーンアップ
   */
  async cleanupRepository(repositoryPath: string): Promise<void> {
    // セッションを終了
    await this.sessionManager.closeAllSessionsForRepository(repositoryPath);

    // 出力履歴をクリア
    await this.outputManager.clearAllOutputHistoriesForRepository(
      repositoryPath
    );
  }

  /**
   * 初期化
   */
  async initialize(): Promise<void> {
    await this.outputManager.initialize();
  }

  /**
   * シャットダウン
   */
  async shutdown(): Promise<void> {
    await this.sessionManager.shutdown();
    await this.outputManager.shutdown();
  }

  /**
   * 後方互換性: Claudeセッションを取得
   */
  getClaudeSessionByRepository(
    repositoryPath: string
  ): AiSessionInfo | undefined {
    return this.getSessionByRepository(repositoryPath, 'claude');
  }

  /**
   * 後方互換性: Claude出力履歴を取得
   */
  async getOutputHistory_Legacy(
    repositoryPath: string
  ): Promise<AiOutputLine[]> {
    return await this.getOutputHistory(repositoryPath, 'claude');
  }

  /**
   * 後方互換性: Claude出力履歴をクリア
   */
  async clearClaudeOutputHistory(repositoryPath: string): Promise<boolean> {
    return await this.clearOutputHistory(repositoryPath, 'claude');
  }
}
