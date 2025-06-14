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

export interface ServerToClientEvents {
  'repos-list': (data: { repos: GitRepository[] }) => void;
  'claude-output': (data: ClaudeMessage) => void;
  'repo-cloned': (data: { success: boolean; message: string; repo?: GitRepository }) => void;
  'repo-switched': (data: { success: boolean; message: string; currentPath: string }) => void;
}

export interface ClientToServerEvents {
  'clone-repo': (data: { url: string; name: string }) => void;
  'switch-repo': (data: { path: string }) => void;
  'list-repos': () => void;
  'send-command': (data: { command: string }) => void;
}