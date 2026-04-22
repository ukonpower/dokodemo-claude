/**
 * ターミナル管理マネージャー
 * PTYターミナルの作成・操作・管理を担当
 */

import { EventEmitter } from 'events';
import * as os from 'os';
import * as pty from 'node-pty';
import { PersistenceService } from '../services/persistence-service.js';
import { Result, Ok, Err } from '../utils/result.js';
import { TerminalError } from '../utils/errors.js';
import { RingBuffer } from '../utils/ring-buffer.js';
import { cleanChildEnv } from '../utils/clean-env.js';

const MAX_OUTPUT_LINES = 2000;

/**
 * ターミナル出力行
 */
export interface TerminalOutputLine {
  id: string;
  content: string;
  timestamp: number;
  type: 'stdout' | 'stderr' | 'system';
}

/**
 * 永続化用ターミナル情報
 */
export interface PersistedTerminal {
  id: string;
  repositoryPath: string;
  repositoryName: string;
  pid: number;
  name: string;
  status: 'active' | 'exited';
  createdAt: number;
  lastAccessedAt: number;
  outputHistory?: TerminalOutputLine[];
}

/**
 * アクティブターミナル
 */
export interface ActiveTerminal extends PersistedTerminal {
  process: pty.IPty;
  outputHistory: TerminalOutputLine[];
}

export class TerminalManager extends EventEmitter {
  private terminals: Map<string, ActiveTerminal> = new Map();
  // RingBuffer: ターミナルごとの出力履歴バッファ（GC圧力軽減用）
  private outputBuffers: Map<string, RingBuffer<TerminalOutputLine>> =
    new Map();
  private terminalCounter = 0;

  constructor(private readonly persistenceService: PersistenceService) {
    super();
  }

  /**
   * 初期化
   */
  async initialize(): Promise<void> {
    // メモリベースで動作するため、初期化時の特別な処理は不要
  }

  /**
   * ターミナルを作成
   */
  async createTerminal(
    repositoryPath: string,
    repositoryName: string,
    name?: string,
    initialSize?: { cols: number; rows: number }
  ): Promise<Result<ActiveTerminal, TerminalError>> {
    try {
      const terminalId = `terminal-${++this.terminalCounter}-${Date.now()}`;
      const terminalName = name || `Terminal ${this.terminalCounter}`;

      // PTYプロセスを作成
      const ptyProcess = pty.spawn(
        os.platform() === 'win32' ? 'cmd.exe' : 'bash',
        [],
        {
          name: 'xterm-color',
          cols: initialSize?.cols ?? 120,
          rows: initialSize?.rows ?? 30,
          cwd: repositoryPath,
          env: cleanChildEnv({
            TERM: 'xterm-256color',
            COLORTERM: 'truecolor',
            FORCE_COLOR: '1',
          }),
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
        outputHistory: [],
      };

      // プロセス監視
      ptyProcess.onData((data: string) => {
        terminal.lastAccessedAt = Date.now();

        // 出力履歴に追加
        const outputLine = this.addToOutputHistory(terminal, data, 'stdout');

        this.emit('terminal-output', {
          terminalId: terminal.id,
          repositoryPath: terminal.repositoryPath,
          type: 'stdout',
          data,
          timestamp: Date.now(),
          outputLine,
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
        this.outputBuffers.delete(terminalId); // RingBufferも削除
      });

      this.terminals.set(terminalId, terminal);

      this.emit('terminal-created', terminal);
      return Ok(terminal);
    } catch (e) {
      const error = TerminalError.creationFailed(repositoryPath, e);
      console.error('[TerminalManager]', error.message, e);
      return Err(error);
    }
  }

  /**
   * ターミナルに入力を送信
   */
  sendToTerminal(
    terminalId: string,
    input: string
  ): Result<void, TerminalError> {
    const terminal = this.terminals.get(terminalId);

    if (!terminal) {
      return Err(TerminalError.notFound(terminalId));
    }

    if (terminal.status === 'exited') {
      return Err(TerminalError.alreadyClosed(terminalId));
    }

    try {
      terminal.process.write(input);
      terminal.lastAccessedAt = Date.now();
      return Ok(undefined);
    } catch (e) {
      const error = TerminalError.sendFailed(terminalId, e);
      console.error('[TerminalManager]', error.message, e);
      return Err(error);
    }
  }

  /**
   * ターミナルをリサイズ
   */
  resizeTerminal(
    terminalId: string,
    cols: number,
    rows: number
  ): Result<void, TerminalError> {
    const terminal = this.terminals.get(terminalId);

    if (!terminal) {
      return Err(TerminalError.notFound(terminalId));
    }

    if (terminal.status === 'exited') {
      return Err(TerminalError.alreadyClosed(terminalId));
    }

    try {
      terminal.process.resize(cols, rows);
      return Ok(undefined);
    } catch (e) {
      const error = TerminalError.resizeFailed(terminalId, e);
      console.error('[TerminalManager]', error.message, e);
      return Err(error);
    }
  }

  /**
   * ターミナルにシグナルを送信
   */
  sendSignalToTerminal(
    terminalId: string,
    signal: string
  ): Result<void, TerminalError> {
    const terminal = this.terminals.get(terminalId);

    if (!terminal) {
      return Err(TerminalError.notFound(terminalId));
    }

    if (terminal.status === 'exited') {
      return Err(TerminalError.alreadyClosed(terminalId));
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
      return Ok(undefined);
    } catch (e) {
      const error = TerminalError.sendFailed(terminalId, e);
      console.error('[TerminalManager]', error.message, e);
      return Err(error);
    }
  }

  /**
   * プロセスが生きているかチェック
   */
  isProcessAlive(pid: number): boolean {
    try {
      process.kill(pid, 0);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * 死んだプロセスのクリーンアップ
   */
  cleanupDeadProcesses(): { terminalId: string; repositoryPath: string }[] {
    const cleaned: { terminalId: string; repositoryPath: string }[] = [];

    for (const [terminalId, terminal] of this.terminals) {
      if (!this.isProcessAlive(terminal.pid)) {
        this.terminals.delete(terminalId);
        this.outputBuffers.delete(terminalId);
        cleaned.push({
          terminalId,
          repositoryPath: terminal.repositoryPath,
        });
      }
    }

    return cleaned;
  }

  /**
   * ターミナルを閉じる
   */
  async closeTerminal(
    terminalId: string
  ): Promise<Result<void, TerminalError>> {
    const terminal = this.terminals.get(terminalId);

    if (!terminal) {
      return Err(TerminalError.notFound(terminalId));
    }

    try {
      // ターミナル終了をシステムメッセージとして履歴に追加
      this.addToOutputHistory(
        terminal,
        '\n[SYSTEM] ターミナル終了\n',
        'system'
      );

      terminal.process.kill('SIGTERM');

      // SIGTERMで終了しない場合のフォールバック
      // createTerminal時に登録されたonExitハンドラでクリーンアップが行われるため、
      // ここでは追加のonExitリスナーを登録せず、ポーリングでターミナルの終了を確認
      const startTime = Date.now();
      const timeout = 2000;
      const checkInterval = 100;

      const checkAndKill = (): void => {
        // 既に終了している場合は何もしない
        if (!this.terminals.has(terminalId)) {
          return;
        }

        // タイムアウトした場合はSIGKILLを送信
        if (Date.now() - startTime >= timeout) {
          if (this.terminals.has(terminalId)) {
            terminal.process.kill('SIGKILL');
          }
          return;
        }

        // まだ終了していない場合は再チェック
        setTimeout(checkAndKill, checkInterval);
      };

      // 最初のチェックを開始
      setTimeout(checkAndKill, checkInterval);

      return Ok(undefined);
    } catch (e) {
      const error = new TerminalError(
        `ターミナルの終了に失敗しました: ${terminalId}`,
        e
      );
      console.error('[TerminalManager]', error.message, e);
      return Err(error);
    }
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
   * 全ターミナルを取得
   */
  getAllTerminals(): ActiveTerminal[] {
    return Array.from(this.terminals.values());
  }

  /**
   * ターミナルを取得
   */
  getTerminal(terminalId: string): ActiveTerminal | undefined {
    return this.terminals.get(terminalId);
  }

  /**
   * ターミナルの出力履歴を取得
   * RingBufferから遅延評価で配列を生成（onDataごとのtoArray呼び出しを回避）
   */
  getTerminalOutputHistory(terminalId: string): TerminalOutputLine[] {
    const buffer = this.outputBuffers.get(terminalId);
    return buffer ? buffer.toArray() : [];
  }

  /**
   * リポジトリのターミナルをクリーンアップ
   */
  async cleanupRepositoryTerminals(repositoryPath: string): Promise<void> {
    const terminalsToClose: string[] = [];

    for (const [terminalId, terminal] of this.terminals.entries()) {
      if (terminal.repositoryPath === repositoryPath) {
        terminalsToClose.push(terminalId);
      }
    }

    for (const terminalId of terminalsToClose) {
      await this.closeTerminal(terminalId);
    }
  }

  /**
   * 出力履歴に追加
   * RingBufferを使用してGC圧力を軽減
   */
  private addToOutputHistory(
    terminal: ActiveTerminal,
    content: string,
    type: 'stdout' | 'stderr' | 'system'
  ): TerminalOutputLine {
    const outputLine: TerminalOutputLine = {
      id: `${terminal.id}-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`,
      content,
      timestamp: Date.now(),
      type,
    };

    // RingBufferを取得または作成
    let buffer = this.outputBuffers.get(terminal.id);
    if (!buffer) {
      buffer = new RingBuffer<TerminalOutputLine>(MAX_OUTPUT_LINES);
      this.outputBuffers.set(terminal.id, buffer);
    }

    // RingBufferに追加（toArrayは履歴取得時に遅延評価）
    buffer.push(outputLine);

    return outputLine;
  }

  /**
   * シャットダウン
   */
  async shutdown(): Promise<void> {
    // 全ターミナルを閉じる
    const terminalsToClose = Array.from(this.terminals.keys());
    for (const terminalId of terminalsToClose) {
      await this.closeTerminal(terminalId);
    }

    this.terminals.clear();
    this.outputBuffers.clear(); // RingBufferもクリア
    this.removeAllListeners();
  }
}
