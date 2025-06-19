// バックエンドの型定義と同じものを定義
export interface ClaudeMessage {
  id: string;
  type: 'user' | 'claude' | 'system';
  content: string;
  timestamp: number;
}

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

// Claude出力履歴関連の型定義
export interface ClaudeOutputLine {
  id: string;
  timestamp: number;
  type: 'stdout' | 'stderr' | 'system';
  content: string;
}

// ターミナル出力履歴関連の型定義
export interface TerminalOutputLine {
  id: string;
  content: string;
  timestamp: number;
  type: 'stdout' | 'stderr' | 'system';
}

export interface ServerToClientEvents {
  'repos-list': (data: { repos: GitRepository[] }) => void;
  'claude-output': (data: ClaudeMessage) => void;
  'claude-raw-output': (data: { 
    type: 'stdout' | 'stderr' | 'system'; 
    content: string;
    sessionId?: string;
    repositoryPath?: string;
  }) => void;
  'repo-cloned': (data: { success: boolean; message: string; repo?: GitRepository }) => void;
  'repo-switched': (data: { 
    success: boolean; 
    message: string; 
    currentPath: string;
    sessionId?: string;
  }) => void;
  
  // Claude セッション関連イベント
  'claude-session-created': (data: { 
    sessionId: string; 
    repositoryPath: string; 
    repositoryName: string;
  }) => void;
  'claude-output-history': (data: { 
    repositoryPath: string; 
    history: ClaudeOutputLine[];
  }) => void;
  
  // ターミナル関連イベント
  'terminal-created': (data: Terminal) => void;
  'terminal-output': (data: TerminalMessage) => void;
  'terminals-list': (data: { terminals: Terminal[] }) => void;
  'terminal-closed': (data: { terminalId: string }) => void;
  'terminal-signal-sent': (data: { terminalId: string; signal: string; success: boolean }) => void;
  'terminal-output-history': (data: { 
    terminalId: string; 
    history: TerminalOutputLine[];
  }) => void;
}

export interface ClientToServerEvents {
  'clone-repo': (data: { url: string; name: string }) => void;
  'switch-repo': (data: { path: string }) => void;
  'list-repos': () => void;
  'send-command': (data: { 
    command: string;
    sessionId?: string;
    repositoryPath?: string;
  }) => void;
  'claude-interrupt': (data?: { 
    sessionId?: string;
    repositoryPath?: string;
  }) => void;
  'get-claude-history': (data: { repositoryPath: string }) => void;
  
  // ターミナル関連イベント
  'create-terminal': (data: { cwd: string; name?: string }) => void;
  'terminal-input': (data: { terminalId: string; input: string }) => void;
  'list-terminals': (data?: { repositoryPath?: string }) => void;
  'close-terminal': (data: { terminalId: string }) => void;
  'terminal-resize': (data: { terminalId: string; cols: number; rows: number }) => void;
  'terminal-signal': (data: { terminalId: string; signal: string }) => void;
}