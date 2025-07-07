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
  status: 'cloning' | 'creating' | 'ready' | 'error';
}

// ブランチ関連の型定義
export interface GitBranch {
  name: string;
  current: boolean;
  remote?: string;
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

// Socket.IO通信関連の型定義
export interface ServerToClientEvents {
  'repos-list': (data: { repos: GitRepository[] }) => void;
  'claude-output': (data: ClaudeMessage) => void;
  'claude-raw-output': (data: {
    type: 'stdout' | 'stderr' | 'system';
    content: string;
    sessionId?: string;
    repositoryPath?: string;
  }) => void;
  'repo-cloned': (data: {
    success: boolean;
    message: string;
    repo?: GitRepository;
  }) => void;
  'repo-created': (data: {
    success: boolean;
    message: string;
    repo?: GitRepository;
  }) => void;
  'repo-deleted': (data: {
    success: boolean;
    message: string;
    path: string;
  }) => void;
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
  'terminal-signal-sent': (data: {
    terminalId: string;
    signal: string;
    success: boolean;
  }) => void;
  'terminal-output-history': (data: {
    terminalId: string;
    history: TerminalOutputLine[];
  }) => void;

  // コマンドショートカット関連イベント
  'shortcuts-list': (data: { shortcuts: CommandShortcut[] }) => void;
  'shortcut-created': (data: {
    success: boolean;
    message: string;
    shortcut?: CommandShortcut;
  }) => void;
  'shortcut-deleted': (data: {
    success: boolean;
    message: string;
    shortcutId: string;
  }) => void;
  'shortcut-executed': (data: {
    success: boolean;
    message: string;
    shortcutId: string;
  }) => void;

  // ブランチ関連イベント
  'branches-list': (data: {
    branches: GitBranch[];
    repositoryPath: string;
  }) => void;
  'branch-switched': (data: {
    success: boolean;
    message: string;
    currentBranch: string;
    repositoryPath: string;
  }) => void;

  // npmスクリプト関連イベント
  'npm-scripts-list': (data: {
    scripts: Record<string, string>;
    repositoryPath: string;
  }) => void;
  'npm-script-executed': (data: {
    success: boolean;
    message: string;
    scriptName: string;
    terminalId?: string;
  }) => void;

  // 自走モード関連イベント
  'automode-configs-list': (data: { configs: AutoModeConfig[] }) => void;
  'automode-config-created': (data: {
    success: boolean;
    message: string;
    config?: AutoModeConfig;
  }) => void;
  'automode-config-updated': (data: {
    success: boolean;
    message: string;
    config?: AutoModeConfig;
  }) => void;
  'automode-config-deleted': (data: {
    success: boolean;
    message: string;
    configId?: string;
  }) => void;
  'automode-status-changed': (data: {
    repositoryPath: string;
    isRunning: boolean;
    configId?: string;
    isWaiting?: boolean;
    remainingTime?: number;
  }) => void;
  'automode-waiting': (data: {
    repositoryPath: string;
    remainingTime: number;
    nextExecutionTime: number;
  }) => void;
  'automode-force-executed': (data: {
    repositoryPath: string;
    success: boolean;
    message: string;
  }) => void;
}

export interface ClientToServerEvents {
  'clone-repo': (data: { url: string; name: string }) => void;
  'create-repo': (data: { name: string }) => void;
  'delete-repo': (data: { path: string; name: string }) => void;
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
  'terminal-resize': (data: {
    terminalId: string;
    cols: number;
    rows: number;
  }) => void;
  'terminal-signal': (data: { terminalId: string; signal: string }) => void;

  // コマンドショートカット関連イベント
  'list-shortcuts': (data: { repositoryPath: string }) => void;
  'create-shortcut': (data: {
    name?: string;
    command: string;
    repositoryPath: string;
  }) => void;
  'delete-shortcut': (data: { shortcutId: string }) => void;
  'execute-shortcut': (data: {
    shortcutId: string;
    terminalId: string;
  }) => void;

  // ブランチ関連イベント
  'list-branches': (data: { repositoryPath: string }) => void;
  'switch-branch': (data: {
    repositoryPath: string;
    branchName: string;
  }) => void;

  // npmスクリプト関連イベント
  'get-npm-scripts': (data: { repositoryPath: string }) => void;
  'execute-npm-script': (data: {
    repositoryPath: string;
    scriptName: string;
    terminalId?: string;
  }) => void;

  // 自走モード関連イベント
  'get-automode-configs': (data: { repositoryPath: string }) => void;
  'create-automode-config': (data: {
    name: string;
    prompt: string;
    repositoryPath: string;
    triggerMode?: 'hook';
    sendClearCommand?: boolean;
  }) => void;
  'update-automode-config': (data: {
    id: string;
    name?: string;
    prompt?: string;
    isEnabled?: boolean;
    triggerMode?: 'hook';
    sendClearCommand?: boolean;
  }) => void;
  'delete-automode-config': (data: { configId: string }) => void;
  'start-automode': (data: {
    repositoryPath: string;
    configId: string;
  }) => void;
  'stop-automode': (data: { repositoryPath: string }) => void;
  'get-automode-status': (data: { repositoryPath: string }) => void;
  'force-execute-automode': (data: { repositoryPath: string }) => void;
}

// Claude CLI 操作関連の型定義
export interface ClaudeSession {
  process: any; // pty.IPty | ChildProcess
  isActive: boolean;
  workingDirectory: string;
  isPty: boolean;
}

// コマンドショートカット関連の型定義
export interface CommandShortcut {
  id: string;
  name?: string; // オプショナル：未入力時はcommandを表示に使用
  command: string;
  repositoryPath: string;
  createdAt: number;
}

// 自走モード設定の型定義
export interface AutoModeConfig {
  id: string;
  name: string;
  prompt: string;
  repositoryPath: string;
  isEnabled: boolean;
  triggerMode: 'hook'; // hookモードのみ
  sendClearCommand: boolean; // プロンプト送信前に/clearコマンドを送信するか
  createdAt: number;
  updatedAt: number;
}

// 自走モード状態の型定義
export interface AutoModeState {
  repositoryPath: string;
  isRunning: boolean;
  currentConfigId?: string;
  lastExecutionTime?: number;
}
