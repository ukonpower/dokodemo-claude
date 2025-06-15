import * as pty from 'node-pty';
import { EventEmitter } from 'events';
import os from 'os';

export interface Terminal {
  id: string;
  name: string;
  cwd: string;
  status: 'active' | 'running' | 'exited';
  pid?: number;
  process: pty.IPty;
  createdAt: number;
}

export interface TerminalMessage {
  terminalId: string;
  type: 'stdout' | 'stderr' | 'input' | 'exit';
  data: string;
  timestamp: number;
}

export class TerminalManager extends EventEmitter {
  private terminals: Map<string, Terminal> = new Map();
  private terminalCounter = 0;
  private closeTimeouts: Map<string, NodeJS.Timeout> = new Map();

  constructor() {
    super();
  }

  // 新しいターミナルの作成
  createTerminal(cwd: string, name?: string): Terminal {
    const terminalId = `terminal-${++this.terminalCounter}`;
    const terminalName = name || `Terminal ${this.terminalCounter}`;

    // PTYプロセスを作成
    const ptyProcess = pty.spawn(os.platform() === 'win32' ? 'cmd.exe' : 'bash', [], {
      name: 'xterm-color',
      cols: 120,
      rows: 30,
      cwd: cwd,
      env: {
        ...process.env,
        TERM: 'xterm-256color',
        COLORTERM: 'truecolor',
        FORCE_COLOR: '1'
      }
    });

    const terminal: Terminal = {
      id: terminalId,
      name: terminalName,
      cwd: cwd,
      status: 'active',
      pid: ptyProcess.pid,
      process: ptyProcess,
      createdAt: Date.now()
    };

    // ターミナル出力の監視
    ptyProcess.onData((data: string) => {
      const message: TerminalMessage = {
        terminalId,
        type: 'stdout',
        data,
        timestamp: Date.now()
      };
      this.emit('terminal-output', message);
    });

    // ターミナル終了の監視
    ptyProcess.onExit(({ exitCode, signal }) => {
      terminal.status = 'exited';
      const message: TerminalMessage = {
        terminalId,
        type: 'exit',
        data: `Process exited with code ${exitCode} (signal: ${signal})`,
        timestamp: Date.now()
      };
      this.emit('terminal-output', message);
      this.emit('terminal-exit', terminal);
      
      // 終了タイムアウトがある場合はクリア
      const timeout = this.closeTimeouts.get(terminalId);
      if (timeout) {
        clearTimeout(timeout);
        this.closeTimeouts.delete(terminalId);
      }
      
      // ターミナルが自然に終了した場合、マップから削除
      if (this.terminals.has(terminalId)) {
        this.terminals.delete(terminalId);
        this.emit('terminal-closed', { terminalId });
      }
    });

    this.terminals.set(terminalId, terminal);
    this.emit('terminal-created', terminal);

    return terminal;
  }

  // ターミナルへの入力送信
  sendInput(terminalId: string, input: string): boolean {
    const terminal = this.terminals.get(terminalId);
    if (!terminal || terminal.status === 'exited') {
      return false;
    }

    // 入力データをPTYに送信
    terminal.process.write(input);
    
    // 入力データをログとして記録
    const message: TerminalMessage = {
      terminalId,
      type: 'input',
      data: input,
      timestamp: Date.now()
    };
    this.emit('terminal-output', message);

    return true;
  }

  // ターミナルのリサイズ
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

  // プロセス制御 (SIGINT: Ctrl+C)
  sendSignal(terminalId: string, signal: string): boolean {
    const terminal = this.terminals.get(terminalId);
    if (!terminal || terminal.status === 'exited') {
      return false;
    }

    try {
      // PTYプロセスにシグナルを送信
      if (signal === 'SIGINT') {
        // Ctrl+C equivalent
        terminal.process.write('\x03'); // ASCII 3 (ETX)
      } else if (signal === 'SIGTSTP') {
        // Ctrl+Z equivalent
        terminal.process.write('\x1a'); // ASCII 26 (SUB)
      } else {
        // その他のシグナル
        terminal.process.kill(signal);
      }
      return true;
    } catch (error) {
      console.error(`Failed to send signal ${signal} to terminal ${terminalId}:`, error);
      return false;
    }
  }

  // ターミナルの削除
  closeTerminal(terminalId: string): boolean {
    const terminal = this.terminals.get(terminalId);
    if (!terminal) {
      return false;
    }

    try {
      // 既存のタイムアウトがあればクリア
      const existingTimeout = this.closeTimeouts.get(terminalId);
      if (existingTimeout) {
        clearTimeout(existingTimeout);
        this.closeTimeouts.delete(terminalId);
      }

      // PTYプロセスを終了
      if (terminal.status !== 'exited') {
        // プロセスがまだ生きているか確認
        if (terminal.pid) {
          try {
            process.kill(terminal.pid, 0); // プロセスの存在確認
            // プロセスが存在する場合、終了処理を実行
            
            // まずSIGTERMで優雅な終了を試行
            terminal.process.kill('SIGTERM');
            
            // 強制終了のタイムアウトを設定
            const timeout = setTimeout(() => {
              // タイムアウト時に再度ターミナルの存在とステータスを確認
              const currentTerminal = this.terminals.get(terminalId);
              if (currentTerminal && currentTerminal.status !== 'exited') {
                console.log(`Force killing terminal ${terminalId} as it did not exit gracefully`);
                try {
                  currentTerminal.process.kill('SIGKILL');
                } catch (killError) {
                  console.error(`Failed to force kill terminal ${terminalId}:`, killError);
                }
              }
              // タイムアウトマップから削除
              this.closeTimeouts.delete(terminalId);
            }, 2000);
            
            // タイムアウトを保存
            this.closeTimeouts.set(terminalId, timeout);
          } catch {
            // プロセスが既に存在しない場合
            console.log(`Terminal ${terminalId} process already exited`);
            terminal.status = 'exited';
            this.terminals.delete(terminalId);
            this.emit('terminal-closed', { terminalId });
          }
        } else {
          // PIDが取得できない場合は直接削除
          this.terminals.delete(terminalId);
          this.emit('terminal-closed', { terminalId });
        }
      } else {
        // 既に終了している場合は直接削除
        this.terminals.delete(terminalId);
        this.emit('terminal-closed', { terminalId });
      }
      
      return true;
    } catch (error) {
      console.error(`Failed to close terminal ${terminalId}:`, error);
      return false;
    }
  }

  // 全ターミナルの取得
  getTerminals(): Terminal[] {
    return Array.from(this.terminals.values()).map(terminal => ({
      id: terminal.id,
      name: terminal.name,
      cwd: terminal.cwd,
      status: terminal.status,
      pid: terminal.pid,
      createdAt: terminal.createdAt
    }) as Terminal);
  }

  // 特定ターミナルの取得
  getTerminal(terminalId: string): Terminal | undefined {
    const terminal = this.terminals.get(terminalId);
    if (!terminal) return undefined;

    return {
      id: terminal.id,
      name: terminal.name,
      cwd: terminal.cwd,
      status: terminal.status,
      pid: terminal.pid,
      createdAt: terminal.createdAt
    } as Terminal;
  }

  // 全ターミナルの終了
  closeAllTerminals(): void {
    // 全てのタイムアウトをクリア
    for (const timeout of this.closeTimeouts.values()) {
      clearTimeout(timeout);
    }
    this.closeTimeouts.clear();
    
    // 全てのターミナルを終了
    for (const [terminalId] of this.terminals) {
      this.closeTerminal(terminalId);
    }
  }

  // アクティブなターミナル数
  getActiveTerminalCount(): number {
    return Array.from(this.terminals.values()).filter(t => t.status === 'active').length;
  }
}