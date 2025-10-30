import * as pty from 'node-pty';
import { EventEmitter } from 'events';
import { promises as fs } from 'fs';
import { spawn } from 'child_process';
import net from 'net';

import path from 'path';
import os from 'os';
import {
  CommandShortcut,
  AutoModeConfig,
  AutoModeState,
  ReviewServer,
  DiffConfig,
  AiProvider,
  AiOutputLine,
} from './types/index.js';

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

/**
 * 永続プロセス管理システム
 * リポジトリごとにClaude CLIセッションとターミナルを管理
 */
export class ProcessManager extends EventEmitter {
  // マルチプロバイダー対応のセッション管理
  private aiSessions: Map<string, ActiveAiSession> = new Map(); // provider:repositoryPath → セッション
  private idIndex: Map<string, string> = new Map(); // sessionId → sessionKey (O(1)検索用)
  // 後方互換性のためにclaudeSessionsを維持
  private claudeSessions: Map<string, ActiveClaudeSession> = new Map();
  private terminals: Map<string, ActiveTerminal> = new Map();
  private shortcuts: Map<string, CommandShortcut> = new Map();
  private autoModeConfigs: Map<string, AutoModeConfig> = new Map();
  private autoModeStates: Map<string, AutoModeState> = new Map();
  private autoModeTimers: Map<string, NodeJS.Timeout> = new Map(); // 待機中のタイマーを管理
  private reviewServers: Map<string, ReviewServer> = new Map(); // リポジトリパス → ReviewServer
  private processesDir: string;
  private aiSessionsFile: string; // 新しいAIセッション永続化ファイル
  private claudeSessionsFile: string; // 後方互換性用
  private terminalsFile: string;
  private shortcutsFile: string;
  private autoModeConfigsFile: string;
  private autoModeStatesFile: string;
  private sessionCounter = 0;
  private terminalCounter = 0;
  private shortcutCounter = 0;
  private autoModeConfigCounter = 0;
  private readonly MAX_OUTPUT_LINES = 500; // 最大出力行数
  private processMonitoringInterval: NodeJS.Timeout | null = null; // プロセス監視タイマー

  constructor(processesDir: string) {
    super();
    this.processesDir = processesDir;
    this.aiSessionsFile = path.join(processesDir, 'ai-sessions.json'); // 新しいファイル
    this.claudeSessionsFile = path.join(processesDir, 'claude-sessions.json'); // 後方互換性用
    this.terminalsFile = path.join(processesDir, 'terminals.json');
    this.shortcutsFile = path.join(processesDir, 'command-shortcuts.json');
    this.autoModeConfigsFile = path.join(processesDir, 'automode-configs.json');
    this.autoModeStatesFile = path.join(processesDir, 'automode-states.json');
  }

  /**
   * プロバイダーのCLIコマンドと引数を取得
   */
  private getProviderCommand(provider: AiProvider): {
    command: string;
    args: string[];
  } {
    switch (provider) {
      case 'claude':
        // 環境変数から Claude CLI のパスを取得、デフォルトは ~/.claude/local/claude
        const claudeCommand =
          process.env.CLAUDE_CLI_COMMAND ||
          `${process.env.HOME}/.claude/local/claude`;
        return {
          command: claudeCommand,
          args: ['--dangerously-skip-permissions', '--model', 'opusplan'],
        };
      case 'codex':
        // Codex CLIの設定
        const codexCommand = process.env.CODEX_CLI_COMMAND || 'codex';
        const codexArgs = process.env.CODEX_CLI_ARGS?.split(' ') || [];

        // TTYを無効にする設定があれば追加
        if (process.env.CODEX_CLI_NO_TTY === 'true') {
          codexArgs.push('--no-tty');
        }

        return {
          command: codexCommand,
          args: codexArgs,
        };
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

  /**
   * プロセス管理システムの初期化
   */
  async initialize(): Promise<void> {
    await this.ensureProcessesDir();
    await this.migrateAndRestoreAiSessions(); // 移行処理付きの復元
    await this.restoreClaudeSessions(); // 後方互換性用
    await this.restoreTerminals();
    await this.restoreShortcuts();
    await this.restoreAutoModeConfigs();
    await this.restoreAutoModeStates();

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
   * 移行処理付きのAIセッション復元
   */
  private async migrateAndRestoreAiSessions(): Promise<void> {
    try {
      // 新しいAIセッションファイルが存在するかチェック
      const newFileExists = await fs
        .access(this.aiSessionsFile)
        .then(() => true)
        .catch(() => false);

      if (newFileExists) {
        // 新しいファイルが存在する場合、そのまま復元
        const data = await fs.readFile(this.aiSessionsFile, 'utf-8');
        const persistedSessions: PersistedAiSession[] = JSON.parse(data);

        for (const session of persistedSessions) {
          if (await this.isProcessAlive(session.pid)) {
            // プロセスが生きている場合の処理は後で実装
          }
        }
      } else {
        // 新しいファイルが存在しない場合、既存のClaude CLIセッションを移行
        await this.migrateLegacyClaudeSessions();
      }
    } catch {
      // エラーは無視
    }
  }

  /**
   * 既存のClaude CLIセッションを新しい形式に移行
   */
  private async migrateLegacyClaudeSessions(): Promise<void> {
    try {
      const data = await fs.readFile(this.claudeSessionsFile, 'utf-8');
      const legacySessions: PersistedClaudeSession[] = JSON.parse(data);

      const migratedSessions: PersistedAiSession[] = legacySessions.map(
        (session) => ({
          ...session,
          provider: 'claude' as AiProvider,
          outputHistory:
            session.outputHistory?.map((line) => ({
              ...line,
              provider: 'claude' as AiProvider,
            })) || [],
        })
      );

      // 新しい形式で保存
      await fs.writeFile(
        this.aiSessionsFile,
        JSON.stringify(migratedSessions, null, 2)
      );

      console.log(
        `Migrated ${migratedSessions.length} Claude CLI sessions to new format`
      );
    } catch {
      // 移行失敗時は無視（新規インストールなど）
    }
  }

  /**
   * 既存のClaude CLIセッションを復帰（後方互換性用）
   */
  private async restoreClaudeSessions(): Promise<void> {
    try {
      const data = await fs.readFile(this.claudeSessionsFile, 'utf-8');
      const persistedSessions: PersistedClaudeSession[] = JSON.parse(data);

      for (const session of persistedSessions) {
        if (await this.isProcessAlive(session.pid)) {
          // プロセスが生きている場合、新しいPTYインスタンスは作成せず、情報のみ保持
          // 実際の接続は必要に応じて後で行う
        } else {
        }
      }
    } catch {
      // ファイルが存在しない場合は無視
      // Failed to restore Claude sessions
    }
  }

  /**
   * 既存のターミナルを復帰
   */
  private async restoreTerminals(): Promise<void> {
    try {
      const data = await fs.readFile(this.terminalsFile, 'utf-8');
      const persistedTerminals: PersistedTerminal[] = JSON.parse(data);

      for (const terminal of persistedTerminals) {
        if (await this.isProcessAlive(terminal.pid)) {
          // プロセスが生きている場合、新しいPTYインスタンスは作成せず、情報のみ保持
        } else {
        }
      }
    } catch {
      // ファイルが存在しない場合は無視
      // Failed to restore terminals
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
    initialSize?: { cols: number; rows: number }
  ): Promise<ActiveAiSession> {
    const sessionId = `${provider}-${++this.sessionCounter}-${Date.now()}`;
    const { command, args } = this.getProviderCommand(provider);

    // PTYを使用してAI CLIを対話モードで起動（初期サイズを使用、未指定時はデフォルト値）
    const aiProcess = pty.spawn(command, args, {
      name: 'xterm-color',
      cols: initialSize?.cols ?? 120,
      rows: initialSize?.rows ?? 30,
      cwd: repositoryPath,
      env: {
        ...process.env,
        TERM: 'xterm-256color',
        COLORTERM: 'truecolor',
        FORCE_COLOR: '1',
      },
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

    // プロセス監視
    aiProcess.onData((data: string) => {
      session.lastAccessedAt = Date.now();

      // プロバイダー固有の処理
      let processedData = data;
      if (session.provider === 'codex') {
        processedData = this.handleCodexTerminalQueries(data, aiProcess);
      }

      // 出力履歴に追加（処理済みデータを使用）
      const outputLine = this.addToAiOutputHistory(
        session,
        processedData,
        'stdout'
      );

      // 構造化されたAiOutputLineオブジェクトをemit
      this.emit('ai-output', {
        sessionId: session.id,
        repositoryPath: session.repositoryPath,
        provider: session.provider,
        outputLine, // 構造化データを送信
      });
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
      this.persistAiSessions();
    });

    const sessionKey = this.getSessionKey(repositoryPath, provider);
    this.aiSessions.set(sessionKey, session);
    this.idIndex.set(session.id, sessionKey); // idIndexに登録（O(1)検索用）
    await this.persistAiSessions();

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
    repositoryName: string
  ): Promise<ActiveClaudeSession> {
    const sessionId = `claude-${++this.sessionCounter}-${Date.now()}`;

    // PTYを使用してClaude CLIを対話モードで起動
    // 環境変数から Claude CLI のパスを取得、デフォルトは ~/.claude/local/claude
    const claudeCommand =
      process.env.CLAUDE_CLI_COMMAND ||
      `${process.env.HOME}/.claude/local/claude`;
    const claudeProcess = pty.spawn(
      claudeCommand,
      ['--dangerously-skip-permissions', '--model', 'opusplan'],
      {
        name: 'xterm-color',
        cols: 120,
        rows: 30,
        cwd: repositoryPath,
        env: {
          ...process.env,
          TERM: 'xterm-256color',
          COLORTERM: 'truecolor',
          FORCE_COLOR: '1',
        },
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

    // プロセス監視
    claudeProcess.onData((data: string) => {
      session.lastAccessedAt = Date.now();

      // 出力履歴に追加
      this.addToOutputHistory(session, data, 'stdout');

      this.emit('claude-output', {
        sessionId: session.id,
        repositoryPath: session.repositoryPath,
        type: 'stdout',
        content: data,
      });
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
      this.persistClaudeSessions();
    });

    this.claudeSessions.set(sessionId, session);
    await this.persistClaudeSessions();

    this.emit('claude-session-created', session);
    return session;
  }

  /**
   * 新しいターミナルを作成
   */
  async createTerminal(
    repositoryPath: string,
    repositoryName: string,
    name?: string,
    initialSize?: { cols: number; rows: number }
  ): Promise<ActiveTerminal> {
    const terminalId = `terminal-${++this.terminalCounter}-${Date.now()}`;
    const terminalName = name || `Terminal ${this.terminalCounter}`;

    // 親プロセスの環境変数から dokodemo-claude 固有の環境変数（DC_プレフィックス）を除外
    const cleanEnv: Record<string, string> = {};
    for (const [key, value] of Object.entries(process.env)) {
      // DC_ で始まる環境変数は除外（dokodemo-claude固有の設定）
      if (!key.startsWith('DC_') && value !== undefined) {
        cleanEnv[key] = value;
      }
    }

    // PTYプロセスを作成（初期サイズを使用、未指定時はデフォルト値）
    const ptyProcess = pty.spawn(
      os.platform() === 'win32' ? 'cmd.exe' : 'bash',
      [],
      {
        name: 'xterm-color',
        cols: initialSize?.cols ?? 120,
        rows: initialSize?.rows ?? 30,
        cwd: repositoryPath,
        env: {
          ...cleanEnv,
          TERM: 'xterm-256color',
          COLORTERM: 'truecolor',
          FORCE_COLOR: '1',
        },
      }
    );

    const terminal: ActiveTerminal = {
      id: terminalId,
      repositoryPath,
      repositoryName,
      pid: ptyProcess.pid,
      name: terminalName,
      status: 'active',
      process: ptyProcess,
      createdAt: Date.now(),
      lastAccessedAt: Date.now(),
      outputHistory: [], // 出力履歴を初期化
    };

    // プロセス監視
    ptyProcess.onData((data: string) => {
      terminal.lastAccessedAt = Date.now();

      // 出力履歴に追加
      this.addToTerminalOutputHistory(terminal, data, 'stdout');

      this.emit('terminal-output', {
        terminalId: terminal.id,
        repositoryPath: terminal.repositoryPath,
        type: 'stdout',
        data,
        timestamp: Date.now(),
      });
    });

    ptyProcess.onExit(({ exitCode, signal }) => {
      terminal.status = 'exited';
      this.emit('terminal-exit', {
        terminalId: terminal.id,
        repositoryPath: terminal.repositoryPath,
        exitCode,
        signal,
      });

      // ターミナルをクリーンアップ
      this.terminals.delete(terminalId);
      this.persistTerminals();
    });

    this.terminals.set(terminalId, terminal);
    await this.persistTerminals();

    // 最初のターミナル作成時にデフォルトショートカットを作成
    const existingTerminals = this.getTerminalsByRepository(repositoryPath);
    if (existingTerminals.length === 1) {
      // 最初のターミナルの場合
      const existingShortcuts = this.getShortcutsByRepository(repositoryPath);
      if (existingShortcuts.length === 0) {
        // ショートカットがまだない場合
        await this.createDefaultShortcuts(repositoryPath);
      }
    }

    this.emit('terminal-created', terminal);
    return terminal;
  }

  /**
   * 既存のClaude CLIプロセスを復帰
   */
  private async restoreExistingClaudeSession(
    persisted: PersistedClaudeSession
  ): Promise<ActiveClaudeSession> {
    // 既存プロセスはそのまま維持し、新しいセッション情報を作成
    // 実際のPTYプロセスは作らず、情報のみ管理
    const session: ActiveClaudeSession = {
      id: persisted.id,
      repositoryPath: persisted.repositoryPath,
      repositoryName: persisted.repositoryName,
      pid: persisted.pid,
      isActive: true,
      isPty: false, // 既存プロセスなのでPTY接続はなし
      process: null as unknown as pty.IPty, // 実際のPTYプロセスはなし
      createdAt: persisted.createdAt,
      lastAccessedAt: Date.now(),
      outputHistory: persisted.outputHistory || [], // 既存の出力履歴を復元
    };

    return session;
  }

  /**
   * リポジトリのAI CLIセッションを取得（なければ作成）
   */
  async getOrCreateAiSession(
    repositoryPath: string,
    repositoryName: string,
    provider: AiProvider,
    initialSize?: { cols: number; rows: number }
  ): Promise<ActiveAiSession> {
    const sessionKey = this.getSessionKey(repositoryPath, provider);

    // 既存のアクティブセッションを検索
    const existingSession = this.aiSessions.get(sessionKey);
    if (existingSession && existingSession.isActive) {
      existingSession.lastAccessedAt = Date.now();
      await this.persistAiSessions();
      // 既存セッションのサイズを更新
      if (initialSize && existingSession.process?.resize) {
        existingSession.process.resize(initialSize.cols, initialSize.rows);
      }
      return existingSession;
    }

    // 永続化されたセッションで生きているものがあるかチェック
    try {
      const data = await fs.readFile(this.aiSessionsFile, 'utf-8');
      const persistedSessions: PersistedAiSession[] = JSON.parse(data);

      for (const persistedSession of persistedSessions) {
        if (
          persistedSession.repositoryPath === repositoryPath &&
          persistedSession.provider === provider &&
          (await this.isProcessAlive(persistedSession.pid))
        ) {
          // 既存プロセスに新しいセッション情報を作成（実際のPTY接続は復元しない）
          const restoredSession =
            await this.restoreExistingAiSession(persistedSession);
          this.aiSessions.set(sessionKey, restoredSession);
          await this.persistAiSessions();
          return restoredSession;
        }
      }
    } catch {
      // ファイル読み込みエラーは無視
    }

    // 新しいセッションを作成
    return await this.createAiSession(
      repositoryPath,
      repositoryName,
      provider,
      initialSize
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
      options?.initialSize
    );
  }

  /**
   * 既存のAI CLIプロセスを復帰
   */
  private async restoreExistingAiSession(
    persisted: PersistedAiSession
  ): Promise<ActiveAiSession> {
    // 既存プロセスはそのまま維持し、新しいセッション情報を作成
    const session: ActiveAiSession = {
      id: persisted.id,
      repositoryPath: persisted.repositoryPath,
      repositoryName: persisted.repositoryName,
      pid: persisted.pid,
      isActive: true,
      isPty: false, // 既存プロセスなのでPTY接続はなし
      process: null as unknown as pty.IPty, // 実際のPTYプロセスはなし
      provider: persisted.provider,
      createdAt: persisted.createdAt,
      lastAccessedAt: Date.now(),
      outputHistory: persisted.outputHistory || [], // 既存の出力履歴を復元
    };

    return session;
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
        await this.persistClaudeSessions();
        return session;
      }
    }

    // 永続化されたセッションで生きているものがあるかチェック
    try {
      const data = await fs.readFile(this.claudeSessionsFile, 'utf-8');
      const persistedSessions: PersistedClaudeSession[] = JSON.parse(data);

      for (const persistedSession of persistedSessions) {
        if (
          persistedSession.repositoryPath === repositoryPath &&
          (await this.isProcessAlive(persistedSession.pid))
        ) {
          // 既存プロセスに新しいPTY接続を作成
          const restoredSession =
            await this.restoreExistingClaudeSession(persistedSession);
          this.claudeSessions.set(restoredSession.id, restoredSession);
          await this.persistClaudeSessions();

          return restoredSession;
        }
      }
    } catch {
      // ファイル読み込みエラーは無視
    }

    // 新しいセッションを作成
    return await this.createClaudeSession(repositoryPath, repositoryName);
  }

  /**
   * Hookイベントから自走モードをトリガー
   */
  async triggerAutoModeFromHook(repositoryPath: string): Promise<void> {
    // Triggering automode from hook event

    // 自走モードが有効かチェック
    const autoModeState = this.autoModeStates.get(repositoryPath);
    if (!autoModeState || !autoModeState.isRunning) {
      // Automode not running
      return;
    }

    // 設定されているプロンプトを取得
    const config = this.autoModeConfigs.get(
      autoModeState.currentConfigId || ''
    );
    if (!config || !config.isEnabled) {
      // Automode config not found or disabled
      return;
    }

    // 最後の実行から5分が経過しているかチェック
    const now = Date.now();
    const fiveMinutesInMs = 5 * 60 * 1000; // 5分をミリ秒に変換

    if (autoModeState.lastExecutionTime) {
      const timeSinceLastExecution = now - autoModeState.lastExecutionTime;
      const remainingTime = fiveMinutesInMs - timeSinceLastExecution;

      if (remainingTime > 0) {
        // 5分経過していない場合は、残り時間後に再度実行
        console.log(
          `Automode: Waiting ${Math.ceil(remainingTime / 1000)} seconds until next execution for ${repositoryPath}`
        );

        // 既存のタイマーをクリア
        const existingTimer = this.autoModeTimers.get(repositoryPath);
        if (existingTimer) {
          clearTimeout(existingTimer);
        }

        // 新しいタイマーを設定
        const timer = setTimeout(() => {
          // タイマーをMapから削除
          this.autoModeTimers.delete(repositoryPath);
          // 5分経過後に再度このメソッドを呼び出す
          this.triggerAutoModeFromHook(repositoryPath);
        }, remainingTime);

        // タイマーを保存
        this.autoModeTimers.set(repositoryPath, timer);

        // 待機状態を通知
        this.emit('automode-waiting', {
          repositoryPath,
          remainingTime: Math.ceil(remainingTime / 1000),
          nextExecutionTime: now + remainingTime,
        });

        return;
      }
    }

    // Claudeセッションを取得
    const session = this.getClaudeSessionByRepository(repositoryPath);
    if (!session) {
      // Claude session not found
      // セッションを作成
      const repoName = repositoryPath.split('/').pop() || 'unknown';
      const newSession = await this.getOrCreateClaudeSession(
        repositoryPath,
        repoName
      );
      if (newSession) {
        // Created new Claude session
        // 少し待ってからプロンプトを送信
        setTimeout(() => {
          this.sendAutoPrompt(newSession, config);
        }, 2000);
      }
      return;
    }

    // プロンプトを送信
    this.sendAutoPrompt(session, config);

    // 実行時間を更新
    autoModeState.lastExecutionTime = Date.now();
    await this.persistAutoModeStates();

    // Automode triggered successfully
  }

  /**
   * 自動プロンプト送信
   */
  private sendAutoPrompt(
    session: ActiveClaudeSession,
    config: AutoModeConfig
  ): void {
    let success = false;

    // 設定で/clearコマンドの送信が有効な場合、プロンプト送信前に/clearを送信
    if (config.sendClearCommand) {
      success = this.sendToClaudeSession(session.id, '/clear');
      if (success) {
        // /clearコマンド送信後500ms待機してからEnterキーを送信
        setTimeout(() => {
          this.sendToClaudeSession(session.id, '\r');
          // /clearコマンド処理完了まで1500ms待機してからプロンプトを送信
          setTimeout(() => {
            this.sendMainPrompt(session, config);
          }, 1500);
        }, 500);
      }
    } else {
      // /clearコマンドを送信しない場合、直接プロンプトを送信
      this.sendMainPrompt(session, config);
    }
  }

  private sendMainPrompt(
    session: ActiveClaudeSession,
    config: AutoModeConfig
  ): void {
    const success = this.sendToClaudeSession(session.id, config.prompt);

    if (success) {
      // プロンプト送信後500ms待機してからEnterキーを送信
      setTimeout(() => {
        // Enterキーを送信（キャリッジリターン）
        this.sendToClaudeSession(session.id, '\r');
      }, 500);

      // 実行時間を更新
      const autoModeState = this.autoModeStates.get(session.repositoryPath);
      if (autoModeState) {
        autoModeState.lastExecutionTime = Date.now();
        this.persistAutoModeStates();
      }

      this.emit('automode-prompt-sent', {
        sessionId: session.id,
        repositoryPath: session.repositoryPath,
        configId: config.id,
        prompt: config.prompt,
      });
    }
  }

  /**
   * AI出力履歴に新しい行を追加
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

    session.outputHistory.push(outputLine);

    // 最大行数を超えた場合、古い行を削除
    if (session.outputHistory.length > this.MAX_OUTPUT_LINES) {
      session.outputHistory = session.outputHistory.slice(
        -this.MAX_OUTPUT_LINES
      );
    }

    // 永続化（非同期で実行、エラーは無視）
    this.persistAiSessions().catch(() => {
      // Persist error ignored
    });

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

    // 永続化（非同期で実行、エラーは無視）
    this.persistClaudeSessions().catch(() => {
      // Persist error ignored
    });
  }

  /**
   * 指定されたリポジトリとプロバイダーのAI出力履歴を取得
   */
  async getAiOutputHistory(
    repositoryPath: string,
    provider: AiProvider
  ): Promise<AiOutputLine[]> {
    const sessionKey = this.getSessionKey(repositoryPath, provider);

    // まずアクティブなセッションから履歴を取得
    const session = this.aiSessions.get(sessionKey);
    if (session) {
      // 最新の500行に制限
      const history = session.outputHistory;
      return history.slice(-500);
    }

    // アクティブなセッションがない場合、永続化された履歴を読み込み
    try {
      const data = await fs.readFile(this.aiSessionsFile, 'utf-8');
      const persistedSessions: PersistedAiSession[] = JSON.parse(data);

      for (const persistedSession of persistedSessions) {
        if (
          persistedSession.repositoryPath === repositoryPath &&
          persistedSession.provider === provider
        ) {
          const history = persistedSession.outputHistory || [];
          return history.slice(-500);
        }
      }
    } catch {
      // Error reading persisted sessions
    }

    return [];
  }

  /**
   * 指定されたリポジトリのClaude出力履歴を取得（後方互換性用）
   */
  async getOutputHistory(repositoryPath: string): Promise<ClaudeOutputLine[]> {
    // Getting output history

    // まずアクティブなセッションから履歴を取得
    const session = this.getClaudeSessionByRepository(repositoryPath);
    if (session) {
      // Found active session with history
      // 最新の500行に制限
      const history = session.outputHistory;
      return history.slice(-500);
    }

    // No active session found, checking persisted history

    // アクティブなセッションがない場合、永続化された履歴を読み込み
    try {
      const data = await fs.readFile(this.claudeSessionsFile, 'utf-8');
      const persistedSessions: PersistedClaudeSession[] = JSON.parse(data);

      // Found persisted sessions

      for (const persistedSession of persistedSessions) {
        if (persistedSession.repositoryPath === repositoryPath) {
          // const historyLength = persistedSession.outputHistory?.length || 0;
          // Found persisted session with history
          // 最新の500行に制限
          const history = persistedSession.outputHistory || [];
          return history.slice(-500);
        }
      }

      // No persisted session found
    } catch {
      // Error reading persisted sessions
    }

    // Returning empty history
    return [];
  }

  /**
   * 指定されたリポジトリのClaude出力履歴をクリア
   */
  async clearClaudeOutputHistory(repositoryPath: string): Promise<boolean> {
    try {
      // アクティブなセッションから履歴をクリア
      const session = this.getClaudeSessionByRepository(repositoryPath);
      if (session) {
        session.outputHistory = [];
        // 永続化
        await this.persistClaudeSessions();
        return true;
      }

      // アクティブなセッションがない場合、永続化ファイルからもクリア
      try {
        const data = await fs.readFile(this.claudeSessionsFile, 'utf-8');
        const persistedSessions: PersistedClaudeSession[] = JSON.parse(data);

        let found = false;
        for (const persistedSession of persistedSessions) {
          if (persistedSession.repositoryPath === repositoryPath) {
            persistedSession.outputHistory = [];
            found = true;
            break;
          }
        }

        if (found) {
          await fs.writeFile(
            this.claudeSessionsFile,
            JSON.stringify(persistedSessions, null, 2)
          );
          return true;
        }
      } catch {
        // 永続化ファイル操作エラーは無視
      }

      return false;
    } catch {
      return false;
    }
  }

  /**
   * 指定されたリポジトリとプロバイダーのAI出力履歴をクリア
   */
  async clearAiOutputHistory(
    repositoryPath: string,
    provider: AiProvider
  ): Promise<boolean> {
    try {
      // アクティブなセッションから履歴をクリア
      const session = this.getAiSessionByRepository(repositoryPath, provider);
      if (session) {
        session.outputHistory = [];
        // 永続化
        await this.persistAiSessions();
        return true;
      }

      // アクティブなセッションがない場合、永続化ファイルからもクリア
      try {
        const data = await fs.readFile(this.aiSessionsFile, 'utf-8');
        const persistedSessions: PersistedAiSession[] = JSON.parse(data);
        let found = false;
        for (const persistedSession of persistedSessions) {
          if (
            persistedSession.repositoryPath === repositoryPath &&
            persistedSession.provider === provider
          ) {
            persistedSession.outputHistory = [];
            found = true;
            break;
          }
        }
        if (found) {
          await fs.writeFile(
            this.aiSessionsFile,
            JSON.stringify(persistedSessions, null, 2)
          );
          return true;
        }
      } catch {
        // 永続化ファイル操作エラーは無視
      }
      return false;
    } catch {
      return false;
    }
  }

  /**
   * ターミナル出力履歴に新しい行を追加
   */
  private addToTerminalOutputHistory(
    terminal: ActiveTerminal,
    content: string,
    type: 'stdout' | 'stderr' | 'system'
  ): void {
    const outputLine: TerminalOutputLine = {
      id: `${terminal.id}-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`,
      content,
      timestamp: Date.now(),
      type,
    };

    terminal.outputHistory.push(outputLine);

    // 最大行数を超えた場合、古い行を削除
    if (terminal.outputHistory.length > this.MAX_OUTPUT_LINES) {
      terminal.outputHistory = terminal.outputHistory.slice(
        -this.MAX_OUTPUT_LINES
      );
    }

    // 永続化（非同期で実行、エラーは無視）
    this.persistTerminals().catch(() => {
      // Persist error ignored
    });
  }

  /**
   * 指定されたターミナルの出力履歴を取得
   */
  async getTerminalOutputHistory(
    terminalId: string
  ): Promise<TerminalOutputLine[]> {
    // まずアクティブなターミナルから履歴を取得
    const terminal = this.terminals.get(terminalId);
    if (terminal) {
      return terminal.outputHistory;
    }

    // アクティブなターミナルがない場合、永続化された履歴を読み込み
    try {
      const data = await fs.readFile(this.terminalsFile, 'utf-8');
      const persistedTerminals: PersistedTerminal[] = JSON.parse(data);

      for (const persistedTerminal of persistedTerminals) {
        if (persistedTerminal.id === terminalId) {
          return persistedTerminal.outputHistory || [];
        }
      }
    } catch {
      // ファイル読み込みエラーは無視
      // No persisted terminal history found
    }

    return [];
  }

  /**
   * AI CLIセッション情報の永続化
   */
  private async persistAiSessions(): Promise<void> {
    const persistedSessions: PersistedAiSession[] = Array.from(
      this.aiSessions.values()
    ).map((session) => ({
      id: session.id,
      repositoryPath: session.repositoryPath,
      repositoryName: session.repositoryName,
      pid: session.pid,
      isActive: session.isActive,
      createdAt: session.createdAt,
      lastAccessedAt: session.lastAccessedAt,
      provider: session.provider,
      outputHistory: session.outputHistory, // 出力履歴も永続化
    }));

    try {
      await fs.writeFile(
        this.aiSessionsFile,
        JSON.stringify(persistedSessions, null, 2)
      );
    } catch {
      // Failed to persist AI sessions
    }
  }

  /**
   * Claude CLIセッション情報の永続化（後方互換性用）
   */
  private async persistClaudeSessions(): Promise<void> {
    const persistedSessions: PersistedClaudeSession[] = Array.from(
      this.claudeSessions.values()
    ).map((session) => ({
      id: session.id,
      repositoryPath: session.repositoryPath,
      repositoryName: session.repositoryName,
      pid: session.pid,
      isActive: session.isActive,
      createdAt: session.createdAt,
      lastAccessedAt: session.lastAccessedAt,
      outputHistory: session.outputHistory, // 出力履歴も永続化
    }));

    try {
      await fs.writeFile(
        this.claudeSessionsFile,
        JSON.stringify(persistedSessions, null, 2)
      );
    } catch {
      // Failed to persist Claude sessions
    }
  }

  /**
   * ターミナル情報の永続化
   */
  private async persistTerminals(): Promise<void> {
    const persistedTerminals: PersistedTerminal[] = Array.from(
      this.terminals.values()
    ).map((terminal) => ({
      id: terminal.id,
      repositoryPath: terminal.repositoryPath,
      repositoryName: terminal.repositoryName,
      pid: terminal.pid,
      name: terminal.name,
      status: terminal.status,
      createdAt: terminal.createdAt,
      lastAccessedAt: terminal.lastAccessedAt,
      outputHistory: terminal.outputHistory, // 出力履歴を永続化
    }));

    try {
      await fs.writeFile(
        this.terminalsFile,
        JSON.stringify(persistedTerminals, null, 2)
      );
    } catch {
      // Failed to persist terminals
    }
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

    // ターミナルのクリーンアップ
    for (const [terminalId, terminal] of this.terminals) {
      if (!(await this.isProcessAlive(terminal.pid))) {
        this.terminals.delete(terminalId);
        this.emit('terminal-cleaned', {
          terminalId,
          repositoryPath: terminal.repositoryPath,
        });
      }
    }

    // 永続化を更新
    await this.persistClaudeSessions();
    await this.persistTerminals();
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

    // PTY接続がない場合（復帰されたセッション）は、新しいセッションを作成
    if (!session.isPty || !session.process) {
      // 非同期で新しいセッションを作成
      this.createAiSession(
        session.repositoryPath,
        session.repositoryName,
        session.provider
      )
        .then((newSession) => {
          // 古いセッションを削除
          this.aiSessions.delete(sessionKey);
          this.idIndex.delete(sessionId);
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
      // Failed to send input to AI session
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
   * ターミナルへの入力送信
   */
  sendToTerminal(terminalId: string, input: string): boolean {
    const terminal = this.terminals.get(terminalId);
    if (!terminal || terminal.status === 'exited') {
      return false;
    }

    try {
      terminal.process.write(input);
      terminal.lastAccessedAt = Date.now();
      return true;
    } catch {
      // Failed to send input to terminal
      return false;
    }
  }

  /**
   * ターミナルのリサイズ
   */
  resizeTerminal(terminalId: string, cols: number, rows: number): boolean {
    const terminal = this.terminals.get(terminalId);
    if (!terminal || terminal.status === 'exited') {
      return false;
    }

    try {
      terminal.process.resize(cols, rows);
      return true;
    } catch {
      return false;
    }
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
   * ターミナルへのシグナル送信
   */
  sendSignalToTerminal(terminalId: string, signal: string): boolean {
    const terminal = this.terminals.get(terminalId);
    if (!terminal || terminal.status === 'exited') {
      return false;
    }

    try {
      if (signal === 'SIGINT') {
        terminal.process.write('\x03'); // Ctrl+C
      } else if (signal === 'SIGTSTP') {
        terminal.process.write('\x1a'); // Ctrl+Z
      } else if (signal === 'ESC') {
        terminal.process.write('\x1b'); // ESC
      } else {
        terminal.process.kill(signal);
      }
      return true;
    } catch {
      // Failed to send signal to terminal
      return false;
    }
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

      // 永続化ファイルを更新
      await this.persistAiSessions();

      return true;
    } catch {
      // Failed to close AI session
      return false;
    }
  }

  /**
   * ターミナルの終了
   */
  async closeTerminal(terminalId: string): Promise<boolean> {
    const terminal = this.terminals.get(terminalId);
    if (!terminal) {
      return false;
    }

    try {
      // ターミナル終了をシステムメッセージとして履歴に追加
      this.addToTerminalOutputHistory(
        terminal,
        '\n[SYSTEM] ターミナル終了\n',
        'system'
      );

      terminal.process.kill('SIGTERM');
      const killTimeout = setTimeout(() => {
        if (this.terminals.has(terminalId)) {
          terminal.process.kill('SIGKILL');
        }
      }, 2000);

      // ターミナルが終了したらタイムアウトをクリア
      terminal.process.onExit(() => {
        clearTimeout(killTimeout);
      });

      return true;
    } catch {
      // Failed to close terminal
      return false;
    }
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
   * リポジトリのターミナル一覧を取得
   */
  getTerminalsByRepository(repositoryPath: string): ActiveTerminal[] {
    return Array.from(this.terminals.values()).filter(
      (terminal) =>
        terminal.repositoryPath === repositoryPath &&
        terminal.status === 'active'
    );
  }

  /**
   * 全ターミナル一覧を取得
   */
  getAllTerminals(): ActiveTerminal[] {
    return Array.from(this.terminals.values());
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

    // 該当リポジトリのターミナルを終了
    for (const [terminalId, terminal] of this.terminals.entries()) {
      if (terminal.repositoryPath === repositoryPath) {
        closePromises.push(this.closeTerminal(terminalId));
      }
    }

    await Promise.all(closePromises);

    // コマンドショートカットをクリーンアップ
    await this.cleanupRepositoryShortcuts(repositoryPath);

    // 自走モード関連データをクリーンアップ
    await this.cleanupRepositoryAutoMode(repositoryPath);

    // 差分チェックサーバーをクリーンアップ
    await this.cleanupRepositoryReviewServer(repositoryPath);

    // 永続化ファイルからも削除
    await this.removeRepositoryFromPersistence(repositoryPath);

    // Cleanup completed
  }

  /**
   * 永続化ファイルからリポジトリ関連データを削除
   */
  private async removeRepositoryFromPersistence(
    repositoryPath: string
  ): Promise<void> {
    try {
      // AI CLIセッションの永続化ファイルを更新
      const aiSessionsPath = path.join(this.processesDir, 'ai-sessions.json');
      try {
        const aiData = await fs.readFile(aiSessionsPath, 'utf-8');
        const aiSessions: PersistedAiSession[] = JSON.parse(aiData);
        const filteredAiSessions = aiSessions.filter(
          (s) => s.repositoryPath !== repositoryPath
        );
        await fs.writeFile(
          aiSessionsPath,
          JSON.stringify(filteredAiSessions, null, 2)
        );
      } catch {
        // ファイルが存在しない場合は無視
      }

      // Claude CLIセッションの永続化ファイルを更新（後方互換性）
      const claudeSessionsPath = path.join(
        this.processesDir,
        'claude-sessions.json'
      );
      try {
        const claudeData = await fs.readFile(claudeSessionsPath, 'utf-8');
        const claudeSessions: PersistedClaudeSession[] = JSON.parse(claudeData);
        const filteredClaudeSessions = claudeSessions.filter(
          (s) => s.repositoryPath !== repositoryPath
        );
        await fs.writeFile(
          claudeSessionsPath,
          JSON.stringify(filteredClaudeSessions, null, 2)
        );
      } catch {
        // ファイルが存在しない場合は無視
      }

      // ターミナルの永続化ファイルを更新
      const terminalsPath = path.join(this.processesDir, 'terminals.json');
      try {
        const terminalData = await fs.readFile(terminalsPath, 'utf-8');
        const terminals: PersistedTerminal[] = JSON.parse(terminalData);
        const filteredTerminals = terminals.filter(
          (t) => t.repositoryPath !== repositoryPath
        );
        await fs.writeFile(
          terminalsPath,
          JSON.stringify(filteredTerminals, null, 2)
        );
      } catch {
        // ファイルが存在しない場合は無視
      }
    } catch {
      // Failed to remove repository from persistence
    }
  }

  // ===== コマンドショートカット管理メソッド =====

  /**
   * 既存のコマンドショートカットを復帰
   */
  private async restoreShortcuts(): Promise<void> {
    try {
      const data = await fs.readFile(this.shortcutsFile, 'utf-8');
      const shortcutsArray: CommandShortcut[] = JSON.parse(data);

      this.shortcuts.clear();
      for (const shortcut of shortcutsArray) {
        this.shortcuts.set(shortcut.id, shortcut);
        // カウンターの更新
        const idNumber = parseInt(shortcut.id.split('-').pop() || '0');
        if (idNumber > this.shortcutCounter) {
          this.shortcutCounter = idNumber;
        }
      }

      // Restored command shortcuts
    } catch {
      // ファイルが存在しない場合は無視
      // Failed to restore command shortcuts
    }
  }

  /**
   * コマンドショートカットを永続化
   */
  private async persistShortcuts(): Promise<void> {
    try {
      const shortcutsArray = Array.from(this.shortcuts.values());
      await fs.writeFile(
        this.shortcutsFile,
        JSON.stringify(shortcutsArray, null, 2),
        'utf-8'
      );
    } catch {
      // Failed to persist command shortcuts
    }
  }

  /**
   * デフォルトのコマンドショートカットを作成
   */
  private async createDefaultShortcuts(repositoryPath: string): Promise<void> {
    const defaultShortcuts = [
      { command: 'git pull' },
      { command: 'npm run dev' },
      { command: 'npm install' },
      { command: 'git status' },
    ];

    for (const shortcut of defaultShortcuts) {
      await this.createShortcut(undefined, shortcut.command, repositoryPath);
    }
  }

  /**
   * 新しいコマンドショートカットを作成
   */
  async createShortcut(
    name: string | undefined,
    command: string,
    repositoryPath: string
  ): Promise<CommandShortcut> {
    const shortcutId = `shortcut-${++this.shortcutCounter}-${Date.now()}`;

    const shortcut: CommandShortcut = {
      id: shortcutId,
      ...(name && name.trim() ? { name: name.trim() } : {}), // nameが入力されている場合のみ設定
      command,
      repositoryPath,
      createdAt: Date.now(),
    };

    this.shortcuts.set(shortcutId, shortcut);
    await this.persistShortcuts();

    return shortcut;
  }

  /**
   * コマンドショートカットを削除
   */
  async deleteShortcut(shortcutId: string): Promise<boolean> {
    const deleted = this.shortcuts.delete(shortcutId);
    if (deleted) {
      await this.persistShortcuts();
    }
    return deleted;
  }

  /**
   * 指定リポジトリのコマンドショートカット一覧を取得
   */
  getShortcutsByRepository(repositoryPath: string): CommandShortcut[] {
    return Array.from(this.shortcuts.values())
      .filter((shortcut) => shortcut.repositoryPath === repositoryPath)
      .sort((a, b) => a.createdAt - b.createdAt);
  }

  /**
   * コマンドショートカットを実行（指定されたターミナルに送信）
   */
  executeShortcut(shortcutId: string, terminalId: string): boolean {
    const shortcut = this.shortcuts.get(shortcutId);
    if (!shortcut) {
      return false;
    }

    const terminal = this.terminals.get(terminalId);
    if (!terminal) {
      return false;
    }

    try {
      // コマンドの末尾に改行を追加して送信
      const commandToSend = shortcut.command.endsWith('\n')
        ? shortcut.command
        : shortcut.command + '\n';
      terminal.process.write(commandToSend);
      terminal.lastAccessedAt = Date.now();
      return true;
    } catch {
      // Failed to execute shortcut
      return false;
    }
  }

  /**
   * リポジトリ削除時のコマンドショートカットクリーンアップ
   */
  async cleanupRepositoryShortcuts(repositoryPath: string): Promise<void> {
    let hasChanges = false;

    // 指定リポジトリのショートカットを削除
    for (const [shortcutId, shortcut] of this.shortcuts.entries()) {
      if (shortcut.repositoryPath === repositoryPath) {
        this.shortcuts.delete(shortcutId);
        hasChanges = true;
      }
    }

    if (hasChanges) {
      await this.persistShortcuts();
      // Cleaned up shortcuts
    }
  }

  /**
   * リポジトリ削除時の自走モード関連データクリーンアップ
   */
  async cleanupRepositoryAutoMode(repositoryPath: string): Promise<void> {
    let hasChanges = false;

    // 自走モード設定を削除
    for (const [configId, config] of this.autoModeConfigs.entries()) {
      if (config.repositoryPath === repositoryPath) {
        this.autoModeConfigs.delete(configId);
        hasChanges = true;
      }
    }

    // 自走モード状態を削除
    if (this.autoModeStates.has(repositoryPath)) {
      this.autoModeStates.delete(repositoryPath);
      hasChanges = true;
    }

    if (hasChanges) {
      await this.persistAutoModeConfigs();
      await this.persistAutoModeStates();
      // Cleaned up automode data
    }
  }

  /**
   * Codex CLIのターミナルクエリを処理
   */
  private handleCodexTerminalQueries(
    data: string,
    ptyProcess: pty.IPty
  ): string {
    // ESC[6n (cursor position request) の検出と応答
    if (data.includes('\x1b[6n')) {
      console.log(
        'Detected cursor position query from Codex CLI, responding...'
      );
      // カーソル位置応答 (row;col R format)
      ptyProcess.write('\x1b[1;1R');
      // クエリ部分を除去してUIに表示しないようにする
      return data.replace(/\x1b\[6n/g, '');
    }

    // ESC[?6n (extended cursor position request) の検出と応答
    if (data.includes('\x1b[?6n')) {
      console.log(
        'Detected extended cursor position query from Codex CLI, responding...'
      );
      // 拡張カーソル位置応答
      ptyProcess.write('\x1b[?1;1R');
      // クエリ部分を除去
      return data.replace(/\x1b\[\?6n/g, '');
    }

    // その他のDevice Status Report (DSR) クエリの検出
    const dsrMatch = data.match(/\x1b\[\?(\d+)n/);
    if (dsrMatch) {
      const queryType = dsrMatch[1];
      console.log(
        `Detected DSR query type ${queryType} from Codex CLI, responding...`
      );
      // 一般的なDSR応答（デバイス OK）
      ptyProcess.write(`\x1b[?${queryType};0n`);
      // クエリ部分を除去
      return data.replace(/\x1b\[\?\d+n/g, '');
    }

    // ESC[c (primary device attributes request) への応答
    if (data.includes('\x1b[c')) {
      console.log(
        'Detected device attributes query from Codex CLI, responding...'
      );
      // VT100互換ターミナルとして応答
      ptyProcess.write('\x1b[?1;2c');
      // クエリ部分を除去
      return data.replace(/\x1b\[c/g, '');
    }

    // 処理されなかった場合は元のデータをそのまま返す
    return data;
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

    // ターミナルを終了
    for (const terminalId of this.terminals.keys()) {
      closePromises.push(this.closeTerminal(terminalId));
    }

    await Promise.all(closePromises);

    // 最終的な永続化
    await this.persistAiSessions();
    await this.persistClaudeSessions();
    await this.persistTerminals();
    await this.persistShortcuts();
    await this.persistAutoModeConfigs();
    await this.persistAutoModeStates();

    // ProcessManager shutdown completed
  }

  // ===== 自走モード管理メソッド =====

  /**
   * 自走モード設定の復帰
   */
  private async restoreAutoModeConfigs(): Promise<void> {
    try {
      const data = await fs.readFile(this.autoModeConfigsFile, 'utf-8');
      const configs: AutoModeConfig[] = JSON.parse(data);

      this.autoModeConfigs.clear();
      for (const config of configs) {
        this.autoModeConfigs.set(config.id, config);
        // カウンターの更新
        const idNumber = parseInt(config.id.split('-').pop() || '0');
        if (idNumber > this.autoModeConfigCounter) {
          this.autoModeConfigCounter = idNumber;
        }
      }

      // Restored automode configs
    } catch {
      // エラーの場合は無視
      // Failed to restore automode configs
    }
  }

  /**
   * 自走モード状態の復帰
   */
  private async restoreAutoModeStates(): Promise<void> {
    try {
      const data = await fs.readFile(this.autoModeStatesFile, 'utf-8');
      const states: AutoModeState[] = JSON.parse(data);

      this.autoModeStates.clear();
      for (const state of states) {
        this.autoModeStates.set(state.repositoryPath, state);
      }

      // Restored automode states
    } catch {
      // エラーの場合は無視
      // Failed to restore automode states
    }
  }

  /**
   * 自走モード設定の永続化
   */
  private async persistAutoModeConfigs(): Promise<void> {
    try {
      const configs = Array.from(this.autoModeConfigs.values());
      await fs.writeFile(
        this.autoModeConfigsFile,
        JSON.stringify(configs, null, 2),
        'utf-8'
      );
    } catch {
      // Failed to persist automode configs
    }
  }

  /**
   * 自走モード状態の永続化
   */
  private async persistAutoModeStates(): Promise<void> {
    try {
      const states = Array.from(this.autoModeStates.values());
      await fs.writeFile(
        this.autoModeStatesFile,
        JSON.stringify(states, null, 2),
        'utf-8'
      );
    } catch {
      // Failed to persist automode states
    }
  }

  /**
   * 自走モード設定を作成
   */
  async createAutoModeConfig(
    name: string,
    prompt: string,
    repositoryPath: string,
    triggerMode: 'hook' = 'hook',
    sendClearCommand: boolean = true
  ): Promise<AutoModeConfig> {
    const configId = `automode-${++this.autoModeConfigCounter}-${Date.now()}`;

    const config: AutoModeConfig = {
      id: configId,
      name,
      prompt,
      repositoryPath,
      isEnabled: true,
      triggerMode,
      sendClearCommand,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    this.autoModeConfigs.set(configId, config);
    await this.persistAutoModeConfigs();

    return config;
  }

  /**
   * 自走モード設定を更新
   */
  async updateAutoModeConfig(
    configId: string,
    updates: Partial<
      Pick<
        AutoModeConfig,
        'name' | 'prompt' | 'isEnabled' | 'triggerMode' | 'sendClearCommand'
      >
    >
  ): Promise<AutoModeConfig | null> {
    const config = this.autoModeConfigs.get(configId);
    if (!config) {
      return null;
    }

    Object.assign(config, updates, { updatedAt: Date.now() });
    this.autoModeConfigs.set(configId, config);
    await this.persistAutoModeConfigs();

    return config;
  }

  /**
   * 自走モード設定を削除
   */
  async deleteAutoModeConfig(configId: string): Promise<boolean> {
    const deleted = this.autoModeConfigs.delete(configId);
    if (deleted) {
      // 該当設定を使用している自走モード状態を停止
      for (const [, state] of this.autoModeStates.entries()) {
        if (state.currentConfigId === configId) {
          state.isRunning = false;
          state.currentConfigId = undefined;
        }
      }

      await this.persistAutoModeConfigs();
      await this.persistAutoModeStates();
    }
    return deleted;
  }

  /**
   * 指定リポジトリの自走モード設定一覧を取得
   */
  getAutoModeConfigsByRepository(repositoryPath: string): AutoModeConfig[] {
    return Array.from(this.autoModeConfigs.values())
      .filter((config) => config.repositoryPath === repositoryPath)
      .sort((a, b) => b.updatedAt - a.updatedAt);
  }

  /**
   * 自走モードを開始
   */
  async startAutoMode(
    repositoryPath: string,
    configId: string
  ): Promise<boolean> {
    const config = this.autoModeConfigs.get(configId);
    if (
      !config ||
      config.repositoryPath !== repositoryPath ||
      !config.isEnabled
    ) {
      return false;
    }

    const state: AutoModeState = {
      repositoryPath,
      isRunning: true,
      currentConfigId: configId,
      lastExecutionTime: Date.now(),
    };

    this.autoModeStates.set(repositoryPath, state);
    await this.persistAutoModeStates();

    // 自走モード開始時はプロンプト送信を行わない（手動送信に変更）
    // Claudeセッションを取得または作成（待機状態）
    try {
      const repoName = repositoryPath.split('/').pop() || 'unknown';
      await this.getOrCreateClaudeSession(repositoryPath, repoName);
    } catch {
      // セッション作成エラーは無視
    }

    return true;
  }

  /**
   * 自走モードで手動プロンプト送信
   */
  async sendManualPrompt(repositoryPath: string): Promise<boolean> {
    // 自走モードが有効かチェック
    const autoModeState = this.autoModeStates.get(repositoryPath);
    if (!autoModeState || !autoModeState.isRunning) {
      return false;
    }

    // 設定されているプロンプトを取得
    const config = this.autoModeConfigs.get(
      autoModeState.currentConfigId || ''
    );
    if (!config || !config.isEnabled) {
      return false;
    }

    // Claudeセッションを取得
    const session = this.getClaudeSessionByRepository(repositoryPath);
    if (!session) {
      // セッションが見つからない場合は作成
      const repoName = repositoryPath.split('/').pop() || 'unknown';
      const newSession = await this.getOrCreateClaudeSession(
        repositoryPath,
        repoName
      );
      if (newSession) {
        // 少し待ってからプロンプトを送信
        setTimeout(() => {
          this.sendAutoPrompt(newSession, config);
        }, 1000);
      }
      return true;
    }

    // プロンプトを送信
    this.sendAutoPrompt(session, config);

    // 実行時間を更新
    autoModeState.lastExecutionTime = Date.now();
    await this.persistAutoModeStates();

    return true;
  }

  /**
   * 自走モードを停止
   */
  async stopAutoMode(repositoryPath: string): Promise<boolean> {
    const state = this.autoModeStates.get(repositoryPath);
    if (!state || !state.isRunning) {
      return false;
    }

    state.isRunning = false;
    state.currentConfigId = undefined;

    // 待機中のタイマーをクリア
    const timer = this.autoModeTimers.get(repositoryPath);
    if (timer) {
      clearTimeout(timer);
      this.autoModeTimers.delete(repositoryPath);
    }

    await this.persistAutoModeStates();

    // 自走モード停止

    return true;
  }

  /**
   * 自走モードを強制的に実行（待機をスキップ）
   */
  async forceExecuteAutoMode(repositoryPath: string): Promise<boolean> {
    // 自走モードが有効かチェック
    const autoModeState = this.autoModeStates.get(repositoryPath);
    if (!autoModeState || !autoModeState.isRunning) {
      return false;
    }

    // 設定されているプロンプトを取得
    const config = this.autoModeConfigs.get(
      autoModeState.currentConfigId || ''
    );
    if (!config || !config.isEnabled) {
      return false;
    }

    // 待機中のタイマーをクリア
    const timer = this.autoModeTimers.get(repositoryPath);
    if (timer) {
      clearTimeout(timer);
      this.autoModeTimers.delete(repositoryPath);
    }

    // Claudeセッションを取得または作成
    const session = this.getClaudeSessionByRepository(repositoryPath);
    if (!session) {
      const repoName = repositoryPath.split('/').pop() || 'unknown';
      const newSession = await this.getOrCreateClaudeSession(
        repositoryPath,
        repoName
      );
      if (newSession) {
        // 少し待ってからプロンプトを送信
        setTimeout(() => {
          this.sendAutoPrompt(newSession, config);
        }, 2000);
      }
      return true;
    }

    // プロンプトを即座に送信
    this.sendAutoPrompt(session, config);

    // 実行時間を更新
    autoModeState.lastExecutionTime = Date.now();
    await this.persistAutoModeStates();

    return true;
  }

  /**
   * 自走モード状態を取得
   */
  getAutoModeState(repositoryPath: string): AutoModeState | null {
    return this.autoModeStates.get(repositoryPath) || null;
  }

  /**
   * 自走モードの待機状態を取得
   */
  getAutoModeWaitingStatus(repositoryPath: string): {
    isWaiting: boolean;
    remainingTime?: number;
  } {
    const timer = this.autoModeTimers.get(repositoryPath);
    const state = this.autoModeStates.get(repositoryPath);

    if (!timer || !state || !state.lastExecutionTime) {
      return { isWaiting: false };
    }

    const now = Date.now();
    const fiveMinutesInMs = 5 * 60 * 1000;
    const timeSinceLastExecution = now - state.lastExecutionTime;
    const remainingTime = fiveMinutesInMs - timeSinceLastExecution;

    if (remainingTime > 0) {
      return {
        isWaiting: true,
        remainingTime: Math.ceil(remainingTime / 1000),
      };
    }

    return { isWaiting: false };
  }

  // 差分チェックサーバー関連メソッド

  /**
   * 差分設定からdifitコマンドのターゲットを取得します
   */
  private getDiffTarget(diffConfig: DiffConfig): string {
    switch (diffConfig.type) {
      case 'staged':
        return 'staged';
      case 'working':
        return 'working';
      case 'all':
        // 全未コミット変更（ステージング + 未ステージ）
        return '.';
      case 'custom':
        return diffConfig.customValue || 'HEAD';
      case 'HEAD':
      default:
        return 'HEAD';
    }
  }

  /**
   * 差分チェックサーバーを開始します
   */
  async startReviewServer(
    repositoryPath: string,
    diffConfig?: DiffConfig
  ): Promise<ReviewServer> {
    // ポート3100の使用状況をチェック
    const isPortBusy = await this.isPortInUse(3100);
    if (isPortBusy) {
      console.log('Port 3100 is in use, killing existing processes...');
      await this.killProcessOnPort(3100);
      // ポートが解放されるまで待機
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }

    // 既存のサーバーがある場合は停止してから新しいサーバーを起動（使い捨てモード）
    const existingServer = this.reviewServers.get(repositoryPath);
    if (
      existingServer &&
      (existingServer.status === 'running' ||
        existingServer.status === 'starting')
    ) {
      console.log(
        `Stopping existing difit server for repository: ${repositoryPath}`
      );
      await this.stopReviewServer(repositoryPath);
      // プロセスが完全に停止するまでより長く待つ
      await new Promise((resolve) => setTimeout(resolve, 3000));
    }

    // 絶対パスを確保
    const absoluteRepoPath = path.isAbsolute(repositoryPath)
      ? repositoryPath
      : path.resolve(repositoryPath);

    console.log(`Starting difit server in directory: ${absoluteRepoPath}`);

    // difit固定ポート3100を使用
    const mainPort = 3100;
    const url = `http://0.0.0.0:${mainPort}`;

    const server: ReviewServer = {
      repositoryPath,
      mainPort,
      status: 'starting',
      url,
      startedAt: Date.now(),
      diffConfig: diffConfig || { type: 'HEAD' }, // デフォルトはHEAD
    };

    this.reviewServers.set(repositoryPath, server);

    try {
      // PTYを使用してdifitサーバーを起動
      const p = pty.spawn(
        process.platform === 'win32' ? 'powershell.exe' : 'bash',
        [],
        {
          name: 'xterm-color',
          cols: 120,
          rows: 30,
          cwd: absoluteRepoPath,
          env: process.env,
        }
      );

      server.mainPid = p.pid;
      // PTYインスタンスも保持
      (server as unknown as Record<string, unknown>).ptyProcess = p;

      // difitコマンドを実行（差分タイプを動的に指定）
      const diffTarget = this.getDiffTarget(diffConfig || { type: 'HEAD' });
      p.write(
        `npx -y difit ${diffTarget} --host 0.0.0.0 --port ${mainPort} --no-open --mode inline\r`
      );

      // difitの出力を監視してポート番号を動的に抽出
      let serverDetected = false;
      p.onData((data) => {
        console.log(`difit output: ${data}`);

        // (Y/n)プロンプトの検出と自動応答
        if (data.includes('(Y/n)')) {
          console.log('Detected (Y/n) prompt, sending "y" automatically');
          p.write('y\r');
        }

        // 🚀 difit server started on http://localhost:3102 のパターンを検出
        const serverStartedMatch = data.match(
          /🚀.*difit server started on http:\/\/localhost:(\d+)/
        );
        if (serverStartedMatch && !serverDetected) {
          serverDetected = true;
          const detectedPort = parseInt(serverStartedMatch[1], 10);
          console.log(`Detected difit server on port: ${detectedPort}`);

          // サーバー情報を更新して動的ポートを反映
          const currentServer = this.reviewServers.get(repositoryPath);
          if (currentServer) {
            currentServer.mainPort = detectedPort;
            // ブラウザベースのURLを構築するため、URLをlocalhost形式で更新
            currentServer.url = `http://localhost:${detectedPort}`;
            currentServer.status = 'running';
            this.reviewServers.set(repositoryPath, currentServer);

            // 成功イベントを送信（フロントエンドでタブが開かれる）
            this.emit('reviewServerStarted', {
              success: true,
              message: 'Difit server started successfully',
              server: currentServer,
            });
          }
        }
      });

      // プロセス終了ハンドラを設定
      p.onExit(({ exitCode }) => {
        console.log(
          `difit process exited with code ${exitCode} for ${repositoryPath}`
        );
        const currentServer = this.reviewServers.get(repositoryPath);
        if (currentServer) {
          currentServer.status = exitCode === 0 ? 'stopped' : 'error';
          this.reviewServers.set(repositoryPath, currentServer);
        }
      });

      // サーバーの起動を待つ（5秒間、動的ポート検出のため）
      await new Promise((resolve) => setTimeout(resolve, 5000));

      // ポート検出に失敗した場合はフォールバック処理
      if (!serverDetected) {
        console.log(
          `Difit server port not detected, using fallback port: ${mainPort}`
        );
        server.status = 'running';
        this.reviewServers.set(repositoryPath, server);

        // フォールバック時もイベントを送信
        this.emit('reviewServerStarted', {
          success: true,
          message: `Difit server started on fallback port: ${mainPort}`,
          server,
        });
      }

      return server;
    } catch (error) {
      server.status = 'error';
      this.reviewServers.set(repositoryPath, server);
      throw error;
    }
  }

  /**
   * 差分チェックサーバーを停止します
   */
  /**
   * ポートが使用中かどうかをチェック
   */
  private isPortInUse(port: number): Promise<boolean> {
    return new Promise((resolve) => {
      const server = net.createServer();
      server.listen(port, () => {
        server.once('close', () => {
          resolve(false);
        });
        server.close();
      });
      server.on('error', () => {
        resolve(true);
      });
    });
  }

  /**
   * 指定されたポートを使用しているプロセスを終了
   */
  private async killProcessOnPort(port: number): Promise<boolean> {
    try {
      console.log(`Checking and killing processes on port ${port}`);

      // プラットフォームに応じてコマンドを選択
      const isWindows = process.platform === 'win32';
      let command: string;
      let args: string[];

      if (isWindows) {
        // Windows: netstatでポートを使用しているプロセスIDを取得してtaskkillで終了
        command = 'cmd';
        args = [
          '/c',
          `for /f "tokens=5" %a in ('netstat -aon ^| findstr :${port}') do taskkill /f /pid %a`,
        ];
      } else {
        // Unix系: lsofでプロセスIDを取得してkillで終了
        command = 'sh';
        args = ['-c', `lsof -ti:${port} | xargs -r kill -9`];
      }

      const result = spawn(command, args);

      return new Promise((resolve) => {
        result.on('close', (code) => {
          console.log(`Kill process on port ${port} exited with code: ${code}`);
          resolve(code === 0);
        });

        result.on('error', (error) => {
          console.error(`Error killing process on port ${port}:`, error);
          resolve(false);
        });

        // タイムアウト設定（5秒）
        setTimeout(() => {
          result.kill();
          resolve(false);
        }, 5000);
      });
    } catch (error) {
      console.error(`Failed to kill process on port ${port}:`, error);
      return false;
    }
  }

  async stopReviewServer(repositoryPath: string): Promise<boolean> {
    const server = this.reviewServers.get(repositoryPath);
    if (!server) {
      return false;
    }

    try {
      console.log(
        `Stopping review server for ${repositoryPath} (PID: ${server.mainPid})`
      );

      // PTYプロセスを終了
      const ptyProcess = (server as unknown as Record<string, unknown>)
        .ptyProcess as pty.IPty | undefined;
      if (ptyProcess) {
        console.log('Sending SIGTERM to PTY process...');
        ptyProcess.kill('SIGTERM');
        // 少し待ってからSIGKILLを送信
        setTimeout(() => {
          try {
            ptyProcess.kill('SIGKILL');
          } catch {
            console.log('PTY process already terminated');
          }
        }, 2000);
      } else if (server.mainPid) {
        console.log(`Sending SIGTERM to process ${server.mainPid}...`);
        process.kill(server.mainPid, 'SIGTERM');
        // 少し待ってからSIGKILLを送信
        setTimeout(() => {
          try {
            process.kill(server.mainPid!, 'SIGKILL');
          } catch {
            console.log('Process already terminated');
          }
        }, 2000);
      }

      // ポート3100で動作している可能性のあるプロセスを強制終了
      if (server.mainPort === 3100) {
        console.log('Force killing any process on port 3100...');
        await this.killProcessOnPort(3100);
      }

      server.status = 'stopped';
      this.reviewServers.set(repositoryPath, server);

      return true;
    } catch (error) {
      console.error(
        `Failed to stop review server for ${repositoryPath}:`,
        error
      );
      return false;
    }
  }

  /**
   * 差分チェックサーバーの状態を取得します
   */
  getReviewServer(repositoryPath: string): ReviewServer | undefined {
    return this.reviewServers.get(repositoryPath);
  }

  /**
   * 全ての差分チェックサーバーを取得します
   */
  getAllReviewServers(): ReviewServer[] {
    return Array.from(this.reviewServers.values());
  }

  /**
   * リポジトリ削除時に関連する差分チェックサーバーをクリーンアップします
   */
  async cleanupRepositoryReviewServer(repositoryPath: string): Promise<void> {
    const server = this.reviewServers.get(repositoryPath);
    if (server) {
      await this.stopReviewServer(repositoryPath);
      this.reviewServers.delete(repositoryPath);
    }
  }
}
