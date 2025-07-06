import * as pty from 'node-pty';
import { EventEmitter } from 'events';
import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';
import { CommandShortcut, AutoModeConfig, AutoModeState } from './types/index.js';

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

// 永続化されるClaude CLIセッション情報
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

// アクティブなClaude CLIセッション
export interface ActiveClaudeSession extends PersistedClaudeSession {
  process: pty.IPty;
  isPty: boolean;
  outputHistory: ClaudeOutputLine[]; // アクティブセッションでは必須
  idleTimer?: NodeJS.Timeout; // 処理完了検知用タイマー
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
  private claudeSessions: Map<string, ActiveClaudeSession> = new Map();
  private terminals: Map<string, ActiveTerminal> = new Map();
  private shortcuts: Map<string, CommandShortcut> = new Map();
  private autoModeConfigs: Map<string, AutoModeConfig> = new Map();
  private autoModeStates: Map<string, AutoModeState> = new Map();
  private processesDir: string;
  private claudeSessionsFile: string;
  private terminalsFile: string;
  private shortcutsFile: string;
  private autoModeConfigsFile: string;
  private autoModeStatesFile: string;
  private sessionCounter = 0;
  private terminalCounter = 0;
  private shortcutCounter = 0;
  private autoModeConfigCounter = 0;
  private readonly MAX_OUTPUT_LINES = 500; // 最大出力行数
  private readonly IDLE_TIMEOUT = 5000; // 5秒間無出力で処理完了とみなす

  constructor(processesDir: string) {
    super();
    this.processesDir = processesDir;
    this.claudeSessionsFile = path.join(processesDir, 'claude-sessions.json');
    this.terminalsFile = path.join(processesDir, 'terminals.json');
    this.shortcutsFile = path.join(processesDir, 'command-shortcuts.json');
    this.autoModeConfigsFile = path.join(processesDir, 'automode-configs.json');
    this.autoModeStatesFile = path.join(processesDir, 'automode-states.json');
  }

  /**
   * プロセス管理システムの初期化
   */
  async initialize(): Promise<void> {
    await this.ensureProcessesDir();
    await this.restoreClaudeSessions();
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
   * 既存のClaude CLIセッションを復帰
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
    } catch (error) {
      // ファイルが存在しない場合は無視
      if ((error as any).code !== 'ENOENT') {
        console.error('Failed to restore Claude sessions:', error);
      }
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
    } catch (error) {
      // ファイルが存在しない場合は無視
      if ((error as any).code !== 'ENOENT') {
        console.error('Failed to restore terminals:', error);
      }
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
   * 新しいClaude CLIセッションを作成
   */
  async createClaudeSession(repositoryPath: string, repositoryName: string): Promise<ActiveClaudeSession> {
    const sessionId = `claude-${++this.sessionCounter}-${Date.now()}`;
    
    // PTYを使用してClaude CLIを対話モードで起動
    const claudeProcess = pty.spawn('claude', ['--dangerously-skip-permissions'], {
      name: 'xterm-color',
      cols: 120,
      rows: 30,
      cwd: repositoryPath,
      env: {
        ...process.env,
        TERM: 'xterm-256color',
        COLORTERM: 'truecolor',
        FORCE_COLOR: '1'
      }
    });

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
      outputHistory: [] // 出力履歴を初期化
    };

    // プロセス監視
    claudeProcess.onData((data: string) => {
      session.lastAccessedAt = Date.now();
      
      // 出力履歴に追加
      this.addToOutputHistory(session, data, 'stdout');
      
      // 処理完了検知タイマーをリセット
      this.resetIdleTimer(session);
      
      this.emit('claude-output', {
        sessionId: session.id,
        repositoryPath: session.repositoryPath,
        type: 'stdout',
        content: data
      });
    });

    claudeProcess.onExit(({ exitCode, signal }) => {
      session.isActive = false;
      this.emit('claude-exit', {
        sessionId: session.id,
        repositoryPath: session.repositoryPath,
        exitCode,
        signal
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
  async createTerminal(repositoryPath: string, repositoryName: string, name?: string): Promise<ActiveTerminal> {
    const terminalId = `terminal-${++this.terminalCounter}-${Date.now()}`;
    const terminalName = name || `Terminal ${this.terminalCounter}`;

    // PTYプロセスを作成
    const ptyProcess = pty.spawn(os.platform() === 'win32' ? 'cmd.exe' : 'bash', [], {
      name: 'xterm-color',
      cols: 120,
      rows: 30,
      cwd: repositoryPath,
      env: {
        ...process.env,
        TERM: 'xterm-256color',
        COLORTERM: 'truecolor',
        FORCE_COLOR: '1'
      }
    });

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
      outputHistory: [] // 出力履歴を初期化
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
        timestamp: Date.now()
      });
    });

    ptyProcess.onExit(({ exitCode, signal }) => {
      terminal.status = 'exited';
      this.emit('terminal-exit', {
        terminalId: terminal.id,
        repositoryPath: terminal.repositoryPath,
        exitCode,
        signal
      });
      
      // ターミナルをクリーンアップ
      this.terminals.delete(terminalId);
      this.persistTerminals();
    });

    this.terminals.set(terminalId, terminal);
    await this.persistTerminals();
    
    // 最初のターミナル作成時にデフォルトショートカットを作成
    const existingTerminals = this.getTerminalsByRepository(repositoryPath);
    if (existingTerminals.length === 1) { // 最初のターミナルの場合
      const existingShortcuts = this.getShortcutsByRepository(repositoryPath);
      if (existingShortcuts.length === 0) { // ショートカットがまだない場合
        await this.createDefaultShortcuts(repositoryPath);
      }
    }
    
    this.emit('terminal-created', terminal);
    return terminal;
  }

  /**
   * 既存のClaude CLIプロセスを復帰
   */
  private async restoreExistingClaudeSession(persisted: PersistedClaudeSession): Promise<ActiveClaudeSession> {
    
    // 既存プロセスはそのまま維持し、新しいセッション情報を作成
    // 実際のPTYプロセスは作らず、情報のみ管理
    const session: ActiveClaudeSession = {
      id: persisted.id,
      repositoryPath: persisted.repositoryPath,
      repositoryName: persisted.repositoryName,
      pid: persisted.pid,
      isActive: true,
      isPty: false, // 既存プロセスなのでPTY接続はなし
      process: null as any, // 実際のPTYプロセスはなし
      createdAt: persisted.createdAt,
      lastAccessedAt: Date.now(),
      outputHistory: persisted.outputHistory || [] // 既存の出力履歴を復元
    };

    return session;
  }

  /**
   * リポジトリのClaude CLIセッションを取得（なければ作成）
   */
  async getOrCreateClaudeSession(repositoryPath: string, repositoryName: string): Promise<ActiveClaudeSession> {
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
        if (persistedSession.repositoryPath === repositoryPath && 
            await this.isProcessAlive(persistedSession.pid)) {
          
          
          // 既存プロセスに新しいPTY接続を作成
          const restoredSession = await this.restoreExistingClaudeSession(persistedSession);
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
   * 処理完了検知タイマーをリセット
   */
  private resetIdleTimer(session: ActiveClaudeSession): void {
    // 既存のタイマーをクリア
    if (session.idleTimer) {
      clearTimeout(session.idleTimer);
    }

    // 新しいタイマーを設定
    session.idleTimer = setTimeout(() => {
      // Claude処理完了を検知
      this.onClaudeProcessingComplete(session);
    }, this.IDLE_TIMEOUT);
  }

  /**
   * Claude処理完了時の処理
   */
  private onClaudeProcessingComplete(session: ActiveClaudeSession): void {
    // 自走モードが有効かチェック
    const autoModeState = this.autoModeStates.get(session.repositoryPath);
    if (!autoModeState || !autoModeState.isRunning) {
      return;
    }

    // 設定されているプロンプトを取得
    const config = this.autoModeConfigs.get(autoModeState.currentConfigId || '');
    if (!config || !config.isEnabled) {
      return;
    }

    // 自動プロンプト送信
    setTimeout(() => {
      this.sendAutoPrompt(session, config);
    }, 1000); // 1秒後に送信
  }

  /**
   * 自動プロンプト送信
   */
  private sendAutoPrompt(session: ActiveClaudeSession, config: AutoModeConfig): void {
    const success = this.sendToClaudeSession(session.id, config.prompt);
    
    if (success) {
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
        prompt: config.prompt
      });
    }
  }

  /**
   * 出力履歴に新しい行を追加
   */
  private addToOutputHistory(session: ActiveClaudeSession, content: string, type: 'stdout' | 'stderr' | 'system'): void {
    const outputLine: ClaudeOutputLine = {
      id: `${session.id}-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`,
      content,
      timestamp: Date.now(),
      type
    };
    
    session.outputHistory.push(outputLine);
    
    // 最大行数を超えた場合、古い行を削除
    if (session.outputHistory.length > this.MAX_OUTPUT_LINES) {
      session.outputHistory = session.outputHistory.slice(-this.MAX_OUTPUT_LINES);
    }
    
    // 永続化（非同期で実行、エラーは無視）
    this.persistClaudeSessions().catch(console.error);
  }

  /**
   * 指定されたリポジトリの出力履歴を取得
   */
  async getOutputHistory(repositoryPath: string): Promise<ClaudeOutputLine[]> {
    console.log(`[ProcessManager] Getting output history for: ${repositoryPath}`);
    
    // まずアクティブなセッションから履歴を取得
    const session = this.getClaudeSessionByRepository(repositoryPath);
    if (session) {
      console.log(`[ProcessManager] Found active session with ${session.outputHistory.length} history lines`);
      return session.outputHistory;
    }
    
    console.log(`[ProcessManager] No active session found, checking persisted history`);
    
    // アクティブなセッションがない場合、永続化された履歴を読み込み
    try {
      const data = await fs.readFile(this.claudeSessionsFile, 'utf-8');
      const persistedSessions: PersistedClaudeSession[] = JSON.parse(data);
      
      console.log(`[ProcessManager] Found ${persistedSessions.length} persisted sessions`);
      
      for (const persistedSession of persistedSessions) {
        if (persistedSession.repositoryPath === repositoryPath) {
          const historyLength = persistedSession.outputHistory?.length || 0;
          console.log(`[ProcessManager] Found persisted session with ${historyLength} history lines`);
          return persistedSession.outputHistory || [];
        }
      }
      
      console.log(`[ProcessManager] No persisted session found for repository: ${repositoryPath}`);
    } catch (error) {
      console.log(`[ProcessManager] Error reading persisted sessions: ${error}`);
    }
    
    console.log(`[ProcessManager] Returning empty history for: ${repositoryPath}`);
    return [];
  }

  /**
   * ターミナル出力履歴に新しい行を追加
   */
  private addToTerminalOutputHistory(terminal: ActiveTerminal, content: string, type: 'stdout' | 'stderr' | 'system'): void {
    const outputLine: TerminalOutputLine = {
      id: `${terminal.id}-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`,
      content,
      timestamp: Date.now(),
      type
    };
    
    terminal.outputHistory.push(outputLine);
    
    // 最大行数を超えた場合、古い行を削除
    if (terminal.outputHistory.length > this.MAX_OUTPUT_LINES) {
      terminal.outputHistory = terminal.outputHistory.slice(-this.MAX_OUTPUT_LINES);
    }
    
    // 永続化（非同期で実行、エラーは無視）
    this.persistTerminals().catch(console.error);
  }

  /**
   * 指定されたターミナルの出力履歴を取得
   */
  async getTerminalOutputHistory(terminalId: string): Promise<TerminalOutputLine[]> {
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
      console.log(`No persisted terminal history found for ${terminalId}`);
    }
    
    return [];
  }

  /**
   * Claude CLIセッション情報の永続化
   */
  private async persistClaudeSessions(): Promise<void> {
    const persistedSessions: PersistedClaudeSession[] = Array.from(this.claudeSessions.values())
      .map(session => ({
        id: session.id,
        repositoryPath: session.repositoryPath,
        repositoryName: session.repositoryName,
        pid: session.pid,
        isActive: session.isActive,
        createdAt: session.createdAt,
        lastAccessedAt: session.lastAccessedAt,
        outputHistory: session.outputHistory // 出力履歴も永続化
      }));
    
    try {
      await fs.writeFile(this.claudeSessionsFile, JSON.stringify(persistedSessions, null, 2));
    } catch (error) {
      console.error('Failed to persist Claude sessions:', error);
    }
  }

  /**
   * ターミナル情報の永続化
   */
  private async persistTerminals(): Promise<void> {
    const persistedTerminals: PersistedTerminal[] = Array.from(this.terminals.values())
      .map(terminal => ({
        id: terminal.id,
        repositoryPath: terminal.repositoryPath,
        repositoryName: terminal.repositoryName,
        pid: terminal.pid,
        name: terminal.name,
        status: terminal.status,
        createdAt: terminal.createdAt,
        lastAccessedAt: terminal.lastAccessedAt,
        outputHistory: terminal.outputHistory // 出力履歴を永続化
      }));
    
    try {
      await fs.writeFile(this.terminalsFile, JSON.stringify(persistedTerminals, null, 2));
    } catch (error) {
      console.error('Failed to persist terminals:', error);
    }
  }

  /**
   * 定期的なプロセス監視を開始
   */
  private startProcessMonitoring(): void {
    setInterval(async () => {
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
        this.emit('claude-session-cleaned', { sessionId, repositoryPath: session.repositoryPath });
      }
    }

    // ターミナルのクリーンアップ
    for (const [terminalId, terminal] of this.terminals) {
      if (!(await this.isProcessAlive(terminal.pid))) {
        this.terminals.delete(terminalId);
        this.emit('terminal-cleaned', { terminalId, repositoryPath: terminal.repositoryPath });
      }
    }

    // 永続化を更新
    await this.persistClaudeSessions();
    await this.persistTerminals();
  }

  /**
   * Claude CLIセッションへの入力送信
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
        .then(newSession => {
          // 古いセッションを削除
          this.claudeSessions.delete(sessionId);
          // 新しいセッションでコマンドを送信
          if (newSession.process) {
            newSession.process.write(input);
          }
        })
        .catch(error => {
          console.error(`Failed to create new session for ${sessionId}:`, error);
        });
      return true;
    }

    try {
      session.process.write(input);
      session.lastAccessedAt = Date.now();
      return true;
    } catch (error) {
      console.error(`Failed to send input to Claude session ${sessionId}:`, error);
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
    } catch (error) {
      console.error(`Failed to send input to terminal ${terminalId}:`, error);
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
    } catch (error) {
      console.error(`Failed to resize terminal ${terminalId}:`, error);
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
    } catch (error) {
      console.error(`Failed to send signal ${signal} to terminal ${terminalId}:`, error);
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
      setTimeout(() => {
        if (this.claudeSessions.has(sessionId)) {
          session.process.kill('SIGKILL');
        }
      }, 2000);
      
      return true;
    } catch (error) {
      console.error(`Failed to close Claude session ${sessionId}:`, error);
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
      this.addToTerminalOutputHistory(terminal, '\n[SYSTEM] ターミナル終了\n', 'system');
      
      terminal.process.kill('SIGTERM');
      setTimeout(() => {
        if (this.terminals.has(terminalId)) {
          terminal.process.kill('SIGKILL');
        }
      }, 2000);
      
      return true;
    } catch (error) {
      console.error(`Failed to close terminal ${terminalId}:`, error);
      return false;
    }
  }

  /**
   * リポジトリのClaude CLIセッションを取得
   */
  getClaudeSessionByRepository(repositoryPath: string): ActiveClaudeSession | undefined {
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
    return Array.from(this.terminals.values())
      .filter(terminal => terminal.repositoryPath === repositoryPath && terminal.status === 'active');
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
    console.log(`Cleaning up processes for repository: ${repositoryPath}`);
    
    const closePromises: Promise<boolean>[] = [];
    
    // 該当リポジトリのClaude CLIセッションを終了
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
    
    // 永続化ファイルからも削除
    await this.removeRepositoryFromPersistence(repositoryPath);
    
    console.log(`Cleanup completed for repository: ${repositoryPath}`);
  }
  
  /**
   * 永続化ファイルからリポジトリ関連データを削除
   */
  private async removeRepositoryFromPersistence(repositoryPath: string): Promise<void> {
    try {
      // Claude CLIセッションの永続化ファイルを更新
      const claudeSessionsPath = path.join(this.processesDir, 'claude-sessions.json');
      try {
        const claudeData = await fs.readFile(claudeSessionsPath, 'utf-8');
        const claudeSessions: PersistedClaudeSession[] = JSON.parse(claudeData);
        const filteredClaudeSessions = claudeSessions.filter(s => s.repositoryPath !== repositoryPath);
        await fs.writeFile(claudeSessionsPath, JSON.stringify(filteredClaudeSessions, null, 2));
      } catch {
        // ファイルが存在しない場合は無視
      }
      
      // ターミナルの永続化ファイルを更新
      const terminalsPath = path.join(this.processesDir, 'terminals.json');
      try {
        const terminalData = await fs.readFile(terminalsPath, 'utf-8');
        const terminals: PersistedTerminal[] = JSON.parse(terminalData);
        const filteredTerminals = terminals.filter(t => t.repositoryPath !== repositoryPath);
        await fs.writeFile(terminalsPath, JSON.stringify(filteredTerminals, null, 2));
      } catch {
        // ファイルが存在しない場合は無視
      }
      
    } catch (error) {
      console.error('Failed to remove repository from persistence:', error);
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
      
      console.log(`Restored ${shortcutsArray.length} command shortcuts`);
    } catch (error) {
      // ファイルが存在しない場合は無視
      if ((error as any).code !== 'ENOENT') {
        console.error('Failed to restore command shortcuts:', error);
      }
    }
  }

  /**
   * コマンドショートカットを永続化
   */
  private async persistShortcuts(): Promise<void> {
    try {
      const shortcutsArray = Array.from(this.shortcuts.values());
      await fs.writeFile(this.shortcutsFile, JSON.stringify(shortcutsArray, null, 2), 'utf-8');
    } catch (error) {
      console.error('Failed to persist command shortcuts:', error);
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
      { command: 'git status' }
    ];

    for (const shortcut of defaultShortcuts) {
      await this.createShortcut(undefined, shortcut.command, repositoryPath);
    }
  }

  /**
   * 新しいコマンドショートカットを作成
   */
  async createShortcut(name: string | undefined, command: string, repositoryPath: string): Promise<CommandShortcut> {
    const shortcutId = `shortcut-${++this.shortcutCounter}-${Date.now()}`;
    
    const shortcut: CommandShortcut = {
      id: shortcutId,
      ...(name && name.trim() ? { name: name.trim() } : {}), // nameが入力されている場合のみ設定
      command,
      repositoryPath,
      createdAt: Date.now()
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
      .filter(shortcut => shortcut.repositoryPath === repositoryPath)
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
      const commandToSend = shortcut.command.endsWith('\n') ? shortcut.command : shortcut.command + '\n';
      terminal.process.write(commandToSend);
      terminal.lastAccessedAt = Date.now();
      return true;
    } catch (error) {
      console.error('Failed to execute shortcut:', error);
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
      console.log(`Cleaned up shortcuts for repository: ${repositoryPath}`);
    }
  }

  /**
   * システム終了時のクリーンアップ
   */
  async shutdown(): Promise<void> {
    console.log('Shutting down ProcessManager...');
    
    // 全てのプロセスを終了
    const closePromises: Promise<boolean>[] = [];
    
    for (const sessionId of this.claudeSessions.keys()) {
      closePromises.push(this.closeClaudeSession(sessionId));
    }
    
    for (const terminalId of this.terminals.keys()) {
      closePromises.push(this.closeTerminal(terminalId));
    }
    
    await Promise.all(closePromises);
    
    // 最終的な永続化
    await this.persistClaudeSessions();
    await this.persistTerminals();
    await this.persistShortcuts();
    
    console.log('ProcessManager shutdown completed');
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
      
      console.log(`Restored ${configs.length} automode configs`);
    } catch (error) {
      if ((error as any).code !== 'ENOENT') {
        console.error('Failed to restore automode configs:', error);
      }
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
      
      console.log(`Restored ${states.length} automode states`);
    } catch (error) {
      if ((error as any).code !== 'ENOENT') {
        console.error('Failed to restore automode states:', error);
      }
    }
  }

  /**
   * 自走モード設定の永続化
   */
  private async persistAutoModeConfigs(): Promise<void> {
    try {
      const configs = Array.from(this.autoModeConfigs.values());
      await fs.writeFile(this.autoModeConfigsFile, JSON.stringify(configs, null, 2), 'utf-8');
    } catch (error) {
      console.error('Failed to persist automode configs:', error);
    }
  }

  /**
   * 自走モード状態の永続化
   */
  private async persistAutoModeStates(): Promise<void> {
    try {
      const states = Array.from(this.autoModeStates.values());
      await fs.writeFile(this.autoModeStatesFile, JSON.stringify(states, null, 2), 'utf-8');
    } catch (error) {
      console.error('Failed to persist automode states:', error);
    }
  }

  /**
   * 自走モード設定を作成
   */
  async createAutoModeConfig(name: string, prompt: string, repositoryPath: string): Promise<AutoModeConfig> {
    const configId = `automode-${++this.autoModeConfigCounter}-${Date.now()}`;
    
    const config: AutoModeConfig = {
      id: configId,
      name,
      prompt,
      repositoryPath,
      isEnabled: true,
      createdAt: Date.now(),
      updatedAt: Date.now()
    };

    this.autoModeConfigs.set(configId, config);
    await this.persistAutoModeConfigs();
    
    return config;
  }

  /**
   * 自走モード設定を更新
   */
  async updateAutoModeConfig(configId: string, updates: Partial<Pick<AutoModeConfig, 'name' | 'prompt' | 'isEnabled'>>): Promise<AutoModeConfig | null> {
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
      for (const [repositoryPath, state] of this.autoModeStates.entries()) {
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
      .filter(config => config.repositoryPath === repositoryPath)
      .sort((a, b) => b.updatedAt - a.updatedAt);
  }

  /**
   * 自走モードを開始
   */
  async startAutoMode(repositoryPath: string, configId: string): Promise<boolean> {
    const config = this.autoModeConfigs.get(configId);
    if (!config || config.repositoryPath !== repositoryPath || !config.isEnabled) {
      return false;
    }

    const state: AutoModeState = {
      repositoryPath,
      isRunning: true,
      currentConfigId: configId,
      lastExecutionTime: Date.now()
    };

    this.autoModeStates.set(repositoryPath, state);
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
    await this.persistAutoModeStates();
    
    return true;
  }

  /**
   * 自走モード状態を取得
   */
  getAutoModeState(repositoryPath: string): AutoModeState | null {
    return this.autoModeStates.get(repositoryPath) || null;
  }
}