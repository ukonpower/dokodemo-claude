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

// Socket.IO通信関連の型定義
export interface ServerToClientEvents {
  'repos-list': (data: { repos: GitRepository[] }) => void;
  'claude-output': (data: ClaudeMessage) => void;
  'claude-raw-output': (data: { type: 'stdout' | 'stderr' | 'system'; content: string }) => void;
  'repo-cloned': (data: { success: boolean; message: string; repo?: GitRepository }) => void;
  'repo-switched': (data: { success: boolean; message: string; currentPath: string }) => void;
}

export interface ClientToServerEvents {
  'clone-repo': (data: { url: string; name: string }) => void;
  'switch-repo': (data: { path: string }) => void;
  'list-repos': () => void;
  'send-command': (data: { command: string }) => void;
}

// Claude CLI 操作関連の型定義
export interface ClaudeSession {
  process: any; // pty.IPty | ChildProcess
  isActive: boolean;
  workingDirectory: string;
  isPty: boolean;
}