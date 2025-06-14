// Claude Code CLI関連
export interface ClaudeMessage {
  id: string;
  type: 'user' | 'claude' | 'system';
  content: string;
  timestamp: number;
}

// Git操作関連  
export interface GitRepository {
  url: string;
  path: string;
  status: 'cloning' | 'ready' | 'error';
}

// Socket.IO通信関連
export interface SocketEvents {
  'clone-repo': (data: { url: string; path: string }) => void;
  'switch-repo': (data: { path: string }) => void;
  'list-repos': () => void;
  'repos-list': (data: { repos: GitRepository[] }) => void;
  'send-command': (data: { command: string }) => void;
  'claude-output': (data: ClaudeMessage) => void;
}