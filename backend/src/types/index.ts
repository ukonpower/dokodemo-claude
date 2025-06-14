// Claude Code CLI関連の型定義
export interface ClaudeMessage {
  id: string;
  type: 'user' | 'claude' | 'system';
  content: string;
  timestamp: number;
}

// Git操作関連の型定義  
export interface GitRepository {
  url: string;
  path: string;
  name: string;
  status: 'cloning' | 'ready' | 'error';
}

// ターミナル関連の型定義
export interface Terminal {
  id: string;
  name: string;
  cwd: string;
  status: 'active' | 'running' | 'exited';
  pid?: number;
  createdAt: number;
}

export interface TerminalMessage {
  terminalId: string;
  type: 'stdout' | 'stderr' | 'input' | 'exit';
  data: string;
  timestamp: number;
}

// Socket.IO通信関連の型定義
export interface ServerToClientEvents {
  'repos-list': (data: { repos: GitRepository[] }) => void;
  'claude-output': (data: ClaudeMessage) => void;
  'claude-raw-output': (data: { type: 'stdout' | 'stderr' | 'system'; content: string }) => void;
  'repo-cloned': (data: { success: boolean; message: string; repo?: GitRepository }) => void;
  'repo-switched': (data: { success: boolean; message: string; currentPath: string }) => void;
  
  // ターミナル関連イベント
  'terminal-created': (data: Terminal) => void;
  'terminal-output': (data: TerminalMessage) => void;
  'terminals-list': (data: { terminals: Terminal[] }) => void;
  'terminal-closed': (data: { terminalId: string }) => void;
  'terminal-signal-sent': (data: { terminalId: string; signal: string; success: boolean }) => void;
}

export interface ClientToServerEvents {
  'clone-repo': (data: { url: string; name: string }) => void;
  'switch-repo': (data: { path: string }) => void;
  'list-repos': () => void;
  'send-command': (data: { command: string }) => void;
  
  // ターミナル関連イベント
  'create-terminal': (data: { cwd: string; name?: string }) => void;
  'terminal-input': (data: { terminalId: string; input: string }) => void;
  'list-terminals': () => void;
  'close-terminal': (data: { terminalId: string }) => void;
  'terminal-resize': (data: { terminalId: string; cols: number; rows: number }) => void;
  'terminal-signal': (data: { terminalId: string; signal: string }) => void;
}

// Claude CLI 操作関連の型定義
export interface ClaudeSession {
  process: any; // pty.IPty | ChildProcess
  isActive: boolean;
  workingDirectory: string;
  isPty: boolean;
}