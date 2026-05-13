import type { PermissionMode } from '../components/SettingsModal';

// AI プロバイダーの型定義
export type AiProvider = 'claude' | 'codex';
export type AiExecutionStatus = 'idle' | 'running' | 'completed';
export type RepoDisplayAiStatus = 'ready' | 'running' | 'done';

export type { PermissionMode };

// リポジトリID参照方式の型定義
// id はパスから決定的に算出される（再起動しても同じパスから同じ id になる）
// 通常リポジトリ: REPOS_DIR からの相対パス（例: "dokodemo-claude"）
// ワークツリー  : "wt:" + WORKTREES_DIR からの相対パス（例: "wt:dokodemo-claude/feature/foo"）
// URL に埋め込む場合は ":" や "/" が含まれるため encodeURIComponent でエスケープすること
export interface RepositoryIdMapping {
  id: string;
  path: string;
}

export interface WorktreeIdMapping {
  id: string;
  path: string;
  parentId: string;
}

export interface IdMappingData {
  repositories: RepositoryIdMapping[];
  worktrees: WorktreeIdMapping[];
}

// コマンドタイプの型定義
// needsEnter: コマンド送信後に改行を自動送信するかどうか
export type CommandType = 'prompt' | 'clear' | 'commit' | 'raw';

export interface CommandConfig {
  needsEnter: boolean; // 改行を自動送信するか
}

// AI CLI関連の型定義
export interface AiMessage {
  id: string;
  type: 'user' | 'ai' | 'system';
  content: string;
  timestamp: number;
  provider: AiProvider;
}

export interface GitRepository {
  url: string;
  path: string;
  name: string;
  status: 'cloning' | 'creating' | 'ready' | 'error';
  // ワークツリー関連の情報
  isWorktree?: boolean; // ワークツリーかどうか
  parentRepoName?: string; // 親リポジトリ名（ワークツリーの場合のみ）
  worktreeBranch?: string; // ワークツリーのブランチ名（ワークツリーの場合のみ）
}

// ブランチ関連の型定義
export interface GitBranch {
  name: string;
  current: boolean;
  remote?: string;
}

// Git Worktree関連の型定義
export interface GitWorktree {
  path: string; // ワークツリーの絶対パス
  branch: string; // ブランチ名
  head: string; // 現在のHEAD（commit hash）
  isMain: boolean; // メインワークツリーかどうか
  parentRepoPath: string; // 親リポジトリのパス
}

export interface WorktreeCreateRequest {
  parentRepoPath: string;
  branchName: string;
  baseBranch?: string;
  useExistingBranch?: boolean;
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
  provider: AiProvider;
}

// ターミナル出力履歴関連の型定義
export interface TerminalOutputLine {
  id: string;
  content: string;
  timestamp: number;
  type: 'stdout' | 'stderr' | 'system';
}

// エディタ関連の型定義
export type EditorType = 'vscode' | 'cursor' | 'code-server';

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
  isDefault?: boolean; // デフォルトショートカットフラグ（削除不可）
}

// AI CLI カスタム送信ボタン
// scope === 'global' は全リポジトリ共通、'repository' は repositoryPath で
// 指定されたリポジトリでのみ表示する
export type CustomAiButtonScope = 'global' | 'repository';

export interface CustomAiButton {
  id: string;
  name: string;
  command: string;
  createdAt: number;
  order: number;
  scope: CustomAiButtonScope;
  repositoryPath?: string; // scope === 'repository' のときに必須
}

// code-server関連の型定義
export interface CodeServer {
  repositoryPath: string;
  port: number; // code-serverポート
  status: 'starting' | 'running' | 'stopped' | 'error';
  pid?: number; // code-serverプロセスID
  url: string; // アクセス用URL (例: http://localhost:8080)
  password?: string; // 認証パスワード
  startedAt?: number;
}


// プロンプトキュー関連の型定義
export interface PromptQueueItem {
  id: string;
  prompt: string;
  repositoryPath: string;
  provider: AiProvider;
  createdAt: number;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  sendClearBefore?: boolean; // プロンプト送信前に/clearを実行するか
  isAutoCommit?: boolean; // 完了後に自動的に/commitを実行するか
  model?: string; // 使用するモデル（例: 'opus', 'sonnet', 'haiku'）
}

export interface PromptQueueState {
  repositoryPath: string;
  provider: AiProvider;
  queue: PromptQueueItem[];
  isProcessing: boolean;
  isPaused: boolean; // キュー送信の一時停止状態
  currentItemId?: string;
}

// リポジトリごとのプロセス状態
export interface RepoProcessStatus {
  rid: string;
  repositoryPath: string;
  aiSessions: number;
  terminals: number;
  promptQueuePending: number;
  aiExecutionStatuses: Record<AiProvider, AiExecutionStatus>;
  selectedProvider: AiProvider;
  displayAiStatus: RepoDisplayAiStatus;
  displayProvider: AiProvider;
}

// ファイルビュワー関連の型定義
export interface FileTreeEntry {
  name: string;
  path: string; // リポジトリルートからの相対パス
  type: 'file' | 'directory';
  size?: number;
}

export interface FileContent {
  path: string;
  content: string;
  size: number;
  language: string; // 拡張子から推定
  truncated: boolean;
  totalLines?: number;
  fileType?: 'text' | 'image' | 'video';
}

// Git差分関連の型定義
export interface GitDiffFile {
  filename: string;
  status: 'A' | 'M' | 'D' | 'R' | 'U'; // Added, Modified, Deleted, Renamed, Untracked
  additions: number;
  deletions: number;
  oldFilename?: string; // Renamedの場合
}

export interface GitDiffSummary {
  files: GitDiffFile[];
  totalAdditions: number;
  totalDeletions: number;
}

export interface GitDiffDetail {
  filename: string;
  diff: string; // unified diff形式
}


// アップロードファイル情報の型定義
export type FileSource = 'user' | 'claude';
export type FileType = 'image' | 'video' | 'other';

export interface UploadedFileInfo {
  id: string;
  filename: string;
  path: string;
  rid: string;
  uploadedAt: number;
  size: number;
  mimeType: string;
  source: FileSource;
  type: FileType;
  title?: string;
  description?: string;
}

export interface ServerToClientEvents {
  // IDマッピング関連イベント
  'id-mapping': (data: IdMappingData) => void;
  'id-mapping-updated': (data: IdMappingData) => void;

  'repos-list': (data: { repos: GitRepository[]; lastAccessTimes: Record<string, number> }) => void;
  'repos-process-status': (data: { statuses: RepoProcessStatus[] }) => void;
  'clone-status': (data: { status: string; message: string }) => void;
  'ai-output': (data: AiMessage) => void;
  'ai-output-line': (data: {
    sessionId: string;
    rid: string; // リポジトリID（通信最適化用）
    provider: AiProvider;
    outputLine: AiOutputLine;
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
  'repo-processes-stopped': (data: {
    success: boolean;
    message: string;
    rid: string;
    aiSessionsClosed: number;
    terminalsClosed: number;
  }) => void;
  connect: () => void;
  disconnect: (reason: string) => void;
  connect_error: (error: Error) => void;
  'repo-switched': (data: {
    success: boolean;
    message: string;
    currentPath: string;
    rid?: string; // リポジトリID（通信最適化用）
    sessionId?: string;
    provider?: AiProvider;
  }) => void;

  // AI セッション関連イベント
  'ai-session-created': (data: {
    sessionId: string;
    rid: string; // リポジトリID（必須）
    repositoryName: string;
    provider: AiProvider;
  }) => void;
  'ai-session-id-updated': (data: {
    sessionId: string;
    rid: string; // リポジトリID（必須）
    provider: AiProvider;
  }) => void;
  'ai-restarted': (data: {
    success: boolean;
    message: string;
    rid: string; // リポジトリID（必須）
    provider: AiProvider;
    sessionId?: string;
  }) => void;
  'ai-output-history': (data: {
    rid: string; // リポジトリID（必須）
    history: AiOutputLine[];
    provider: AiProvider;
  }) => void;
  'ai-output-cleared': (data: {
    rid: string; // リポジトリID（必須）
    provider: AiProvider;
    success: boolean;
  }) => void;

  // ターミナル関連イベント
  'terminal-created': (data: Terminal & { rid?: string }) => void;
  'terminal-output': (data: TerminalMessage) => void;
  'terminals-list': (data: {
    terminals: (Terminal & { rid?: string })[];
    rid?: string; // リポジトリID
  }) => void;
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

  // カスタム送信ボタン関連イベント
  'custom-ai-buttons-list': (data: { buttons: CustomAiButton[] }) => void;
  'custom-ai-button-saved': (data: {
    success: boolean;
    message: string;
    button?: CustomAiButton;
  }) => void;
  'custom-ai-button-deleted': (data: {
    success: boolean;
    message: string;
    buttonId: string;
  }) => void;

  // ブランチ関連イベント
  'branches-list': (data: {
    branches: GitBranch[];
    rid?: string; // リポジトリID（必須）
  }) => void;
  'branch-switched': (data: {
    success: boolean;
    message: string;
    currentBranch: string;
    rid?: string; // リポジトリID（必須）
  }) => void;
  'branch-deleted': (data: {
    success: boolean;
    message: string;
    branchName: string;
    rid?: string; // リポジトリID（必須）
    remoteDeleteResult?: {
      attempted: boolean;
      success: boolean;
      message?: string;
    };
  }) => void;
  'branch-created': (data: {
    success: boolean;
    message: string;
    branchName: string;
    rid?: string; // リポジトリID（必須）
  }) => void;

  // ワークツリー関連イベント
  'worktrees-list': (data: {
    worktrees: (GitWorktree & { wtid?: string })[];
    prid?: string; // 親リポジトリID（必須）
    parentRepoPath?: string; // 親リポジトリのパス（worktree検出に必要）
  }) => void;
  'worktree-created': (data: {
    success: boolean;
    message: string;
    worktree?: GitWorktree & { wtid?: string };
  }) => void;
  'worktree-deleted': (data: {
    success: boolean;
    message: string;
    wtid?: string; // ワークツリーID（必須）
  }) => void;
  'worktree-merged': (data: {
    success: boolean;
    message: string;
    wtid?: string; // ワークツリーID（必須）
    mergeResult?: {
      mergedBranch?: string;
      targetBranch?: string;
      conflictFiles?: string[];
      errorDetails?: string;
    };
  }) => void;

  // npmスクリプト関連イベント
  'npm-scripts-list': (data: {
    scripts: Record<string, string>;
    rid?: string; // リポジトリID（必須）
  }) => void;
  'npm-script-executed': (data: {
    success: boolean;
    message: string;
    scriptName: string;
    terminalId?: string;
  }) => void;

  // エディタ起動関連イベント
  'available-editors': (data: { editors: EditorInfo[] }) => void;
  'editor-opened': (data: {
    success: boolean;
    message: string;
    editor: 'vscode' | 'cursor';
    rid?: string; // リポジトリID（必須）
  }) => void;

  // code-server関連イベント
  'code-server-started': (data: {
    success: boolean;
    message: string;
    server?: CodeServer;
  }) => void;
  'code-server-stopped': (data: {
    success: boolean;
    message: string;
    rid?: string; // リポジトリID（必須）
  }) => void;
  'code-servers-list': (data: { servers: CodeServer[] }) => void;

  // dokodemo-claude自身の更新関連イベント
  'self-pulled': (data: {
    success: boolean;
    message: string;
    output: string;
  }) => void;

  // ブランチ pull 結果通知
  'branch-pulled': (data: {
    success: boolean;
    message: string;
    output: string;
    rid?: string;
  }) => void;

  // プロンプトキュー関連イベント
  'prompt-queue-updated': (data: {
    rid?: string; // リポジトリID（必須）
    provider: AiProvider;
    queue: PromptQueueItem[];
    isProcessing: boolean;
    isPaused: boolean;
    currentItemId?: string;
  }) => void;
  'prompt-added-to-queue': (data: {
    success: boolean;
    message: string;
    item?: PromptQueueItem;
  }) => void;
  'prompt-removed-from-queue': (data: {
    success: boolean;
    message: string;
    itemId: string;
  }) => void;
  'prompt-updated-in-queue': (data: {
    success: boolean;
    message: string;
    itemId: string;
  }) => void;
  'prompt-queue-processing-started': (data: {
    rid?: string; // リポジトリID（必須）
    provider: AiProvider;
    itemId: string;
  }) => void;
  'prompt-queue-processing-completed': (data: {
    rid?: string; // リポジトリID（必須）
    provider: AiProvider;
    itemId: string;
    success: boolean;
  }) => void;

  // ファイル関連イベント
  'files-list': (data: { rid: string; files: UploadedFileInfo[] }) => void;
  'file-uploaded': (data: {
    rid: string;
    success: boolean;
    message: string;
    file?: UploadedFileInfo;
  }) => void;
  'file-deleted': (data: {
    success: boolean;
    message: string;
    rid: string;
    filename: string;
  }) => void;

  // Git差分関連イベント
  'git-diff-summary': (data: { rid: string; summary: GitDiffSummary }) => void;
  'git-diff-detail': (data: {
    rid: string;
    filename: string;
    detail: GitDiffDetail;
  }) => void;
  'git-diff-error': (data: { rid: string; message: string }) => void;

  // ファイルビュワー関連イベント
  'directory-contents': (data: {
    rid: string;
    path: string;
    entries: FileTreeEntry[];
  }) => void;
  'file-content': (data: { rid: string; content: FileContent }) => void;
  'file-viewer-error': (data: { rid: string; message: string }) => void;
  'file-changed': (data: { rid: string; path: string; type: 'change' | 'rename' }) => void;

  // Claude Code Hooks設定関連イベント
  'hooks-status': (data: { configured: boolean; port: number }) => void;
  'hooks-updated': (data: {
    success: boolean;
    message: string;
    configured: boolean;
  }) => void;

  // Web Push通知関連イベント
  'vapid-public-key': (data: { key: string }) => void;
  'push-subscribed': (data: { success: boolean }) => void;
  'push-unsubscribed': (data: { success: boolean }) => void;
  'push-test-sent': (data: { success: boolean; error?: string }) => void;
}

export interface ClientToServerEvents {
  'clone-repo': (data: { url: string; name: string }) => void;
  'create-repo': (data: { name: string }) => void;
  'stop-repo-processes': (data: { rid: string }) => void;
  'get-repos-process-status': () => void;
  'delete-repo': (data: { path: string; name: string }) => void;
  'switch-repo': (data: {
    path: string;
    provider?: AiProvider;
    initialSize?: { cols: number; rows: number };
    permissionMode?: PermissionMode;
  }) => void;
  'list-repos': () => void;
  'update-repo-access': (data: { path: string }) => void;
  'send-command': (data: {
    command: string;
    sessionId?: string;
    rid: string; // リポジトリID（必須）
    provider?: AiProvider;
  }) => void;
  'ai-interrupt': (data?: {
    sessionId?: string;
    rid?: string; // リポジトリID
    provider?: AiProvider;
  }) => void;
  'get-ai-history': (data: {
    rid: string; // リポジトリID（必須）
    provider: AiProvider;
  }) => void;
  'clear-ai-output': (data: {
    rid: string; // リポジトリID（必須）
    provider: AiProvider;
  }) => void;
  'restart-ai-cli': (data: {
    rid: string; // リポジトリID（必須）
    provider: AiProvider;
    initialSize?: { cols: number; rows: number };
    permissionMode?: PermissionMode;
  }) => void;

  // ターミナル関連イベント
  'create-terminal': (data: {
    rid?: string; // リポジトリID（通信最適化用）
    cwd: string;
    name?: string;
    initialSize?: { cols: number; rows: number };
  }) => void;
  'terminal-input': (data: { terminalId: string; input: string }) => void;
  'list-terminals': (data?: {
    rid?: string; // リポジトリID
  }) => void;
  'close-terminal': (data: { terminalId: string }) => void;
  'terminal-resize': (data: {
    terminalId: string;
    cols: number;
    rows: number;
  }) => void;
  'terminal-signal': (data: { terminalId: string; signal: string }) => void;
  'ai-resize': (data: {
    rid: string; // リポジトリID（必須）
    provider: AiProvider;
    cols: number;
    rows: number;
  }) => void;

  // コマンドショートカット関連イベント
  'list-shortcuts': (data: {
    rid: string; // リポジトリID（必須）
  }) => void;
  'create-shortcut': (data: {
    name?: string;
    command: string;
    rid: string; // リポジトリID（必須）
  }) => void;
  'delete-shortcut': (data: { shortcutId: string }) => void;
  'execute-shortcut': (data: {
    shortcutId: string;
    terminalId: string;
  }) => void;

  // カスタム送信ボタン関連イベント
  'list-custom-ai-buttons': () => void;
  'create-custom-ai-button': (data: {
    name: string;
    command: string;
    scope: CustomAiButtonScope;
    repositoryPath?: string;
  }) => void;
  'update-custom-ai-button': (data: {
    id: string;
    name: string;
    command: string;
    scope: CustomAiButtonScope;
    repositoryPath?: string;
  }) => void;
  'delete-custom-ai-button': (data: { id: string }) => void;
  'reorder-custom-ai-buttons': (data: { orderedIds: string[] }) => void;

  // ブランチ関連イベント
  'list-branches': (data: {
    rid: string; // リポジトリID（必須）
  }) => void;
  'switch-branch': (data: {
    rid: string; // リポジトリID（必須）
    branchName: string;
  }) => void;
  'delete-branch': (data: {
    rid: string; // リポジトリID（必須）
    branchName: string;
    deleteRemote?: boolean;
  }) => void;
  'create-branch': (data: {
    rid: string; // リポジトリID（必須）
    branchName: string;
    baseBranch?: string;
  }) => void;

  // ワークツリー関連イベント
  'list-worktrees': (data: {
    rid: string; // リポジトリID（必須）
  }) => void;
  'create-worktree': (
    data: WorktreeCreateRequest & {
      prid?: string; // 親リポジトリID（通信最適化用）
    }
  ) => void;
  'delete-worktree': (data: {
    wtid?: string; // ワークツリーID（通信最適化用）
    worktreePath: string;
    prid?: string; // 親リポジトリID（通信最適化用）
    parentRepoPath: string;
    deleteBranch?: boolean;
    branchName?: string;
  }) => void;
  'merge-worktree': (data: {
    wtid?: string; // ワークツリーID（通信最適化用）
    worktreePath: string;
    prid?: string; // 親リポジトリID（通信最適化用）
    parentRepoPath: string;
  }) => void;

  // npmスクリプト関連イベント
  'get-npm-scripts': (data: {
    rid: string; // リポジトリID（必須）
  }) => void;
  'execute-npm-script': (data: {
    rid: string; // リポジトリID（必須）
    scriptName: string;
    terminalId?: string;
  }) => void;

  // エディタ起動関連イベント
  'get-available-editors': () => void;
  'open-in-editor': (data: {
    rid: string; // リポジトリID（必須）
    editor: 'vscode' | 'cursor';
  }) => void;

  // code-server関連イベント
  'get-code-server-url': (data: {
    rid: string; // リポジトリID（必須）
  }) => void;

  // dokodemo-claude自身の更新関連イベント
  'pull-self': () => void;

  // 現在ブランチの pull
  'pull-branch': (data: {
    rid?: string;
    repositoryPath?: string;
  }) => void;

  // プロンプトキュー関連イベント
  'add-to-prompt-queue': (data: {
    rid: string; // リポジトリID（必須）
    provider: AiProvider;
    prompt: string;
    sendClearBefore?: boolean;
    isAutoCommit?: boolean;
    model?: string;
  }) => void;
  'remove-from-prompt-queue': (data: {
    rid: string; // リポジトリID（必須）
    provider: AiProvider;
    itemId: string;
  }) => void;
  'update-prompt-queue': (data: {
    rid: string; // リポジトリID（必須）
    provider: AiProvider;
    itemId: string;
    prompt: string;
    sendClearBefore?: boolean;
    isAutoCommit?: boolean;
    model?: string;
  }) => void;
  'get-prompt-queue': (data: {
    rid: string; // リポジトリID（必須）
    provider: AiProvider;
  }) => void;
  'clear-prompt-queue': (data: {
    rid: string; // リポジトリID（必須）
    provider: AiProvider;
  }) => void;
  'pause-prompt-queue': (data: {
    rid: string; // リポジトリID（必須）
    provider: AiProvider;
  }) => void;
  'resume-prompt-queue': (data: {
    rid: string; // リポジトリID（必須）
    provider: AiProvider;
  }) => void;
  'reorder-prompt-queue': (data: {
    rid: string; // リポジトリID（必須）
    provider: AiProvider;
    queue: PromptQueueItem[];
  }) => void;
  'requeue-prompt-item': (data: {
    rid: string; // リポジトリID（必須）
    provider: AiProvider;
    itemId: string;
  }) => void;
  'force-send-prompt-queue-item': (data: {
    rid: string; // リポジトリID（必須）
    provider: AiProvider;
    itemId: string;
  }) => void;
  'reset-prompt-queue': (data: {
    rid: string; // リポジトリID（必須）
    provider: AiProvider;
  }) => void;
  'cancel-current-queue-item': (data: {
    rid: string; // リポジトリID（必須）
    provider: AiProvider;
  }) => void;

  // ファイル関連イベント
  'get-files': (data: { rid: string }) => void;
  'delete-file': (data: { rid: string; filename: string }) => void;

  // Git差分関連イベント
  'get-git-diff-summary': (data: { rid: string }) => void;
  'get-git-diff-detail': (data: { rid: string; filename: string }) => void;

  // ファイルビュワー関連イベント
  'read-directory': (data: { rid: string; path: string }) => void;
  'read-file': (data: { rid: string; path: string }) => void;
  'start-file-watch': (data: { rid: string }) => void;
  'stop-file-watch': (data: { rid: string }) => void;

  // Claude Code Hooks設定関連イベント
  'check-hooks-status': (data: { port: number }) => void;
  'add-dokodemo-hooks': (data: { port: number }) => void;
  'remove-dokodemo-hooks': (data: { port: number }) => void;

  // Web Push通知関連イベント
  'get-vapid-public-key': () => void;
  'subscribe-push': (data: { subscription: PushSubscriptionJSON }) => void;
  'unsubscribe-push': (data: { endpoint: string }) => void;
  'test-push-notification': (data?: { repositoryPath?: string }) => void;
}


// Web Push通知関連の型定義
export interface PushSubscriptionJSON {
  endpoint: string;
  keys: {
    p256dh: string;
    auth: string;
  };
}
