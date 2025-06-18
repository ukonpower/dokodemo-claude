import * as pty from 'node-pty';
import { EventEmitter } from 'events';
import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';

// 永続化されるClaude CLIセッション情報
export interface PersistedClaudeSession {
  id: string;
  repositoryPath: string;
  repositoryName: string;
  pid: number;
  isActive: boolean;
  createdAt: number;
  lastAccessedAt: number;
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
}

// アクティブなClaude CLIセッション
export interface ActiveClaudeSession extends PersistedClaudeSession {
  process: pty.IPty;
  isPty: boolean;
}

// アクティブなターミナル
export interface ActiveTerminal extends PersistedTerminal {
  process: pty.IPty;
}

/**
 * 永続プロセス管理システム
 * リポジトリごとにClaude CLIセッションとターミナルを管理
 */
export class ProcessManager extends EventEmitter {
  private claudeSessions: Map<string, ActiveClaudeSession> = new Map();
  private terminals: Map<string, ActiveTerminal> = new Map();
  private processesDir: string;
  private claudeSessionsFile: string;
  private terminalsFile: string;
  private sessionCounter = 0;
  private terminalCounter = 0;

  constructor(processesDir: string) {
    super();
    this.processesDir = processesDir;
    this.claudeSessionsFile = path.join(processesDir, 'claude-sessions.json');
    this.terminalsFile = path.join(processesDir, 'terminals.json');
  }

  /**
   * プロセス管理システムの初期化
   */
  async initialize(): Promise<void> {
    await this.ensureProcessesDir();
    await this.restoreClaudeSessions();
    await this.restoreTerminals();
    
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
          // プロセスが生きている場合は復帰を試行
          try {
            await this.restoreClaudeSession(session);
            console.log(`Restored Claude session ${session.id} for ${session.repositoryName}`);
          } catch (error) {
            console.error(`Failed to restore Claude session ${session.id}:`, error);
          }
        } else {
          console.log(`Claude session ${session.id} process is dead, skipping`);
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
          // プロセスが生きている場合は復帰を試行
          try {
            await this.restoreTerminal(terminal);
            console.log(`Restored terminal ${terminal.id} for ${terminal.repositoryName}`);
          } catch (error) {
            console.error(`Failed to restore terminal ${terminal.id}:`, error);
          }
        } else {
          console.log(`Terminal ${terminal.id} process is dead, skipping`);
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
   * Claude CLIセッションの復帰
   */
  private async restoreClaudeSession(persisted: PersistedClaudeSession): Promise<void> {
    // 注意: 既存のPTYプロセスに再接続することは技術的に困難
    // 代わりに新しいプロセスを起動する
    const newSession = await this.createClaudeSession(persisted.repositoryPath, persisted.repositoryName);
    
    // 古いプロセスをクリーンアップ
    try {
      process.kill(persisted.pid, 'SIGTERM');
    } catch {
      // プロセスが既に終了している場合は無視
    }
  }

  /**
   * ターミナルの復帰
   */
  private async restoreTerminal(persisted: PersistedTerminal): Promise<void> {
    // 注意: 既存のPTYプロセスに再接続することは技術的に困難
    // 代わりに新しいプロセスを起動する
    const newTerminal = await this.createTerminal(persisted.repositoryPath, persisted.repositoryName, persisted.name);
    
    // 古いプロセスをクリーンアップ
    try {
      process.kill(persisted.pid, 'SIGTERM');
    } catch {
      // プロセスが既に終了している場合は無視
    }
  }

  /**
   * 新しいClaude CLIセッションを作成
   */
  async createClaudeSession(repositoryPath: string, repositoryName: string): Promise<ActiveClaudeSession> {
    const sessionId = `claude-${++this.sessionCounter}-${Date.now()}`;
    
    // npm版Claude CLIのパス
    const claudePath = path.join(path.dirname(path.dirname(__dirname)), 'node_modules/@anthropic-ai/claude-code/cli.js');
    
    // PTYを使用してClaude CLIを対話モードで起動
    const claudeProcess = pty.spawn('node', [claudePath, '--dangerously-skip-permissions'], {
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
      lastAccessedAt: Date.now()
    };

    // プロセス監視
    claudeProcess.onData((data: string) => {
      session.lastAccessedAt = Date.now();
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
      lastAccessedAt: Date.now()
    };

    // プロセス監視
    ptyProcess.onData((data: string) => {
      terminal.lastAccessedAt = Date.now();
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
    
    this.emit('terminal-created', terminal);
    return terminal;
  }

  /**
   * リポジトリのClaude CLIセッションを取得（なければ作成）
   */
  async getOrCreateClaudeSession(repositoryPath: string, repositoryName: string): Promise<ActiveClaudeSession> {
    // 既存のセッションを検索
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
        lastAccessedAt: session.lastAccessedAt
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
        lastAccessedAt: terminal.lastAccessedAt
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
        console.log(`Cleaning up dead Claude session ${sessionId}`);
        this.claudeSessions.delete(sessionId);
        this.emit('claude-session-cleaned', { sessionId, repositoryPath: session.repositoryPath });
      }
    }

    // ターミナルのクリーンアップ
    for (const [terminalId, terminal] of this.terminals) {
      if (!(await this.isProcessAlive(terminal.pid))) {
        console.log(`Cleaning up dead terminal ${terminalId}`);
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
    
    console.log('ProcessManager shutdown completed');
  }
}