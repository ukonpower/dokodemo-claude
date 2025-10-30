import { v4 as uuidv4 } from 'uuid';
import type { AiProvider } from '../types/index.js';
import { EventEmitter } from 'events';

// PTYプロセスのインターフェース
interface PtyProcess {
  write: (data: string) => void;
  resize: (cols: number, rows: number) => void;
  kill: () => void;
  onData: (callback: (data: string) => void) => void;
  onExit: (
    callback: (event: { exitCode: number; signal?: number }) => void
  ) => void;
}

/**
 * AIセッション情報
 */
export interface AiSessionInfo {
  id: string;
  sessionId: string; // 外部用の一意識別子
  repositoryPath: string;
  repositoryName: string;
  provider: AiProvider;
  process: PtyProcess; // PTYプロセス
  isActive: boolean;
  isPty: boolean;
  createdAt: number;
  cols?: number;
  rows?: number;
}

/**
 * AIセッションイベント
 */
export interface AiSessionEvents {
  'session-created': (session: AiSessionInfo) => void;
  'session-output': (data: {
    sessionId: string;
    repositoryPath: string;
    provider: AiProvider;
    content: string;
    type: 'stdout' | 'stderr';
  }) => void;
  'session-exit': (data: {
    sessionId: string;
    repositoryPath: string;
    provider: AiProvider;
    exitCode: number | null;
    signal: string | null;
  }) => void;
}

/**
 * AIセッション管理クラス
 * AI CLI（Claude, Codex等）のセッション管理を担当
 */
export class AiSessionManager extends EventEmitter {
  private sessions = new Map<string, AiSessionInfo>();
  private sessionsByRepository = new Map<string, Map<AiProvider, string>>(); // repositoryPath -> provider -> sessionId

  /**
   * リポジトリとプロバイダーの組み合わせからキーを生成
   */
  private getRepositoryKey(
    repositoryPath: string,
    provider: AiProvider
  ): string {
    return `${repositoryPath}:${provider}`;
  }

  /**
   * プロバイダーからCLIコマンドを取得
   */
  private getCliCommand(provider: AiProvider): string {
    switch (provider) {
      case 'claude':
        return 'claude';
      case 'codex':
        return 'codex'; // Codex CLIコマンド（実際のコマンド名に応じて変更）
      default:
        throw new Error(`未対応のプロバイダー: ${provider}`);
    }
  }

  /**
   * AIセッションを作成
   */
  async createSession(
    repositoryPath: string,
    repositoryName: string,
    provider: AiProvider,
    initialSize?: { cols: number; rows: number }
  ): Promise<AiSessionInfo> {
    const sessionId = uuidv4();
    const cliCommand = this.getCliCommand(provider);

    // PTYの動的インポート
    const pty = await import('node-pty');

    // PTYでAI CLIプロセスを起動
    const ptyProcess = pty.spawn(cliCommand, [], {
      name: 'xterm-256color',
      cols: initialSize?.cols || 80,
      rows: initialSize?.rows || 24,
      cwd: repositoryPath,
      env: {
        ...process.env,
        TERM: 'xterm-256color',
        COLORTERM: 'truecolor',
      },
    });

    const session: AiSessionInfo = {
      id: sessionId,
      sessionId,
      repositoryPath,
      repositoryName,
      provider,
      process: ptyProcess as unknown as PtyProcess, // PTYインスタンスを型変換
      isActive: true,
      isPty: true,
      createdAt: Date.now(),
      cols: initialSize?.cols || 80,
      rows: initialSize?.rows || 24,
    };

    // セッションを保存
    this.sessions.set(sessionId, session);

    // リポジトリごとのマッピングを更新
    if (!this.sessionsByRepository.has(repositoryPath)) {
      this.sessionsByRepository.set(repositoryPath, new Map());
    }
    this.sessionsByRepository.get(repositoryPath)!.set(provider, sessionId);

    // 出力イベントのハンドリング
    ptyProcess.onData((data: string) => {
      if (session.isActive) {
        this.emit('session-output', {
          sessionId: session.sessionId,
          repositoryPath: session.repositoryPath,
          provider: session.provider,
          content: data,
          type: 'stdout',
        });
      }
    });

    // 終了イベントのハンドリング
    ptyProcess.onExit(
      ({ exitCode, signal }: { exitCode: number; signal?: number }) => {
        session.isActive = false;

        this.emit('session-exit', {
          sessionId: session.sessionId,
          repositoryPath: session.repositoryPath,
          provider: session.provider,
          exitCode,
          signal: signal ? String(signal) : null,
        });

        // セッションを削除
        this.sessions.delete(sessionId);
        const repoSessions = this.sessionsByRepository.get(repositoryPath);
        if (repoSessions) {
          repoSessions.delete(provider);
          if (repoSessions.size === 0) {
            this.sessionsByRepository.delete(repositoryPath);
          }
        }
      }
    );

    // セッション作成イベントを発行
    this.emit('session-created', session);

    return session;
  }

  /**
   * セッションを取得または作成
   */
  async getOrCreateSession(
    repositoryPath: string,
    repositoryName: string,
    provider: AiProvider,
    initialSize?: { cols: number; rows: number }
  ): Promise<AiSessionInfo> {
    const existingSession = this.getSessionByRepository(
      repositoryPath,
      provider
    );

    if (existingSession && existingSession.isActive) {
      return existingSession;
    }

    return await this.createSession(
      repositoryPath,
      repositoryName,
      provider,
      initialSize
    );
  }

  /**
   * セッションを強制的に再作成
   */
  async recreateSession(
    repositoryPath: string,
    repositoryName: string,
    provider: AiProvider,
    initialSize?: { cols: number; rows: number }
  ): Promise<AiSessionInfo> {
    // 既存のセッションを終了
    const existingSession = this.getSessionByRepository(
      repositoryPath,
      provider
    );
    if (existingSession) {
      await this.closeSession(existingSession.sessionId);
    }

    // 新しいセッションを作成
    return await this.createSession(
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
    return this.sessions.get(sessionId);
  }

  /**
   * リポジトリとプロバイダーからセッションを取得
   */
  getSessionByRepository(
    repositoryPath: string,
    provider: AiProvider
  ): AiSessionInfo | undefined {
    const repoSessions = this.sessionsByRepository.get(repositoryPath);
    if (!repoSessions) return undefined;

    const sessionId = repoSessions.get(provider);
    if (!sessionId) return undefined;

    return this.sessions.get(sessionId);
  }

  /**
   * セッションにコマンドを送信
   */
  sendToSession(sessionId: string, command: string): boolean {
    const session = this.sessions.get(sessionId);
    if (!session || !session.isActive) {
      return false;
    }

    try {
      session.process.write(command);
      return true;
    } catch (error) {
      console.error(`セッション ${sessionId} への送信エラー:`, error);
      return false;
    }
  }

  /**
   * セッションにシグナルを送信
   */
  sendSignalToSession(sessionId: string, signal: string): boolean {
    const session = this.sessions.get(sessionId);
    if (!session || !session.isActive) {
      return false;
    }

    try {
      session.process.write(signal);
      return true;
    } catch (error) {
      console.error(`セッション ${sessionId} へのシグナル送信エラー:`, error);
      return false;
    }
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
    const session = this.getSessionByRepository(repositoryPath, provider);
    if (!session || !session.isActive) {
      return false;
    }

    try {
      session.process.resize(cols, rows);
      session.cols = cols;
      session.rows = rows;
      return true;
    } catch (error) {
      console.error(`セッション ${session.sessionId} のリサイズエラー:`, error);
      return false;
    }
  }

  /**
   * セッションを終了
   */
  async closeSession(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) return;

    try {
      session.isActive = false;
      session.process.kill();

      // セッションマップから削除
      this.sessions.delete(sessionId);
      const repoSessions = this.sessionsByRepository.get(
        session.repositoryPath
      );
      if (repoSessions) {
        repoSessions.delete(session.provider);
        if (repoSessions.size === 0) {
          this.sessionsByRepository.delete(session.repositoryPath);
        }
      }
    } catch (error) {
      console.error(`セッション ${sessionId} の終了エラー:`, error);
    }
  }

  /**
   * 特定のリポジトリの全セッションを終了
   */
  async closeAllSessionsForRepository(repositoryPath: string): Promise<void> {
    const repoSessions = this.sessionsByRepository.get(repositoryPath);
    if (!repoSessions) return;

    const sessionIds = Array.from(repoSessions.values());
    await Promise.all(sessionIds.map((id) => this.closeSession(id)));
  }

  /**
   * 全セッションを取得
   */
  getAllSessions(): AiSessionInfo[] {
    return Array.from(this.sessions.values());
  }

  /**
   * シャットダウン: すべてのセッションを終了
   */
  async shutdown(): Promise<void> {
    const sessionIds = Array.from(this.sessions.keys());
    await Promise.all(sessionIds.map((id) => this.closeSession(id)));
  }
}
