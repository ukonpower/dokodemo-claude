/**
 * AISessionManager - AI CLI セッションの管理
 *
 * 責務:
 * - AI セッションのライフサイクル管理 (create, attach, detach, terminate)
 * - 出力履歴の管理
 * - セッションへの入力・シグナル送信
 */

import * as pty from 'node-pty';
import { EventEmitter } from 'events';
import { AiProvider, AiOutputLine, PermissionMode } from '../types/index.js';
import { RingBuffer } from '../utils/ring-buffer.js';
import { cleanChildEnv } from '../utils/clean-env.js';
import { ProcessRegistry, createSessionKey } from './process-registry.js';

/**
 * アクティブな AI セッション
 */
export interface ActiveAiSession {
  id: string;
  repositoryPath: string;
  repositoryName: string;
  pid: number;
  isActive: boolean;
  isPty: boolean;
  process: pty.IPty;
  provider: AiProvider;
  createdAt: number;
  lastAccessedAt: number;
  outputHistory: AiOutputLine[];
}

/**
 * セッション作成オプション
 */
export interface CreateSessionOptions {
  repositoryPath: string;
  repositoryName: string;
  provider: AiProvider;
  initialSize?: { cols: number; rows: number };
  permissionMode?: PermissionMode;
}

/**
 * セッション確保オプション
 */
export interface EnsureSessionOptions extends CreateSessionOptions {
  forceRestart?: boolean;
}

/**
 * AISessionManager 設定
 */
export interface AISessionManagerConfig {
  maxOutputLines: number;
  gracefulTerminationTimeoutMs: number;
}

const DEFAULT_CONFIG: AISessionManagerConfig = {
  maxOutputLines: 500,
  gracefulTerminationTimeoutMs: 2000,
};

/**
 * AISessionManager クラス
 */
export class AISessionManager extends EventEmitter {
  private readonly registry: ProcessRegistry;
  private readonly config: AISessionManagerConfig;

  // アクティブなセッション管理（プロセスへの参照を保持）
  private activeSessions = new Map<string, ActiveAiSession>(); // sessionKey → session
  private idIndex = new Map<string, string>(); // sessionId → sessionKey

  // RingBuffer: セッションごとの出力履歴バッファ（GC圧力軽減用）
  private outputBuffers = new Map<string, RingBuffer<AiOutputLine>>(); // sessionKey → buffer

  // セッションカウンター（ProcessRegistry から委譲される可能性あり）
  private sessionCounter = 0;

  constructor(
    registry: ProcessRegistry,
    config: Partial<AISessionManagerConfig> = {}
  ) {
    super();
    this.registry = registry;
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * プロバイダーのCLIコマンドと引数を取得
   */
  private getProviderCommand(provider: AiProvider, permissionMode?: PermissionMode): {
    command: string;
    args: string[];
  } {
    switch (provider) {
      case 'claude': {
        const claudeCommand = process.env.CLAUDE_CLI_COMMAND || 'claude';
        const args: string[] = [];
        if (permissionMode === 'dangerous' || permissionMode === undefined) {
          args.push('--dangerously-skip-permissions');
        } else if (permissionMode === 'auto') {
          args.push('--permission-mode', 'acceptEdits', '--enable-auto-mode');
        }
        return { command: claudeCommand, args };
      }
      case 'codex': {
        const codexCommand = process.env.CODEX_CLI_COMMAND || 'codex';
        return {
          command: codexCommand,
          args: ['--full-auto'],
        };
      }
      default:
        throw new Error(`Unsupported AI provider: ${provider}`);
    }
  }

  /**
   * 新しいセッションIDを生成
   */
  private generateSessionId(provider: AiProvider): string {
    return `${provider}-${++this.sessionCounter}-${Date.now()}`;
  }

  /**
   * 新しい AI CLI セッションを作成
   */
  async create(options: CreateSessionOptions): Promise<ActiveAiSession> {
    const { repositoryPath, repositoryName, provider, initialSize, permissionMode } = options;
    const sessionId = this.generateSessionId(provider);
    const sessionKey = createSessionKey(repositoryPath, provider);
    const { command, args } = this.getProviderCommand(provider, permissionMode);

    // PTYを使用してAI CLIを対話モードで起動
    const aiProcess = pty.spawn(command, args, {
      name: 'xterm-color',
      cols: initialSize?.cols ?? 120,
      rows: initialSize?.rows ?? 30,
      cwd: repositoryPath,
      env: cleanChildEnv({
        TERM: 'xterm-256color',
        COLORTERM: 'truecolor',
        FORCE_COLOR: '1',
        // ネストされたClaude Codeセッションエラーを防ぐために除外
        CLAUDECODE: undefined,
      }),
    });

    const session: ActiveAiSession = {
      id: sessionId,
      repositoryPath,
      repositoryName,
      pid: aiProcess.pid,
      isActive: true,
      isPty: true,
      process: aiProcess,
      provider,
      createdAt: Date.now(),
      lastAccessedAt: Date.now(),
      outputHistory: [],
    };

    // プロセス監視（同一イベントループティック内のデータを集約して送信）
    let pendingOutput = '';
    let flushScheduled = false;

    aiProcess.onData((data: string) => {
      session.lastAccessedAt = Date.now();
      pendingOutput += data;

      if (!flushScheduled) {
        flushScheduled = true;
        setImmediate(() => {
          const bufferedData = pendingOutput;
          pendingOutput = '';
          flushScheduled = false;

          const outputLine = this.addToOutputHistory(
            session,
            bufferedData,
            'stdout'
          );

          this.emit('ai-output', {
            sessionId: session.id,
            repositoryPath: session.repositoryPath,
            provider: session.provider,
            outputLine,
          });
        });
      }
    });

    aiProcess.onExit(({ exitCode, signal }) => {
      session.isActive = false;

      this.emit('ai-exit', {
        sessionId: session.id,
        repositoryPath: session.repositoryPath,
        exitCode,
        signal,
        provider: session.provider,
      });

      // セッションをクリーンアップ
      this.activeSessions.delete(sessionKey);
      this.idIndex.delete(session.id);
      this.outputBuffers.delete(sessionKey);
      this.registry.removeAiSession(session.id);
    });

    // 各種マップに登録
    this.activeSessions.set(sessionKey, session);
    this.idIndex.set(session.id, sessionKey);

    // レジストリに登録
    this.registry.registerAiSession({
      sessionId: session.id,
      repositoryPath: session.repositoryPath,
      provider: session.provider,
      pid: session.pid,
      status: 'running',
      createdAt: session.createdAt,
      lastAccessedAt: session.lastAccessedAt,
    });

    this.emit('ai-session-created', {
      sessionId: session.id,
      repositoryPath: session.repositoryPath,
      repositoryName: session.repositoryName,
      provider: session.provider,
    });

    return session;
  }

  /**
   * リポジトリの AI CLI セッションを取得（なければ作成）
   */
  async getOrCreate(options: CreateSessionOptions): Promise<ActiveAiSession> {
    const sessionKey = createSessionKey(
      options.repositoryPath,
      options.provider
    );

    // 既存のアクティブセッションを検索
    const existingSession = this.activeSessions.get(sessionKey);
    if (existingSession && existingSession.isActive) {
      existingSession.lastAccessedAt = Date.now();
      // 既存セッションのサイズを更新
      if (options.initialSize && existingSession.process?.resize) {
        existingSession.process.resize(
          options.initialSize.cols,
          options.initialSize.rows
        );
      }
      return existingSession;
    }

    // 新しいセッションを作成
    return await this.create(options);
  }

  /**
   * AI CLI セッションの確保（強制再起動オプション付き）
   */
  async ensure(options: EnsureSessionOptions): Promise<ActiveAiSession> {
    const sessionKey = createSessionKey(
      options.repositoryPath,
      options.provider
    );

    // 強制再起動が指定されている場合は既存セッションを終了
    if (options.forceRestart) {
      const existingSession = this.activeSessions.get(sessionKey);
      if (existingSession) {
        await this.terminate(existingSession.id);
      }
    }

    // セッションを取得または作成
    return await this.getOrCreate(options);
  }

  /**
   * AI CLI セッションへの入力送信
   */
  sendInput(sessionId: string, input: string): boolean {
    const sessionKey = this.idIndex.get(sessionId);
    if (!sessionKey) {
      return false;
    }

    const session = this.activeSessions.get(sessionKey);
    if (!session || !session.isActive) {
      return false;
    }

    // PTY接続がない場合
    if (!session.isPty || !session.process) {
      return false;
    }

    try {
      session.process.write(input);
      session.lastAccessedAt = Date.now();
      return true;
    } catch {
      return false;
    }
  }

  /**
   * AI CLI セッションへのシグナル送信
   */
  sendSignal(sessionId: string, signal: string): boolean {
    const sessionKey = this.idIndex.get(sessionId);
    if (!sessionKey) {
      return false;
    }

    const session = this.activeSessions.get(sessionKey);
    if (!session || !session.isActive) {
      return false;
    }

    if (!session.isPty || !session.process) {
      return false;
    }

    try {
      session.process.write(signal);
      session.lastAccessedAt = Date.now();
      return true;
    } catch {
      return false;
    }
  }

  /**
   * AI セッションのリサイズ
   */
  resize(
    repositoryPath: string,
    provider: AiProvider,
    cols: number,
    rows: number
  ): boolean {
    const session = this.getByRepository(repositoryPath, provider);
    if (!session || !session.isActive || !session.process?.resize) {
      return false;
    }

    try {
      session.process.resize(cols, rows);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * AI セッションを終了
   */
  async terminate(sessionId: string): Promise<boolean> {
    const sessionKey = this.idIndex.get(sessionId);
    if (!sessionKey) {
      return false;
    }

    const session = this.activeSessions.get(sessionKey);
    if (!session) {
      return false;
    }

    try {
      // プロセス終了を待つPromiseを作成
      const exitPromise = new Promise<void>((resolve) => {
        session.process.onExit(() => {
          resolve();
        });
      });

      // SIGTERMを送信
      session.process.kill('SIGTERM');

      // タイムアウト後にSIGKILLを送信
      const killTimeout = setTimeout(() => {
        if (this.activeSessions.has(sessionKey)) {
          session.process.kill('SIGKILL');
        }
      }, this.config.gracefulTerminationTimeoutMs);

      // プロセスの終了を待つ（最大3秒）
      await Promise.race([
        exitPromise,
        new Promise<void>((resolve) => setTimeout(resolve, 3000)),
      ]);

      clearTimeout(killTimeout);

      // Mapから削除
      this.activeSessions.delete(sessionKey);
      this.idIndex.delete(session.id);
      this.outputBuffers.delete(sessionKey);
      this.registry.removeAiSession(session.id);

      return true;
    } catch {
      return false;
    }
  }

  /**
   * リポジトリの AI セッションを終了
   */
  async terminateByRepository(
    repositoryPath: string,
    provider: AiProvider
  ): Promise<boolean> {
    const session = this.getByRepository(repositoryPath, provider);
    if (!session) {
      return false;
    }
    return await this.terminate(session.id);
  }

  // ====================
  // 出力履歴管理
  // ====================

  /**
   * 出力履歴に新しい行を追加
   */
  private addToOutputHistory(
    session: ActiveAiSession,
    content: string,
    type: 'stdout' | 'stderr' | 'system'
  ): AiOutputLine {
    const outputLine: AiOutputLine = {
      id: `${session.id}-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`,
      content,
      timestamp: Date.now(),
      type,
      provider: session.provider,
    };

    // RingBufferを取得または作成
    const sessionKey = createSessionKey(
      session.repositoryPath,
      session.provider
    );
    let buffer = this.outputBuffers.get(sessionKey);
    if (!buffer) {
      buffer = new RingBuffer<AiOutputLine>(this.config.maxOutputLines);
      this.outputBuffers.set(sessionKey, buffer);
    }

    // RingBufferに追加
    buffer.push(outputLine);

    // セッションのoutputHistoryを更新
    session.outputHistory = buffer.toArray();

    return outputLine;
  }

  /**
   * 出力履歴を取得
   */
  getOutputHistory(
    repositoryPath: string,
    provider: AiProvider
  ): AiOutputLine[] {
    const session = this.getByRepository(repositoryPath, provider);
    if (session) {
      return session.outputHistory.slice(-this.config.maxOutputLines);
    }
    return [];
  }

  /**
   * 出力履歴をクリア
   */
  clearOutputHistory(repositoryPath: string, provider: AiProvider): boolean {
    const session = this.getByRepository(repositoryPath, provider);
    if (session) {
      session.outputHistory = [];
      const sessionKey = createSessionKey(repositoryPath, provider);
      const buffer = this.outputBuffers.get(sessionKey);
      if (buffer) {
        buffer.clear();
      }
      return true;
    }
    return false;
  }

  // ====================
  // セッション取得
  // ====================

  /**
   * セッションIDで取得
   */
  getById(sessionId: string): ActiveAiSession | undefined {
    const sessionKey = this.idIndex.get(sessionId);
    if (!sessionKey) return undefined;
    const session = this.activeSessions.get(sessionKey);
    return session?.isActive ? session : undefined;
  }

  /**
   * リポジトリとプロバイダーで取得
   */
  getByRepository(
    repositoryPath: string,
    provider: AiProvider
  ): ActiveAiSession | undefined {
    const sessionKey = createSessionKey(repositoryPath, provider);
    const session = this.activeSessions.get(sessionKey);
    return session?.isActive ? session : undefined;
  }

  /**
   * すべてのアクティブセッションを取得
   */
  getAll(): ActiveAiSession[] {
    return Array.from(this.activeSessions.values()).filter((s) => s.isActive);
  }

  /**
   * セッションIDが有効かチェック
   */
  isValidSessionId(sessionId: string): boolean {
    const sessionKey = this.idIndex.get(sessionId);
    if (!sessionKey) return false;
    const session = this.activeSessions.get(sessionKey);
    return session?.isActive === true;
  }

  /**
   * リポジトリにセッションが存在するかチェック
   */
  hasSessionForRepository(
    repositoryPath: string,
    provider: AiProvider
  ): boolean {
    return this.getByRepository(repositoryPath, provider) !== undefined;
  }
}
