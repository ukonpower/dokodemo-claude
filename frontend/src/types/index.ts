// AI プロバイダーの型定義
export type AiProvider = 'claude' | 'codex';

// AI CLI関連の型定義
export interface AiMessage {
  id: string;
  type: 'user' | 'ai' | 'system';
  content: string;
  timestamp: number;
  provider: AiProvider; // プロバイダー情報を追加
}

// 後方互換性のためにClaudeMessageを維持
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
  status: 'cloning' | 'creating' | 'ready' | 'error';
}

// ブランチ関連の型定義
export interface GitBranch {
  name: string;
  current: boolean;
  remote?: string;
}

export interface Repository {
  name: string;
  path: string;
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

// AI CLI出力履歴の行情報
export interface AiOutputLine {
  id: string;
  content: string;
  timestamp: number;
  type: 'stdout' | 'stderr' | 'system';
  provider: AiProvider; // プロバイダー情報を追加
}

// 後方互換性のためにClaudeOutputLineを維持
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

// エディタ関連の型定義
export type EditorType = 'vscode' | 'cursor';

export interface EditorInfo {
  id: EditorType;
  name: string;
  command: string;
  available: boolean;
}

// コマンドショートカット関連の型定義
export interface CommandShortcut {
  id: string;
  name?: string; // オプショナル：未入力時はcommandを表示に使用
  command: string;
  repositoryPath: string;
  createdAt: number;
}

// 自走モード関連の型定義
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

export interface AutoModeState {
  repositoryPath: string;
  isRunning: boolean;
  currentConfigId?: string;
  lastExecutionTime?: number;
}

// 差分タイプ関連の型定義
// READMEより:
// . (dot) - 全未コミット変更 (staging area + unstaged)
// staged - ステージングエリアの変更
// working - 未ステージの変更のみ
// HEAD - 最新コミット
// custom - カスタム指定（ブランチ名、コミットハッシュ等）
export type DiffType = 'HEAD' | 'staged' | 'working' | 'all' | 'custom';

export interface DiffConfig {
  type: DiffType;
  customValue?: string; // カスタムの場合のブランチ名やコミットハッシュ
}

// 差分チェックサーバー関連の型定義
export interface ReviewServer {
  repositoryPath: string;
  mainPort: number; // difit固定ポート（3100）
  status: 'starting' | 'running' | 'stopped' | 'error';
  mainPid?: number; // difitプロセスID
  url: string; // アクセス用URL
  startedAt?: number;
  diffConfig?: DiffConfig; // 差分設定
}

export interface ServerToClientEvents {
  'repos-list': (data: { repos: GitRepository[] }) => void;
  'clone-status': (data: { status: string; message: string }) => void;
  'claude-output': (data: ClaudeMessage) => void;
  'claude-raw-output': (data: {
    type: 'stdout' | 'stderr' | 'system';
    content: string;
    sessionId?: string;
    repositoryPath?: string;
    provider?: AiProvider;
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
  connect: () => void;
  disconnect: (reason: string) => void;
  connect_error: (error: Error) => void;
  'repo-switched': (data: {
    success: boolean;
    message: string;
    currentPath: string;
    sessionId?: string;
  }) => void;

  // AI セッション関連イベント
  'ai-session-created': (data: {
    sessionId: string;
    repositoryPath: string;
    repositoryName: string;
    provider: AiProvider;
  }) => void;
  'ai-restarted': (data: {
    success: boolean;
    message: string;
    repositoryPath: string;
    provider: AiProvider;
    sessionId?: string;
  }) => void;
  'ai-output-history': (data: {
    repositoryPath: string;
    history: AiOutputLine[];
    provider: AiProvider;
  }) => void;
  'ai-output-cleared': (data: {
    repositoryPath: string;
    provider: AiProvider;
    success: boolean;
  }) => void;

  // Claude セッション関連イベント（後方互換性）
  'claude-session-created': (data: {
    sessionId: string;
    repositoryPath: string;
    repositoryName: string;
  }) => void;
  'claude-output-history': (data: {
    repositoryPath: string;
    history: ClaudeOutputLine[];
  }) => void;
  'claude-output-cleared': (data: {
    repositoryPath: string;
    success: boolean;
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

  // 差分チェックサーバー関連イベント
  'review-server-started': (data: {
    success: boolean;
    message: string;
    server?: ReviewServer;
  }) => void;
  'review-server-stopped': (data: {
    success: boolean;
    message: string;
    repositoryPath: string;
  }) => void;
  'review-servers-list': (data: { servers: ReviewServer[] }) => void;

  // エディタ起動関連イベント
  'available-editors': (data: { editors: EditorInfo[] }) => void;
  'editor-opened': (data: {
    success: boolean;
    message: string;
    editor: 'vscode' | 'cursor';
    repositoryPath: string;
  }) => void;
}

export interface ClientToServerEvents {
  'clone-repo': (data: { url: string; name: string }) => void;
  'create-repo': (data: { name: string }) => void;
  'delete-repo': (data: { path: string; name: string }) => void;
  'switch-repo': (data: { path: string; provider?: AiProvider }) => void;
  'list-repos': () => void;
  'send-command': (data: {
    command: string;
    sessionId?: string;
    repositoryPath?: string;
    provider?: AiProvider;
  }) => void;
  'ai-interrupt': (data?: {
    sessionId?: string;
    repositoryPath?: string;
    provider?: AiProvider;
  }) => void;
  'get-ai-history': (data: {
    repositoryPath: string;
    provider: AiProvider;
  }) => void;
  'clear-ai-output': (data: {
    repositoryPath: string;
    provider: AiProvider;
  }) => void;
  'restart-ai-cli': (data: {
    repositoryPath: string;
    provider: AiProvider;
  }) => void;
  'claude-interrupt': (data?: {
    sessionId?: string;
    repositoryPath?: string;
  }) => void;
  'get-claude-history': (data: { repositoryPath: string }) => void;
  'clear-claude-output': (data: { repositoryPath: string }) => void;

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

  // 差分チェックサーバー関連イベント
  'start-review-server': (data: {
    repositoryPath: string;
    diffConfig?: DiffConfig;
  }) => void;
  'stop-review-server': (data: { repositoryPath: string }) => void;
  'get-review-servers': () => void;

  // エディタ起動関連イベント
  'get-available-editors': () => void;
  'open-in-editor': (data: {
    repositoryPath: string;
    editor: 'vscode' | 'cursor';
  }) => void;
}
