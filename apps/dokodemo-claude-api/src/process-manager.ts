import * as pty from 'node-pty';
import { EventEmitter } from 'events';
import { promises as fs } from 'fs';
import path from 'path';
import {
  CommandShortcut,
  AiProvider,
  AiOutputLine,
  PromptQueueItem,
  PromptQueueState,
  RepoProcessStatus,
  PermissionMode,
  AiExecutionStatus,
  RepoDisplayAiStatus,
} from './types/index.js';

// 新しいマネージャーのインポート
import { PersistenceService } from './services/persistence-service.js';
import {
  ShortcutManager,
  TerminalManager,
  PromptQueueManager,
  ProcessRegistry,
  ProcessMonitor,
  CustomAiButtonManager,
} from './managers/index.js';
import { RingBuffer } from './utils/ring-buffer.js';
import { cleanChildEnv } from './utils/clean-env.js';

// Claude CLI出力履歴の行情報
export interface ClaudeOutputLine {
  id: string;
  content: string;
  timestamp: number;
  type: 'stdout' | 'stderr' | 'system';
}

// ターミナル出力履歴の行情報
export interface TerminalOutputLine {
  id: string;
  content: string;
  timestamp: number;
  type: 'stdout' | 'stderr' | 'system';
}

// 永続化されるAI CLIセッション情報
export interface PersistedAiSession {
  id: string;
  repositoryPath: string;
  repositoryName: string;
  pid: number;
  isActive: boolean;
  createdAt: number;
  lastAccessedAt: number;
  provider: AiProvider; // プロバイダー情報を追加
  outputHistory?: AiOutputLine[]; // 出力履歴を追加
}

// 後方互換性のためにPersistedClaudeSessionを維持
export interface PersistedClaudeSession {
  id: string;
  repositoryPath: string;
  repositoryName: string;
  pid: number;
  isActive: boolean;
  createdAt: number;
  lastAccessedAt: number;
  outputHistory?: ClaudeOutputLine[]; // 出力履歴を追加
}

// 永続化されるターミナル情報
export interface PersistedTerminal {
  id: string;
  repositoryPath: string;
  repositoryName: string;
  pid: number;
  name: string;
  status: 'active' | 'exited';
  createdAt: number;
  lastAccessedAt: number;
  outputHistory?: TerminalOutputLine[]; // 出力履歴を追加
}

// アクティブなAI CLIセッション
export interface ActiveAiSession extends PersistedAiSession {
  process: pty.IPty;
  isPty: boolean;
  outputHistory: AiOutputLine[]; // アクティブセッションでは必須
}

// 後方互換性のためにActiveClaudeSessionを維持
export interface ActiveClaudeSession extends PersistedClaudeSession {
  process: pty.IPty;
  isPty: boolean;
  outputHistory: ClaudeOutputLine[]; // アクティブセッションでは必須
}

// アクティブなターミナル
export interface ActiveTerminal extends PersistedTerminal {
  process: pty.IPty;
  outputHistory: TerminalOutputLine[]; // アクティブターミナルでは必須
}

interface AiExecutionState {
  repositoryPath: string;
  provider: AiProvider;
  status: AiExecutionStatus;
}

interface PersistedSelectedProvider {
  repositoryPath: string;
  provider: AiProvider;
  updatedAt: number;
}

/**
 * 永続プロセス管理システム
 * リポジトリごとにClaude CLIセッションとターミナルを管理
 */
export class ProcessManager extends EventEmitter {
  // 新しいマネージャー（ファサードパターン）
  private readonly persistenceService: PersistenceService;
  public readonly shortcutManager: ShortcutManager;
  public readonly terminalManager: TerminalManager;
  public readonly promptQueueManager: PromptQueueManager;
  public readonly customAiButtonManager: CustomAiButtonManager;

  // Phase 0-2 で追加されたマネージャー
  public readonly processRegistry: ProcessRegistry;
  public readonly processMonitor: ProcessMonitor;

  // マルチプロバイダー対応のセッション管理
  private aiSessions: Map<string, ActiveAiSession> = new Map(); // provider:repositoryPath → セッション
  private idIndex: Map<string, string> = new Map(); // sessionId → sessionKey (O(1)検索用)
  // 後方互換性のためにclaudeSessionsを維持
  private claudeSessions: Map<string, ActiveClaudeSession> = new Map();
  // ターミナルはTerminalManagerに完全委譲済み
  // ショートカットはShortcutManagerに完全委譲済み
  // プロンプトキューはPromptQueueManagerに完全委譲済み
  // RingBuffer: セッションごとの出力履歴バッファ（GC圧力軽減用）
  private aiOutputBuffers: Map<string, RingBuffer<AiOutputLine>> = new Map();
  private aiExecutionStates: Map<string, AiExecutionState> = new Map();
  private selectedProviders: Map<string, PersistedSelectedProvider> = new Map();
  private processesDir: string;
  private aiSessionsFile: string; // 古いプロセスクリーンアップ用
  private selectedProvidersFile = 'repo-provider-preferences.json';
  private sessionCounter = 0;
  private readonly MAX_OUTPUT_LINES = 500; // 最大出力行数

  private processMonitoringInterval: NodeJS.Timeout | null = null; // プロセス監視タイマー

  constructor(processesDir: string) {
    super();
    this.processesDir = processesDir;
    this.aiSessionsFile = path.join(processesDir, 'ai-sessions.json'); // 古いプロセスクリーンアップ用

    // 新しいマネージャーの初期化
    this.persistenceService = new PersistenceService(processesDir);

    // ProcessRegistry: 状態集中管理
    this.processRegistry = new ProcessRegistry();

    // ProcessMonitor: プロセス監視・クリーンアップ
    this.processMonitor = new ProcessMonitor(this.processRegistry, {
      onAiSessionCleaned: (sessionId, repositoryPath) => {
        this.emit('claude-session-cleaned', { sessionId, repositoryPath });
      },
      onTerminalCleaned: (terminalId, repositoryPath) => {
        this.emit('terminal-cleaned', { terminalId, repositoryPath });
      },
    });

    // TerminalManager: イベントをProcessManagerに転送
    this.terminalManager = new TerminalManager(this.persistenceService);
    this.terminalManager.on('terminal-created', (data) =>
      this.emit('terminal-created', data)
    );
    this.terminalManager.on('terminal-output', (data) =>
      this.emit('terminal-output', data)
    );
    this.terminalManager.on('terminal-exit', (data) =>
      this.emit('terminal-exit', data)
    );

    // ShortcutManager: ターミナルへの書き込み関数を提供
    this.shortcutManager = new ShortcutManager(this.persistenceService, {
      writeToTerminal: (terminalId: string, data: string) => {
        return this.sendToTerminal(terminalId, data);
      },
    });

    // CustomAiButtonManager: グローバル（全リポジトリ共通）のカスタム送信ボタン
    this.customAiButtonManager = new CustomAiButtonManager(this.persistenceService);

    // PromptQueueManager: AIセッションへのアダプターを提供
    this.promptQueueManager = new PromptQueueManager(this.persistenceService, {
      getSession: (repositoryPath: string, provider) => {
        const session = this.getAiSessionByRepository(repositoryPath, provider);
        if (!session) return null;
        return {
          id: session.id,
          repositoryPath: session.repositoryPath,
          provider: session.provider,
        };
      },
      sendCommand: (sessionId: string, command: string) => {
        this.sendToAiSession(sessionId, command);
      },
      ensureSession: async (repositoryPath: string, provider: AiProvider) => {
        const repositoryName = repositoryPath.split('/').pop() || 'unknown';
        const session = await this.ensureAiSession(
          repositoryPath,
          repositoryName,
          provider
        );
        return {
          id: session.id,
          repositoryPath: session.repositoryPath,
          provider: session.provider,
        };
      },
      getSessionStatus: (sessionId: string) => {
        // セッションのステータスを取得
        for (const session of this.aiSessions.values()) {
          if (session.id === sessionId) {
            return { isActive: session.isActive };
          }
        }
        return null;
      },
    });
    this.promptQueueManager.on('prompt-queue-updated', (data) =>
      this.emit('prompt-queue-updated', data)
    );
    this.promptQueueManager.on('prompt-queue-processing-started', (data) =>
      this.emit('prompt-queue-processing-started', data)
    );
    this.promptQueueManager.on('prompt-queue-processing-completed', (data) =>
      this.emit('prompt-queue-processing-completed', data)
    );
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
        // 環境変数から Claude CLI のパスを取得、デフォルトは claude コマンド
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
        // 環境変数から Codex CLI のパスを取得、デフォルトは codex コマンド
        const codexCommand = process.env.CODEX_CLI_COMMAND || 'codex';
        return {
          command: codexCommand,
          args: ['--full-auto'], // Codexはfull-autoモードで起動
        };
      }
      default:
        throw new Error(`Unsupported AI provider: ${provider}`);
    }
  }

  /**
   * セッションキーを生成（プロバイダー情報を含む）
   */
  private getSessionKey(repositoryPath: string, provider: AiProvider): string {
    return `${provider}:${repositoryPath}`;
  }

  private getAiExecutionStateKey(
    repositoryPath: string,
    provider: AiProvider
  ): string {
    return `${provider}:${repositoryPath}`;
  }

  private async loadSelectedProviders(): Promise<void> {
    const result = await this.persistenceService.loadMap<
      string,
      PersistedSelectedProvider
    >(
      this.selectedProvidersFile,
      (value) => value as PersistedSelectedProvider
    );

    if (!result.ok || result.value === null) {
      this.selectedProviders = new Map();
      return;
    }

    this.selectedProviders = result.value;
  }

  private async persistSelectedProviders(): Promise<void> {
    const result = await this.persistenceService.saveMap(
      this.selectedProvidersFile,
      this.selectedProviders
    );

    if (!result.ok) {
      console.error(
        '[ProcessManager] 選択中プロバイダーの保存に失敗:',
        result.error
      );
    }
  }

  getSelectedProvider(repositoryPath: string): AiProvider {
    return this.selectedProviders.get(repositoryPath)?.provider ?? 'claude';
  }

  async setSelectedProvider(
    repositoryPath: string,
    provider: AiProvider
  ): Promise<void> {
    const current = this.getSelectedProvider(repositoryPath);
    if (current === provider) {
      return;
    }

    this.selectedProviders.set(repositoryPath, {
      repositoryPath,
      provider,
      updatedAt: Date.now(),
    });

    await this.persistSelectedProviders();
    this.emit('selected-provider-changed', {
      repositoryPath,
      provider,
    });
  }

  getAiExecutionStatus(
    repositoryPath: string,
    provider: AiProvider
  ): AiExecutionStatus {
    const key = this.getAiExecutionStateKey(repositoryPath, provider);
    return this.aiExecutionStates.get(key)?.status ?? 'idle';
  }

  setAiExecutionStatus(
    repositoryPath: string,
    provider: AiProvider,
    status: AiExecutionStatus
  ): void {
    const key = this.getAiExecutionStateKey(repositoryPath, provider);
    const current = this.aiExecutionStates.get(key)?.status ?? 'idle';
    if (current === status) {
      return;
    }

    if (status === 'idle') {
      this.aiExecutionStates.delete(key);
    } else {
      this.aiExecutionStates.set(key, {
        repositoryPath,
        provider,
        status,
      });
    }

    this.emit('ai-execution-status-changed', {
      repositoryPath,
      provider,
      status,
    });
  }

  resetCompletedAiExecutionStatuses(repositoryPath: string): void {
    const providers: AiProvider[] = ['claude', 'codex'];

    for (const provider of providers) {
      if (this.getAiExecutionStatus(repositoryPath, provider) === 'completed') {
        this.setAiExecutionStatus(repositoryPath, provider, 'idle');
      }
    }
  }

  /**
   * プロセス管理システムの初期化
   */
  async initialize(): Promise<void> {
    await this.ensureProcessesDir();
    await this.cleanupOldAiSessions(); // 古いプロセスのクリーンアップ
    await this.loadSelectedProviders();
    await this.shortcutManager.initialize(); // ShortcutManager の初期化（委譲）
    await this.promptQueueManager.initialize(); // PromptQueueManager の初期化（委譲）
    await this.customAiButtonManager.initialize(); // CustomAiButtonManager の初期化（委譲）

    // 定期的なプロセス監視を開始
    this.startProcessMonitoring();
  }

  /**
   * プロセスディレクトリの作成
   */
  private async ensureProcessesDir(): Promise<void> {
    try {
      await fs.access(this.processesDir);
    } catch {
      await fs.mkdir(this.processesDir, { recursive: true });
    }
  }

  /**
   * 古いAIセッションプロセスをクリーンアップ
   * サーバー起動時に以前のプロセスを終了して、クリーンな状態で開始
   */
  private async cleanupOldAiSessions(): Promise<void> {
    try {
      // 永続化ファイルが存在するかチェック
      const fileExists = await fs
        .access(this.aiSessionsFile)
        .then(() => true)
        .catch(() => false);

      if (!fileExists) {
        return;
      }

      const data = await fs.readFile(this.aiSessionsFile, 'utf-8');
      const persistedSessions: PersistedAiSession[] = JSON.parse(data);

      for (const session of persistedSessions) {
        if (await this.isProcessAlive(session.pid)) {
          // サーバー再起動時は古いプロセスを終了（PTY接続を復元できないため）
          try {
            process.kill(session.pid, 'SIGTERM');
            // 少し待ってからSIGKILLを送信
            await new Promise<void>((resolve) => setTimeout(resolve, 1000));
            if (await this.isProcessAlive(session.pid)) {
              process.kill(session.pid, 'SIGKILL');
            }
          } catch {
            // エラーは無視
          }
        }
      }

      // 永続化ファイルを削除（もう使用しない）
      await fs.unlink(this.aiSessionsFile);
    } catch {
      // エラーは無視
    }
  }

  /**
   * プロセスが生きているかチェック
   */
  private async isProcessAlive(pid: number): Promise<boolean> {
    try {
      process.kill(pid, 0);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * 新しいAI CLIセッションを作成
   */
  async createAiSession(
    repositoryPath: string,
    repositoryName: string,
    provider: AiProvider,
    initialSize?: { cols: number; rows: number },
    permissionMode?: PermissionMode
  ): Promise<ActiveAiSession> {
    const sessionId = `${provider}-${++this.sessionCounter}-${Date.now()}`;
    const { command, args } = this.getProviderCommand(provider, permissionMode);

    // PTYを使用してAI CLIを対話モードで起動（初期サイズを使用、未指定時はデフォルト値）
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
      outputHistory: [], // 出力履歴を初期化
    };

    // プロセス監視（同一イベントループティック内のデータを集約して送信）
    let pendingOutput = '';
    let flushScheduled = false;

    aiProcess.onData((data: string) => {
      session.lastAccessedAt = Date.now();
      pendingOutput += data;

      if (!flushScheduled) {
        flushScheduled = true;
        setTimeout(() => {
          const bufferedData = pendingOutput;
          pendingOutput = '';
          flushScheduled = false;

          // 出力履歴に追加
          const outputLine = this.addToAiOutputHistory(
            session,
            bufferedData,
            'stdout'
          );

          // 構造化されたAiOutputLineオブジェクトをemit
          this.emit('ai-output', {
            sessionId: session.id,
            repositoryPath: session.repositoryPath,
            provider: session.provider,
            outputLine,
          });
        }, 16);
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
      const sessionKey = this.getSessionKey(repositoryPath, provider);
      this.aiSessions.delete(sessionKey);
      this.idIndex.delete(session.id); // idIndexからも削除
      this.aiOutputBuffers.delete(sessionKey); // RingBufferも削除
    });

    const sessionKey = this.getSessionKey(repositoryPath, provider);
    this.aiSessions.set(sessionKey, session);
    this.idIndex.set(session.id, sessionKey); // idIndexに登録（O(1)検索用）

    this.emit('ai-session-created', {
      sessionId: session.id,
      repositoryPath: session.repositoryPath,
      repositoryName: session.repositoryName,
      provider: session.provider,
    });
    return session;
  }

  /**
   * 新しいClaude CLIセッションを作成（後方互換性用）
   */
  async createClaudeSession(
    repositoryPath: string,
    repositoryName: string,
    permissionMode?: PermissionMode
  ): Promise<ActiveClaudeSession> {
    const sessionId = `claude-${++this.sessionCounter}-${Date.now()}`;

    // PTYを使用してClaude CLIを対話モードで起動
    // 環境変数から Claude CLI のパスを取得、デフォルトは claude コマンド
    const claudeCommand = process.env.CLAUDE_CLI_COMMAND || 'claude';
    const claudeArgs: string[] = [];
    if (permissionMode === 'dangerous' || permissionMode === undefined) {
      claudeArgs.push('--dangerously-skip-permissions');
    } else if (permissionMode === 'auto') {
      claudeArgs.push('--permission-mode', 'acceptEdits');
    }
    const claudeProcess = pty.spawn(
      claudeCommand,
      claudeArgs,
      {
        name: 'xterm-color',
        cols: 120,
        rows: 30,
        cwd: repositoryPath,
        env: cleanChildEnv({
          TERM: 'xterm-256color',
          COLORTERM: 'truecolor',
          FORCE_COLOR: '1',
          // ネストされたClaude Codeセッションエラーを防ぐために除外
          CLAUDECODE: undefined,
        }),
      }
    );

    const session: ActiveClaudeSession = {
      id: sessionId,
      repositoryPath,
      repositoryName,
      pid: claudeProcess.pid,
      isActive: true,
      isPty: true,
      process: claudeProcess,
      createdAt: Date.now(),
      lastAccessedAt: Date.now(),
      outputHistory: [], // 出力履歴を初期化
    };

    // プロセス監視（同一イベントループティック内のデータを集約して送信）
    let pendingClaudeOutput = '';
    let claudeFlushScheduled = false;

    claudeProcess.onData((data: string) => {
      session.lastAccessedAt = Date.now();
      pendingClaudeOutput += data;

      if (!claudeFlushScheduled) {
        claudeFlushScheduled = true;
        setTimeout(() => {
          const bufferedData = pendingClaudeOutput;
          pendingClaudeOutput = '';
          claudeFlushScheduled = false;

          // 出力履歴に追加
          this.addToOutputHistory(session, bufferedData, 'stdout');

          this.emit('claude-output', {
            sessionId: session.id,
            repositoryPath: session.repositoryPath,
            type: 'stdout',
            content: bufferedData,
          });
        }, 16);
      }
    });

    claudeProcess.onExit(({ exitCode, signal }) => {
      session.isActive = false;
      this.emit('claude-exit', {
        sessionId: session.id,
        repositoryPath: session.repositoryPath,
        exitCode,
        signal,
      });

      // セッションをクリーンアップ
      this.claudeSessions.delete(sessionId);
    });

    this.claudeSessions.set(sessionId, session);

    this.emit('claude-session-created', session);
    return session;
  }

  /**
   * 新しいターミナルを作成（TerminalManagerに委譲）
   */
  async createTerminal(
    repositoryPath: string,
    repositoryName: string,
    name?: string,
    initialSize?: { cols: number; rows: number }
  ): Promise<ActiveTerminal> {
    const result = await this.terminalManager.createTerminal(
      repositoryPath,
      repositoryName,
      name,
      initialSize
    );

    if (!result.ok) {
      throw new Error(result.error.message);
    }

    return result.value;
  }

  /**
   * リポジトリのAI CLIセッションを取得（なければ作成）
   */
  async getOrCreateAiSession(
    repositoryPath: string,
    repositoryName: string,
    provider: AiProvider,
    initialSize?: { cols: number; rows: number },
    permissionMode?: PermissionMode
  ): Promise<ActiveAiSession> {
    const sessionKey = this.getSessionKey(repositoryPath, provider);

    // 既存のアクティブセッションを検索
    const existingSession = this.aiSessions.get(sessionKey);
    if (existingSession && existingSession.isActive) {
      existingSession.lastAccessedAt = Date.now();
      // 既存セッションのサイズを更新
      if (initialSize && existingSession.process?.resize) {
        existingSession.process.resize(initialSize.cols, initialSize.rows);
      }
      return existingSession;
    }

    // 新しいセッションを作成
    return await this.createAiSession(
      repositoryPath,
      repositoryName,
      provider,
      initialSize,
      permissionMode
    );
  }

  /**
   * AI CLIセッションの確保（強制再起動オプション付き）
   */
  async ensureAiSession(
    repositoryPath: string,
    repositoryName: string,
    provider: AiProvider,
    options?: {
      forceRestart?: boolean;
      initialSize?: { cols: number; rows: number };
      permissionMode?: PermissionMode;
    }
  ): Promise<ActiveAiSession> {
    const sessionKey = this.getSessionKey(repositoryPath, provider);

    // 強制再起動が指定されている場合は既存セッションを終了
    if (options?.forceRestart) {
      const existingSession = this.aiSessions.get(sessionKey);
      if (existingSession) {
        await this.closeAiSession(sessionKey);
      }
    }

    // セッションを取得または作成
    return await this.getOrCreateAiSession(
      repositoryPath,
      repositoryName,
      provider,
      options?.initialSize,
      options?.permissionMode
    );
  }

  /**
   * リポジトリのClaude CLIセッションを取得（なければ作成）（後方互換性用）
   */
  async getOrCreateClaudeSession(
    repositoryPath: string,
    repositoryName: string
  ): Promise<ActiveClaudeSession> {
    // 既存のアクティブセッションを検索
    for (const session of this.claudeSessions.values()) {
      if (session.repositoryPath === repositoryPath && session.isActive) {
        session.lastAccessedAt = Date.now();
        return session;
      }
    }

    // 新しいセッションを作成
    return await this.createClaudeSession(repositoryPath, repositoryName);
  }

  /**
   * AI出力履歴に新しい行を追加
   * RingBufferを使用してGC圧力を軽減
   */
  private addToAiOutputHistory(
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
    const sessionKey = this.getSessionKey(
      session.repositoryPath,
      session.provider
    );
    let buffer = this.aiOutputBuffers.get(sessionKey);
    if (!buffer) {
      buffer = new RingBuffer<AiOutputLine>(this.MAX_OUTPUT_LINES);
      this.aiOutputBuffers.set(sessionKey, buffer);
    }

    // RingBufferに追加
    buffer.push(outputLine);

    // セッションのoutputHistoryを更新（参照用）
    session.outputHistory = buffer.toArray();

    return outputLine;
  }

  /**
   * 出力履歴に新しい行を追加（後方互換性用）
   */
  private addToOutputHistory(
    session: ActiveClaudeSession,
    content: string,
    type: 'stdout' | 'stderr' | 'system'
  ): void {
    const outputLine: ClaudeOutputLine = {
      id: `${session.id}-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`,
      content,
      timestamp: Date.now(),
      type,
    };

    session.outputHistory.push(outputLine);

    // 最大行数を超えた場合、古い行を削除
    if (session.outputHistory.length > this.MAX_OUTPUT_LINES) {
      session.outputHistory = session.outputHistory.slice(
        -this.MAX_OUTPUT_LINES
      );
    }
  }

  /**
   * セッションIDからリポジトリパスを逆引き
   */
  getRepositoryPathBySessionId(sessionId: string, provider: AiProvider): string | null {
    for (const session of this.aiSessions.values()) {
      if (session.id === sessionId && session.provider === provider && session.isActive) {
        return session.repositoryPath;
      }
    }
    return null;
  }

  /**
   * 指定されたリポジトリとプロバイダーのAI出力履歴を取得
   */
  getAiOutputHistory(
    repositoryPath: string,
    provider: AiProvider
  ): AiOutputLine[] {
    const sessionKey = this.getSessionKey(repositoryPath, provider);

    // アクティブなセッションから履歴を取得
    const session = this.aiSessions.get(sessionKey);
    if (session) {
      // 最新の500行に制限
      return session.outputHistory.slice(-500);
    }

    return [];
  }

  /**
   * 指定されたリポジトリのClaude出力履歴を取得（後方互換性用）
   */
  getOutputHistory(repositoryPath: string): ClaudeOutputLine[] {
    // アクティブなセッションから履歴を取得
    const session = this.getClaudeSessionByRepository(repositoryPath);
    if (session) {
      // 最新の500行に制限
      return session.outputHistory.slice(-500);
    }

    return [];
  }

  /**
   * 指定されたリポジトリのClaude出力履歴をクリア
   */
  clearClaudeOutputHistory(repositoryPath: string): boolean {
    // アクティブなセッションから履歴をクリア
    const session = this.getClaudeSessionByRepository(repositoryPath);
    if (session) {
      session.outputHistory = [];
      return true;
    }
    return false;
  }

  /**
   * 指定されたリポジトリとプロバイダーのAI出力履歴をクリア
   */
  clearAiOutputHistory(repositoryPath: string, provider: AiProvider): boolean {
    // アクティブなセッションから履歴をクリア
    const session = this.getAiSessionByRepository(repositoryPath, provider);
    if (session) {
      session.outputHistory = [];
      // RingBufferもクリア
      const sessionKey = this.getSessionKey(repositoryPath, provider);
      const buffer = this.aiOutputBuffers.get(sessionKey);
      if (buffer) {
        buffer.clear();
      }
      return true;
    }
    return false;
  }

  /**
   * 指定されたターミナルの出力履歴を取得（TerminalManagerに委譲）
   */
  getTerminalOutputHistory(terminalId: string): TerminalOutputLine[] {
    return this.terminalManager.getTerminalOutputHistory(terminalId);
  }

  /**
   * 定期的なプロセス監視を開始
   */
  private startProcessMonitoring(): void {
    this.processMonitoringInterval = setInterval(async () => {
      await this.cleanupDeadProcesses();
    }, 30000); // 30秒ごと
  }

  /**
   * 死んだプロセスのクリーンアップ
   */
  private async cleanupDeadProcesses(): Promise<void> {
    // Claude CLIセッションのクリーンアップ
    for (const [sessionId, session] of this.claudeSessions) {
      if (!(await this.isProcessAlive(session.pid))) {
        this.claudeSessions.delete(sessionId);
        this.emit('claude-session-cleaned', {
          sessionId,
          repositoryPath: session.repositoryPath,
        });
      }
    }

    // ターミナルのクリーンアップ（TerminalManagerに委譲）
    const cleanedTerminals = this.terminalManager.cleanupDeadProcesses();
    for (const { terminalId, repositoryPath } of cleanedTerminals) {
      this.emit('terminal-cleaned', {
        terminalId,
        repositoryPath,
      });
    }
  }

  /**
   * AI CLIセッションへの入力送信（O(1)検索）
   */
  sendToAiSession(sessionId: string, input: string): boolean {
    // idIndexからsessionKeyをO(1)で検索
    const sessionKey = this.idIndex.get(sessionId);
    if (!sessionKey) {
      return false;
    }

    const session = this.aiSessions.get(sessionKey);
    if (!session || !session.isActive) {
      return false;
    }

    // PTY接続がない場合（復帰されたセッション）は、古いプロセスを終了してから新しいセッションを作成
    if (!session.isPty || !session.process) {
      // 非同期で処理
      (async () => {
        // 古いプロセスが生きていれば終了
        if (session.pid && (await this.isProcessAlive(session.pid))) {
          try {
            process.kill(session.pid, 'SIGTERM');

            // 少し待ってからSIGKILLを送信
            await new Promise<void>((resolve) => setTimeout(resolve, 2000));
            if (await this.isProcessAlive(session.pid)) {
              process.kill(session.pid, 'SIGKILL');
            }
          } catch {
            // エラーは無視
          }
        }

        // 古いセッションを削除
        this.aiSessions.delete(sessionKey);
        this.idIndex.delete(sessionId);
        this.aiOutputBuffers.delete(sessionKey); // RingBufferも削除

        // 新しいセッションを作成
        try {
          const newSession = await this.createAiSession(
            session.repositoryPath,
            session.repositoryName,
            session.provider
          );
          // 新しいセッションでコマンドを送信
          if (newSession.process) {
            newSession.process.write(input);
          }
        } catch {
          console.error('❌ 新しいセッションの作成に失敗しました');
        }
      })();

      return true;
    }

    try {
      session.process.write(input);
      session.lastAccessedAt = Date.now();
      return true;
    } catch (e) {
      console.error(`sendToAiSession write error: sessionId=${sessionId}`, e);
      return false;
    }
  }

  /**
   * AI CLIセッションへのシグナル送信（O(1)検索）
   * Ctrl+C (SIGINT) などのシグナルを送信
   */
  sendSignalToAiSession(sessionId: string, signal: string): boolean {
    // idIndexからsessionKeyをO(1)で検索
    const sessionKey = this.idIndex.get(sessionId);
    if (!sessionKey) {
      return false;
    }

    const session = this.aiSessions.get(sessionKey);
    if (!session || !session.isActive) {
      return false;
    }

    // PTY接続がない場合は失敗
    if (!session.isPty || !session.process) {
      return false;
    }

    try {
      session.process.write(signal);
      session.lastAccessedAt = Date.now();
      return true;
    } catch {
      // Failed to send signal to AI session
      return false;
    }
  }

  /**
   * Claude CLIセッションへの入力送信（後方互換性用）
   */
  sendToClaudeSession(sessionId: string, input: string): boolean {
    const session = this.claudeSessions.get(sessionId);
    if (!session || !session.isActive) {
      return false;
    }

    // PTY接続がない場合（復帰されたセッション）は、新しいセッションを作成
    if (!session.isPty || !session.process) {
      // 非同期で新しいセッションを作成
      this.createClaudeSession(session.repositoryPath, session.repositoryName)
        .then((newSession) => {
          // 古いセッションを削除
          this.claudeSessions.delete(sessionId);
          // 新しいセッションでコマンドを送信
          if (newSession.process) {
            newSession.process.write(input);
          }
        })
        .catch(() => {
          // Failed to create new session
        });
      return true;
    }

    try {
      session.process.write(input);
      session.lastAccessedAt = Date.now();
      return true;
    } catch {
      // Failed to send input to Claude session
      return false;
    }
  }

  /**
   * ターミナルへの入力送信（TerminalManagerに委譲）
   */
  sendToTerminal(terminalId: string, input: string): boolean {
    const result = this.terminalManager.sendToTerminal(terminalId, input);
    return result.ok;
  }

  /**
   * ターミナルのリサイズ（TerminalManagerに委譲）
   */
  resizeTerminal(terminalId: string, cols: number, rows: number): boolean {
    const result = this.terminalManager.resizeTerminal(terminalId, cols, rows);
    return result.ok;
  }

  /**
   * AI CLIセッションのリサイズ
   */
  resizeAiSession(
    repositoryPath: string,
    provider: AiProvider,
    cols: number,
    rows: number
  ): boolean {
    const session = this.getAiSessionByRepository(repositoryPath, provider);
    if (!session || !session.isActive) {
      return false;
    }

    try {
      if (session.isPty) {
        (session.process as pty.IPty).resize(cols, rows);
        return true;
      } else {
        return false;
      }
    } catch {
      return false;
    }
  }

  /**
   * ターミナルへのシグナル送信（TerminalManagerに委譲）
   */
  sendSignalToTerminal(terminalId: string, signal: string): boolean {
    const result = this.terminalManager.sendSignalToTerminal(
      terminalId,
      signal
    );
    return result.ok;
  }

  /**
   * Claude CLIセッションの終了
   */
  async closeClaudeSession(sessionId: string): Promise<boolean> {
    const session = this.claudeSessions.get(sessionId);
    if (!session) {
      return false;
    }

    try {
      session.process.kill('SIGTERM');
      const killTimeout = setTimeout(() => {
        if (this.claudeSessions.has(sessionId)) {
          session.process.kill('SIGKILL');
        }
      }, 2000);

      // セッションが終了したらタイムアウトをクリア
      session.process.onExit(() => {
        clearTimeout(killTimeout);
      });

      return true;
    } catch {
      // Failed to close Claude session
      return false;
    }
  }

  /**
   * AIセッションの終了（provider別）
   */
  async closeAiSession(sessionKey: string): Promise<boolean> {
    const session = this.aiSessions.get(sessionKey);
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

      // 2秒後にSIGKILLを送信するタイムアウトを設定
      const killTimeout = setTimeout(() => {
        if (this.aiSessions.has(sessionKey)) {
          session.process.kill('SIGKILL');
        }
      }, 2000);

      // プロセスの終了を待つ（最大3秒）
      await Promise.race([
        exitPromise,
        new Promise<void>((resolve) => setTimeout(resolve, 3000)),
      ]);

      clearTimeout(killTimeout);

      // Mapから削除
      this.aiSessions.delete(sessionKey);
      this.idIndex.delete(session.id);
      this.aiOutputBuffers.delete(sessionKey); // RingBufferも削除

      return true;
    } catch {
      // Failed to close AI session
      return false;
    }
  }

  /**
   * ターミナルの終了（TerminalManagerに委譲）
   */
  async closeTerminal(terminalId: string): Promise<boolean> {
    const result = await this.terminalManager.closeTerminal(terminalId);
    return result.ok;
  }

  /**
   * リポジトリとプロバイダーのAI CLIセッションを取得
   */
  getAiSessionByRepository(
    repositoryPath: string,
    provider: AiProvider
  ): ActiveAiSession | undefined {
    const sessionKey = this.getSessionKey(repositoryPath, provider);
    const session = this.aiSessions.get(sessionKey);
    return session && session.isActive ? session : undefined;
  }

  /**
   * sessionIdが有効（存在かつアクティブ）かチェック
   */
  isValidAiSessionId(sessionId: string): boolean {
    const sessionKey = this.idIndex.get(sessionId);
    if (!sessionKey) return false;

    const session = this.aiSessions.get(sessionKey);
    return session?.isActive === true;
  }

  /**
   * リポジトリのClaude CLIセッションを取得（後方互換性用）
   */
  getClaudeSessionByRepository(
    repositoryPath: string
  ): ActiveClaudeSession | undefined {
    for (const session of this.claudeSessions.values()) {
      if (session.repositoryPath === repositoryPath && session.isActive) {
        return session;
      }
    }
    return undefined;
  }

  /**
   * リポジトリのターミナル一覧を取得（TerminalManagerに委譲）
   */
  getTerminalsByRepository(repositoryPath: string): ActiveTerminal[] {
    return this.terminalManager.getTerminalsByRepository(repositoryPath);
  }

  /**
   * 全ターミナル一覧を取得（TerminalManagerに委譲）
   */
  getAllTerminals(): ActiveTerminal[] {
    return this.terminalManager.getAllTerminals();
  }

  /**
   * 全Claude CLIセッション一覧を取得
   */
  getAllClaudeSessions(): ActiveClaudeSession[] {
    return Array.from(this.claudeSessions.values());
  }

  /**
   * リポジトリに関連するプロセスのクリーンアップ
   */
  async cleanupRepositoryProcesses(repositoryPath: string): Promise<void> {
    // Cleaning up processes for repository

    const closePromises: Promise<boolean>[] = [];

    // 該当リポジトリのAI CLIセッションを終了（全プロバイダー）
    for (const [sessionKey, session] of this.aiSessions.entries()) {
      if (session.repositoryPath === repositoryPath) {
        closePromises.push(this.closeAiSession(sessionKey));
      }
    }

    // 該当リポジトリのClaude CLIセッション（後方互換性）も終了
    for (const [sessionId, session] of this.claudeSessions.entries()) {
      if (session.repositoryPath === repositoryPath) {
        closePromises.push(this.closeClaudeSession(sessionId));
      }
    }

    // 該当リポジトリのターミナルを終了（TerminalManagerに委譲）
    const repoTerminals =
      this.terminalManager.getTerminalsByRepository(repositoryPath);
    for (const terminal of repoTerminals) {
      closePromises.push(this.closeTerminal(terminal.id));
    }

    await Promise.all(closePromises);

    // コマンドショートカットをクリーンアップ
    await this.cleanupRepositoryShortcuts(repositoryPath);

    // プロンプトキューをクリーンアップ
    await this.cleanupRepositoryPromptQueues(repositoryPath);

    const providers: AiProvider[] = ['claude', 'codex'];
    for (const provider of providers) {
      this.setAiExecutionStatus(repositoryPath, provider, 'idle');
    }

    // Cleanup completed
  }

  /**
   * リポジトリのプロセスを停止する（リポジトリは削除しない）
   * - AIセッション終了
   * - ターミナル終了
   * - プロンプトキュー一時停止
   * ※永続化データやショートカットは削除しない
   */
  async stopRepositoryProcesses(repositoryPath: string): Promise<{
    aiSessionsClosed: number;
    terminalsClosed: number;
    success: boolean;
  }> {
    let aiSessionsClosed = 0;
    let terminalsClosed = 0;

    const closePromises: Promise<boolean>[] = [];

    // 該当リポジトリのAI CLIセッションを終了（全プロバイダー）
    for (const [sessionKey, session] of this.aiSessions.entries()) {
      if (session.repositoryPath === repositoryPath) {
        closePromises.push(
          this.closeAiSession(sessionKey).then((result) => {
            if (result) aiSessionsClosed++;
            return result;
          })
        );
      }
    }

    // 該当リポジトリのClaude CLIセッション（後方互換性）も終了
    for (const [sessionId, session] of this.claudeSessions.entries()) {
      if (session.repositoryPath === repositoryPath) {
        closePromises.push(
          this.closeClaudeSession(sessionId).then((result) => {
            if (result) aiSessionsClosed++;
            return result;
          })
        );
      }
    }

    // 該当リポジトリのターミナルを終了（TerminalManagerに委譲）
    const repoTerminals =
      this.terminalManager.getTerminalsByRepository(repositoryPath);
    for (const terminal of repoTerminals) {
      closePromises.push(
        this.closeTerminal(terminal.id).then((result) => {
          if (result) terminalsClosed++;
          return result;
        })
      );
    }

    await Promise.all(closePromises);

    // プロンプトキューを一時停止
    const providers: AiProvider[] = ['claude', 'codex'];
    for (const provider of providers) {
      await this.pausePromptQueue(repositoryPath, provider);
      this.setAiExecutionStatus(repositoryPath, provider, 'idle');
    }

    return {
      aiSessionsClosed,
      terminalsClosed,
      success: true,
    };
  }

  /**
   * 特定リポジトリのプロセス状態を取得
   */
  getRepositoryProcessStatus(
    repositoryPath: string,
    rid: string
  ): RepoProcessStatus {
    const aiExecutionStatuses: Record<AiProvider, AiExecutionStatus> = {
      claude: this.getAiExecutionStatus(repositoryPath, 'claude'),
      codex: this.getAiExecutionStatus(repositoryPath, 'codex'),
    };
    const selectedProvider = this.getSelectedProvider(repositoryPath);

    // AIセッション数をカウント
    let aiSessions = 0;
    for (const [, session] of this.aiSessions.entries()) {
      if (session.repositoryPath === repositoryPath) {
        aiSessions++;
      }
    }
    // 後方互換性のためClaudeセッションもカウント
    for (const [, session] of this.claudeSessions.entries()) {
      if (session.repositoryPath === repositoryPath) {
        aiSessions++;
      }
    }

    // ターミナル数をカウント（TerminalManagerに委譲）
    const terminals =
      this.terminalManager.getTerminalsByRepository(repositoryPath).length;

    // プロンプトキューの保留数を取得（PromptQueueManagerに委譲）
    let promptQueuePending = 0;
    const providers: AiProvider[] = ['claude', 'codex'];
    for (const provider of providers) {
      const queue = this.promptQueueManager.getQueue(repositoryPath, provider);
      promptQueuePending += queue.filter(
        (item) => item.status === 'pending'
      ).length;
    }

    let displayAiStatus: RepoDisplayAiStatus = 'ready';
    if (providers.some((provider) => aiExecutionStatuses[provider] === 'running')) {
      displayAiStatus = 'running';
    } else if (
      providers.some((provider) => aiExecutionStatuses[provider] === 'completed')
    ) {
      displayAiStatus = 'done';
    }

    let displayProvider = selectedProvider;
    const runningProvider = providers.find(
      (provider) => aiExecutionStatuses[provider] === 'running'
    );
    const completedProvider = providers.find(
      (provider) => aiExecutionStatuses[provider] === 'completed'
    );

    if (runningProvider) {
      displayProvider = runningProvider;
    } else if (completedProvider) {
      displayProvider = completedProvider;
    }

    return {
      rid,
      repositoryPath,
      aiSessions,
      terminals,
      promptQueuePending,
      aiExecutionStatuses,
      selectedProvider,
      displayAiStatus,
      displayProvider,
    };
  }

  /**
   * 全リポジトリのプロセス状態を取得
   */
  getAllRepositoriesProcessStatus(
    repositoryPaths: { path: string; rid: string }[]
  ): RepoProcessStatus[] {
    return repositoryPaths.map(({ path, rid }) =>
      this.getRepositoryProcessStatus(path, rid)
    );
  }

  // ===== コマンドショートカット管理メソッド（ShortcutManagerに委譲） =====

  /**
   * 新しいコマンドショートカットを作成（ShortcutManagerに委譲）
   */
  async createShortcut(
    name: string | undefined,
    command: string,
    repositoryPath: string
  ): Promise<CommandShortcut> {
    const result = await this.shortcutManager.createShortcut(
      name,
      command,
      repositoryPath
    );

    if (!result.ok) {
      throw new Error(result.error.message);
    }

    return result.value;
  }

  /**
   * コマンドショートカットを削除（ShortcutManagerに委譲）
   */
  async deleteShortcut(shortcutId: string): Promise<boolean> {
    const result = await this.shortcutManager.deleteShortcut(shortcutId);
    return result.ok;
  }

  /**
   * 指定リポジトリのコマンドショートカット一覧を取得（ShortcutManagerに委譲）
   */
  getShortcutsByRepository(repositoryPath: string): CommandShortcut[] {
    return this.shortcutManager.getShortcutsByRepository(repositoryPath);
  }

  /**
   * コマンドショートカットを実行（ShortcutManagerに委譲）
   */
  executeShortcut(shortcutId: string, terminalId: string): boolean {
    // ターミナルからリポジトリパスを取得
    const terminal = this.terminalManager.getTerminal(terminalId);
    const repositoryPath = terminal?.repositoryPath;

    const result = this.shortcutManager.executeShortcut(
      shortcutId,
      terminalId,
      repositoryPath
    );
    return result.ok && result.value;
  }

  /**
   * リポジトリ削除時のコマンドショートカットクリーンアップ（ShortcutManagerに委譲）
   */
  async cleanupRepositoryShortcuts(repositoryPath: string): Promise<void> {
    await this.shortcutManager.cleanupRepositoryShortcuts(repositoryPath);
  }

  /**
   * システム終了時のクリーンアップ
   */
  async shutdown(): Promise<void> {
    // Shutting down ProcessManager

    // プロセス監視を停止
    if (this.processMonitoringInterval) {
      clearInterval(this.processMonitoringInterval);
      this.processMonitoringInterval = null;
    }

    // 全てのプロセスを終了
    const closePromises: Promise<boolean>[] = [];

    // AIセッションを終了
    for (const sessionKey of this.aiSessions.keys()) {
      closePromises.push(this.closeAiSession(sessionKey));
    }

    // Claude CLIセッション（後方互換性）を終了
    for (const sessionId of this.claudeSessions.keys()) {
      closePromises.push(this.closeClaudeSession(sessionId));
    }

    // ターミナルを終了（TerminalManagerに委譲）
    await this.terminalManager.shutdown();

    await Promise.all(closePromises);

    // 必要な設定のみ永続化
    await this.shortcutManager.shutdown(); // ShortcutManager のシャットダウン（永続化を含む）

    // ProcessManager shutdown completed
  }

  // ============================================================================
  // プロンプトキュー管理（PromptQueueManagerに委譲）
  // ============================================================================

  /**
   * プロンプトをキューに追加（PromptQueueManagerに委譲）
   */
  async addToPromptQueue(
    repositoryPath: string,
    provider: AiProvider,
    prompt: string,
    sendClearBefore?: boolean,
    isAutoCommit?: boolean,
    model?: string,
    isCodexReview?: boolean
  ): Promise<PromptQueueItem> {
    const result = await this.promptQueueManager.addToQueue(
      repositoryPath,
      provider,
      prompt,
      { sendClearBefore, isAutoCommit, model, isCodexReview }
    );

    if (!result.ok) {
      throw new Error(result.error.message);
    }

    return result.value;
  }

  /**
   * hookイベントからキュー処理を継続（PromptQueueManagerに委譲）
   */
  async triggerQueueFromHook(
    repositoryPath: string,
    provider: AiProvider
  ): Promise<void> {
    await this.promptQueueManager.triggerFromHook(repositoryPath, provider);
  }

  /**
   * プロンプトキューを取得（PromptQueueManagerに委譲）
   */
  getPromptQueue(
    repositoryPath: string,
    provider: AiProvider
  ): PromptQueueItem[] {
    return this.promptQueueManager.getQueue(repositoryPath, provider);
  }

  /**
   * プロンプトキューの状態を取得（PromptQueueManagerに委譲）
   */
  getPromptQueueState(
    repositoryPath: string,
    provider: AiProvider
  ): PromptQueueState | undefined {
    return this.promptQueueManager.getQueueState(repositoryPath, provider);
  }

  /**
   * キューからアイテムを削除（PromptQueueManagerに委譲）
   */
  async removeFromPromptQueue(
    repositoryPath: string,
    provider: AiProvider,
    itemId: string
  ): Promise<boolean> {
    const result = await this.promptQueueManager.removeFromQueue(
      repositoryPath,
      provider,
      itemId
    );
    return result.ok;
  }

  /**
   * 完了または失敗したプロンプトキューアイテムを待機中に戻す（PromptQueueManagerに委譲）
   */
  async requeuePromptItem(
    repositoryPath: string,
    provider: AiProvider,
    itemId: string
  ): Promise<boolean> {
    const result = await this.promptQueueManager.requeueItem(
      repositoryPath,
      provider,
      itemId
    );
    return result.ok;
  }

  /**
   * プロンプトキューアイテムを強制送信（PromptQueueManagerに委譲）
   */
  async forceSendPromptItem(
    repositoryPath: string,
    provider: AiProvider,
    itemId: string
  ): Promise<boolean> {
    const result = await this.promptQueueManager.forceSendItem(
      repositoryPath,
      provider,
      itemId
    );
    return result.ok;
  }

  /**
   * プロンプトキューをクリア（PromptQueueManagerに委譲）
   */
  async clearPromptQueue(
    repositoryPath: string,
    provider: AiProvider
  ): Promise<void> {
    await this.promptQueueManager.clearQueue(repositoryPath, provider);
  }

  /**
   * プロンプトキューを一時停止（PromptQueueManagerに委譲）
   */
  async pausePromptQueue(
    repositoryPath: string,
    provider: AiProvider
  ): Promise<void> {
    await this.promptQueueManager.pauseQueue(repositoryPath, provider);
  }

  /**
   * プロンプトキューを再開（PromptQueueManagerに委譲）
   */
  async resumePromptQueue(
    repositoryPath: string,
    provider: AiProvider
  ): Promise<void> {
    await this.promptQueueManager.resumeQueue(repositoryPath, provider);
  }

  /**
   * 現在処理中のキューアイテムをキャンセルして未送信に戻す（PromptQueueManagerに委譲）
   */
  async cancelCurrentQueueItem(
    repositoryPath: string,
    provider: AiProvider
  ): Promise<boolean> {
    const result = await this.promptQueueManager.cancelCurrentItem(
      repositoryPath,
      provider
    );

    if (result.ok) {
      return true;
    }

    console.error(
      `[${provider}] キューアイテムのキャンセルに失敗:`,
      result.error.message
    );
    return false;
  }

  /**
   * プロンプトキューを並び替え（PromptQueueManagerに委譲）
   */
  async reorderPromptQueue(
    repositoryPath: string,
    provider: AiProvider,
    reorderedQueue: PromptQueueItem[]
  ): Promise<void> {
    const itemIds = reorderedQueue.map((item) => item.id);
    await this.promptQueueManager.reorderQueue(
      repositoryPath,
      provider,
      itemIds
    );
  }

  /**
   * プロンプトキューアイテムを更新（PromptQueueManagerに委譲）
   */
  async updatePromptQueue(
    repositoryPath: string,
    provider: AiProvider,
    itemId: string,
    prompt?: string,
    sendClearBefore?: boolean,
    isAutoCommit?: boolean,
    model?: string,
    isCodexReview?: boolean
  ): Promise<boolean> {
    const result = await this.promptQueueManager.updateItem(
      repositoryPath,
      provider,
      itemId,
      { prompt, sendClearBefore, isAutoCommit, model, isCodexReview }
    );
    return result.ok && result.value;
  }

  /**
   * プロンプトキューをリセット（PromptQueueManagerに委譲）
   */
  async resetPromptQueue(
    repositoryPath: string,
    provider: AiProvider
  ): Promise<void> {
    await this.promptQueueManager.resetQueue(repositoryPath, provider);
  }

  /**
   * リポジトリ削除時に関連するプロンプトキューをクリーンアップ（PromptQueueManagerに委譲）
   */
  async cleanupRepositoryPromptQueues(repositoryPath: string): Promise<void> {
    await this.promptQueueManager.cleanupRepository(repositoryPath);
  }
}
