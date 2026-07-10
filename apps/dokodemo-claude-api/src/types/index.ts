// AI プロバイダーの型定義
export type AiProvider = 'claude' | 'codex';
export type AiExecutionStatus = 'idle' | 'running' | 'completed';
export type RepoDisplayAiStatus = 'ready' | 'running' | 'done';

export type PermissionMode = 'disabled' | 'auto' | 'dangerous';

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

// AI CLI関連の型定義
export interface AiMessage {
  id: string;
  type: 'user' | 'ai' | 'system';
  content: string;
  timestamp: number;
  provider: AiProvider;
}

// AI インスタンスの型定義
// 1 リポジトリに対し複数のタブとして並列起動できる
// プライマリ: リポジトリオープン時に自動生成され、閉じられない（provider 切替は可能）
// サブ     : ユーザが + ボタンで作成、閉じられる、provider 固定
export interface AiInstance {
  instanceId: string;
  repositoryPath: string;
  provider: AiProvider;
  isPrimary: boolean;
  displayName?: string;
  order: number;
  createdAt: number;
  sessionId?: string;
  // Claude 会話の復元用セッションID（有効な UUID）。
  // claude を初回 spawn する際に --session-id で固定発行し、以降の再起動・
  // provider 復帰時は --resume でこの ID を継続する。provider が claude の
  // ときだけ使用する（codex では未使用）。
  claudeSessionId?: string;
  // Codex 会話の復元用セッションID。codex は spawn 側から ID を指定できず、
  // CLI が起動後に ~/.codex/sessions/YYYY/MM/DD/rollout-*-<uuid>.jsonl を
  // 書き出すので、spawn 後にファイルを検知して ID とパスを控える。
  // 再起動時にファイルがまだ存在すれば `codex resume <id>` で継続、
  // 取れなければフレッシュ起動する。
  codexSessionId?: string;
  codexSessionFile?: string;
}

// Git操作関連の型定義
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
  memo?: string; // ワークツリーのメモ（本文のみ。URLは表示時に自動リンク化）
  prInfo?: GitWorktreePrInfo; // 紐付く GitHub PR 情報（gh CLI 経由で取得）
}

// GitHub PR 情報（worktree のブランチに紐付く 1 件分）
export interface GitWorktreePrInfo {
  number: number;
  state: 'OPEN' | 'MERGED' | 'CLOSED';
  isDraft: boolean;
  title: string;
  url: string;
  mergedAt: string | null;
}

export interface WorktreeCreateRequest {
  parentRepoPath: string;
  branchName: string;
  baseBranch?: string;
  useExistingBranch?: boolean;
  // 新規 worktree 作成時に、親リポジトリ側から取り込むファイル/ディレクトリ
  // path は親リポジトリルートからの相対パス
  syncEntries?: WorktreeSyncEntry[];
}

// ワークツリー作成時の同期方式
export type WorktreeSyncMode = 'copy' | 'link';

// ワークツリーへ同期するエントリ 1 件
export interface WorktreeSyncEntry {
  path: string; // 親リポジトリルートからの相対パス
  mode: WorktreeSyncMode;
}

// ワークツリー作成時の同期処理結果（1 件分）
export interface WorktreeSyncResult {
  path: string;
  mode: WorktreeSyncMode;
  success: boolean;
  error?: string;
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

// ターミナル出力履歴の行情報
export interface TerminalOutputLine {
  id: string;
  content: string;
  timestamp: number;
  type: 'stdout' | 'stderr' | 'system';
}

// 検出された開発サーバーのポート情報
export interface DetectedPortInfo {
  terminalId: string;
  port: number;
  pid: number;
  command: string;
  // 実際に待ち受けているプロトコル（TLS ハンドシェイクの成否で判定）
  protocol: 'http' | 'https';
}

// エディタ関連の型定義
export type EditorType = 'vscode' | 'cursor' | 'code-server';

export interface EditorInfo {
  id: EditorType;
  name: string;
  command: string;
  available: boolean;
}

// Socket.IO通信関連の型定義
export interface ServerToClientEvents {
  // IDマッピング関連イベント
  'id-mapping': (data: IdMappingData) => void;
  'id-mapping-updated': (data: IdMappingData) => void;

  // repos はサーバー側で「最近開いた順」にソート済みで送信される
  'repos-list': (data: { repos: GitRepository[] }) => void;
  'repos-process-status': (data: { statuses: RepoProcessStatus[] }) => void;
  // パス存在確認の結果（worktree 復元前に削除済みでないかを判定するため）
  // exists=false かつ path が worktree っぽい場合、親リポジトリの導出結果を
  // 同時に返す（クライアントは round trip 1 回でフォールバック先を決められる）
  'repo-path-checked': (data: {
    path: string;
    exists: boolean;
    fallbackParentPath?: string;
    fallbackParentExists?: boolean;
  }) => void;
  'ai-output': (data: AiMessage) => void;
  'ai-output-line': (data: {
    rid: string;
    instanceId: string;
    provider: AiProvider;
    outputLine: AiOutputLine;
  }) => void;

  // AI インスタンス一覧（全クライアントに broadcast、タブ構成をクライアント間共有）
  'ai-instances-list': (data: {
    rid: string;
    instances: AiInstance[];
  }) => void;
  'ai-instance-created': (data: { rid: string; instance: AiInstance }) => void;
  'ai-instance-closed': (data: { rid: string; instanceId: string }) => void;
  'ai-instance-updated': (data: { rid: string; instance: AiInstance }) => void;
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
  'repo-switched': (data: {
    success: boolean;
    message: string;
    currentPath: string;
    rid?: string;
    primaryInstanceId?: string;
    primaryProvider?: AiProvider;
  }) => void;

  // AI セッション関連イベント（instanceId ベース）
  'ai-session-created': (data: {
    rid: string;
    instanceId: string;
    sessionId: string;
    provider: AiProvider;
  }) => void;
  'ai-restarted': (data: {
    success: boolean;
    message: string;
    rid: string;
    instanceId: string;
    provider: AiProvider;
    sessionId?: string;
  }) => void;
  'ai-output-history': (data: {
    rid: string;
    instanceId: string;
    provider: AiProvider;
    history: AiOutputLine[];
  }) => void;
  'ai-output-cleared': (data: {
    rid: string;
    instanceId: string;
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
  'terminal-ports': (data: {
    repositoryPath: string;
    rid?: string;
    ports: DetectedPortInfo[];
  }) => void;

  // コマンドショートカット関連イベント
  'shortcuts-list': (data: { rid: string; shortcuts: CommandShortcut[] }) => void;
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
    parentRepoPath?: string; // 親リポジトリのパス（フロントエンドのworktree検出に必要）
  }) => void;
  'worktree-created': (data: {
    success: boolean;
    message: string;
    worktree?: GitWorktree & { wtid?: string };
    syncResults?: WorktreeSyncResult[];
  }) => void;
  'worktree-deleted': (data: {
    success: boolean;
    message: string;
    wtid?: string; // ワークツリーID（必須）
    worktreePath?: string; // 削除されたワークツリーのパス
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

  // ワークツリー同期設定（リポジトリ単位の保存設定）
  'worktree-sync-config': (data: {
    prid?: string;
    parentRepoPath: string;
    entries: WorktreeSyncEntry[];
  }) => void;
  'worktree-sync-config-saved': (data: {
    success: boolean;
    message: string;
    prid?: string;
    parentRepoPath?: string;
  }) => void;

  // ワークツリータブの並び順の保存結果
  'worktree-sort-order-saved': (data: {
    success: boolean;
    message?: string;
    prid?: string;
    parentRepoPath?: string;
  }) => void;

  // ワークツリーのメモの保存結果
  'worktree-memo-saved': (data: {
    success: boolean;
    message?: string;
    rid?: string;
  }) => void;

  // ワークツリー同期対象候補（指定ディレクトリ直下のファイル/ディレクトリ一覧）
  'worktree-sync-candidates': (data: {
    prid?: string;
    parentRepoPath: string;
    dirPath: string; // 親リポジトリルートからの相対パス（'' でルート直下）
    entries: { name: string; type: 'file' | 'directory' }[];
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

  // リモートURL関連イベント
  'remote-url': (data: {
    success: boolean;
    remoteUrl: string | null;
    rid?: string; // リポジトリID（必須）
    message?: string;
  }) => void;

  // code-server関連イベント
  'code-server-started': (data: {
    success: boolean;
    message: string;
    server?: CodeServer;
  }) => void;
  'code-server-stopped': (data: { success: boolean; message: string }) => void;
  'code-server-info': (data: { server: CodeServer | null }) => void;
  'code-server-url': (data: {
    success: boolean;
    url?: string;
    rid?: string; // リポジトリID（必須）
    message?: string;
  }) => void;
  'code-servers-list': (data: { servers: CodeServer[] }) => void;

  // dokodemo-claude自身の更新関連イベント
  'self-pulled': (data: {
    success: boolean;
    message: string;
    output: string;
  }) => void;

  // ブランチ pull 進行ログ（stdout/stderr のストリーミング配信）
  'branch-pull-progress': (data: {
    rid?: string;
    chunk: string;
    stream: 'stdout' | 'stderr';
  }) => void;

  // ブランチ pull 開始通知（モーダル表示などのトリガー）
  'branch-pull-started': (data: {
    rid?: string;
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
  'prompt-requeued': (data: {
    success: boolean;
    message: string;
    itemId: string;
  }) => void;
  'prompt-force-sent': (data: {
    success: boolean;
    message: string;
    itemId: string;
  }) => void;
  'prompt-queue-reset': (data: { success: boolean; message: string }) => void;
  'queue-item-cancelled': (data: { success: boolean; message: string }) => void;

  // プロンプトループ関連イベント
  'prompt-loop-ended': (data: {
    rid?: string;
    provider: AiProvider;
    itemId: string;
    reason?: string;
    endedBy: 'ai-judge' | 'user';
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

  // AI Hooks設定関連イベント
  'hooks-status': (data: { configured: boolean; provider: AiProvider }) => void;
  'hooks-updated': (data: {
    success: boolean;
    message: string;
    configured: boolean;
    provider: AiProvider;
  }) => void;

  // Claude Code プラグイン関連イベント
  'plugin-status': (data: { installed: boolean }) => void;
  'plugin-updated': (data: {
    success: boolean;
    message: string;
    installed: boolean;
  }) => void;

  // ファイルビュワー関連イベント
  'directory-contents': (data: {
    rid: string;
    path: string;
    entries: FileTreeEntry[];
  }) => void;
  'file-content': (data: { rid: string; content: FileContent }) => void;
  'file-viewer-error': (data: { rid: string; message: string }) => void;
  'file-changed': (data: { rid: string; path: string; type: 'change' | 'rename' }) => void;

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
    provider?: AiProvider; // プライマリの provider を切替えたい場合に指定
    initialSize?: { cols: number; rows: number };
    permissionMode?: PermissionMode;
  }) => void;
  'list-repos': () => void;
  'update-repo-access': (data: { path: string }) => void;
  // ディレクトリの存在確認（worktree の復元前チェック用）
  'check-repo-path': (data: { path: string }) => void;

  // AI インスタンス操作（instanceId ベース）
  'list-ai-instances': (data: { rid: string }) => void;
  'create-ai-instance': (data: {
    rid: string;
    provider: AiProvider;
    initialSize?: { cols: number; rows: number };
    permissionMode?: PermissionMode;
  }) => void;
  /**
   * 指定 rid のプライマリ AI インスタンスが無ければ作成する。
   * switch-repo と違い、クライアントのアクティブ repo を変更しない。
   * ダッシュボードから複数 worktree をまとめて起動する用途。
   */
  'ensure-primary-instance': (data: {
    rid: string;
    provider: AiProvider;
    initialSize?: { cols: number; rows: number };
    permissionMode?: PermissionMode;
  }) => void;
  'close-ai-instance': (data: { instanceId: string }) => void;
  'rename-ai-instance': (data: { instanceId: string; displayName: string }) => void;

  'send-command': (data: {
    command: string;
    instanceId: string;
    type?: 'prompt' | 'clear' | 'commit' | 'raw';
  }) => void;
  'ai-interrupt': (data: { instanceId: string }) => void;
  'get-ai-history': (data: { instanceId: string }) => void;
  'clear-ai-output': (data: { instanceId: string }) => void;
  'restart-ai-cli': (data: {
    instanceId: string;
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
    rid?: string; // リポジトリID（通信最適化用）
    repositoryPath?: string;
  }) => void;
  'close-terminal': (data: { terminalId: string }) => void;
  'terminal-resize': (data: {
    terminalId: string;
    cols: number;
    rows: number;
  }) => void;
  'terminal-signal': (data: { terminalId: string; signal: string }) => void;
  'ai-resize': (data: {
    instanceId: string;
    cols: number;
    rows: number;
  }) => void;

  // コマンドショートカット関連イベント
  'list-shortcuts': (data: {
    rid?: string; // リポジトリID（通信最適化用）
    repositoryPath: string;
  }) => void;
  'create-shortcut': (data: {
    name?: string;
    command: string;
    rid?: string; // リポジトリID（通信最適化用）
    repositoryPath: string;
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
    rid?: string; // リポジトリID（通信最適化用）
    repositoryPath: string;
  }) => void;
  'switch-branch': (data: {
    rid?: string; // リポジトリID（通信最適化用）
    repositoryPath: string;
    branchName: string;
  }) => void;
  'delete-branch': (data: {
    rid?: string; // リポジトリID（通信最適化用）
    repositoryPath: string;
    branchName: string;
    deleteRemote?: boolean;
  }) => void;
  'create-branch': (data: {
    rid?: string; // リポジトリID（通信最適化用）
    repositoryPath: string;
    branchName: string;
    baseBranch?: string;
  }) => void;

  // ワークツリー関連イベント
  'list-worktrees': (data: {
    rid?: string; // リポジトリID（通信最適化用）
    repositoryPath: string;
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

  // ワークツリー同期設定の取得/保存
  'get-worktree-sync-config': (data: {
    prid?: string;
    parentRepoPath?: string;
  }) => void;
  'save-worktree-sync-config': (data: {
    prid?: string;
    parentRepoPath?: string;
    entries: WorktreeSyncEntry[];
  }) => void;

  // ワークツリータブの並び順の保存（orderedPaths はブランチワークツリーのパス配列）
  'save-worktree-sort-order': (data: {
    prid?: string;
    parentRepoPath?: string;
    orderedPaths: string[];
  }) => void;

  // ワークツリーのメモの保存（rid は worktree の wtid）
  'save-worktree-memo': (data: { rid: string; memo: string }) => void;

  // ワークツリー同期対象候補の取得（親リポジトリ内の指定ディレクトリ直下を列挙）
  'list-worktree-sync-candidates': (data: {
    prid?: string;
    parentRepoPath?: string;
    dirPath?: string;
  }) => void;

  // npmスクリプト関連イベント
  'get-npm-scripts': (data: {
    rid?: string; // リポジトリID（通信最適化用）
    repositoryPath: string;
  }) => void;
  'execute-npm-script': (data: {
    rid?: string; // リポジトリID（通信最適化用）
    repositoryPath: string;
    scriptName: string;
    terminalId?: string;
  }) => void;

  // エディタ起動関連イベント
  'get-available-editors': () => void;
  'open-in-editor': (data: {
    rid?: string; // リポジトリID（通信最適化用）
    repositoryPath: string;
    editor: 'vscode' | 'cursor';
  }) => void;

  // リモートURL関連イベント
  'get-remote-url': (data: {
    rid?: string; // リポジトリID（通信最適化用）
    repositoryPath: string;
  }) => void;

  // code-server関連イベント
  'start-code-server': () => void;
  'stop-code-server': () => void;
  'get-code-server': () => void;
  'get-code-server-url': (data: {
    rid?: string; // リポジトリID（通信最適化用）
    repositoryPath: string;
    clientHost?: string; // クライアント側で見えているホスト（window.location.host）
  }) => void;
  'get-code-servers': () => void;

  // dokodemo-claude自身の更新関連イベント
  'pull-self': () => void;

  // 現在ブランチの pull
  'pull-branch': (data: {
    rid?: string;
    repositoryPath?: string;
  }) => void;

  // プロンプトキュー関連イベント
  'add-to-prompt-queue': (data: {
    rid: string;
    provider: AiProvider;
    prompt: string;
    sendClearBefore?: boolean;
    isAutoCommit?: boolean;
    isCodexReview?: boolean;
    model?: string;
    loop?: {
      judge: 'ai' | 'user' | 'none';
      judgeEveryN: number;
      intervalSec: number;
      judgeCriteria?: string;
    };
  }) => void;
  'remove-from-prompt-queue': (data: {
    rid: string;
    provider: AiProvider;
    itemId: string;
  }) => void;
  'update-prompt-queue': (data: {
    rid: string;
    provider: AiProvider;
    itemId: string;
    prompt: string;
    sendClearBefore?: boolean;
    isAutoCommit?: boolean;
    isCodexReview?: boolean;
    model?: string;
    // null: ループ解除 / 値あり: 設定を差し替え（iteration 等の状態は維持）
    loop?: {
      judge: 'ai' | 'user' | 'none';
      judgeEveryN: number;
      intervalSec: number;
      judgeCriteria?: string;
    } | null;
  }) => void;
  'get-prompt-queue': (data: {
    rid: string;
    provider: AiProvider;
  }) => void;
  'clear-prompt-queue': (data: {
    rid: string;
    provider: AiProvider;
  }) => void;
  'pause-prompt-queue': (data: {
    rid: string;
    provider: AiProvider;
  }) => void;
  'resume-prompt-queue': (data: {
    rid: string;
    provider: AiProvider;
  }) => void;
  'reorder-prompt-queue': (data: {
    rid: string;
    provider: AiProvider;
    queue: PromptQueueItem[];
  }) => void;
  'requeue-prompt-item': (data: {
    rid: string;
    provider: AiProvider;
    itemId: string;
  }) => void;
  'force-send-prompt-queue-item': (data: {
    rid: string;
    provider: AiProvider;
    itemId: string;
  }) => void;
  'reset-prompt-queue': (data: {
    rid: string;
    provider: AiProvider;
  }) => void;
  'cancel-current-queue-item': (data: {
    rid: string;
    provider: AiProvider;
  }) => void;

  // プロンプトループ関連イベント
  'stop-prompt-loop': (data: {
    rid: string;
    provider: AiProvider;
    itemId: string;
  }) => void;
  'approve-loop-continuation': (data: {
    rid: string;
    provider: AiProvider;
    itemId: string;
    approved: boolean;
  }) => void;

  // ファイル関連イベント
  'get-files': (data: { rid: string }) => void;
  'delete-file': (data: { rid: string; filename: string }) => void;

  // Git差分関連イベント
  'get-git-diff-summary': (data: { rid: string }) => void;
  'get-git-diff-detail': (data: { rid: string; filename: string }) => void;

  // AI Hooks設定関連イベント
  'check-hooks-status': (data: { provider: AiProvider }) => void;
  'add-dokodemo-hooks': (data: { provider: AiProvider }) => void;
  'remove-dokodemo-hooks': (data: { provider: AiProvider }) => void;

  // Claude Code プラグイン関連イベント
  'check-plugin-status': () => void;
  'install-plugin': () => void;
  'uninstall-plugin': () => void;

  // ファイルビュワー関連イベント
  'read-directory': (data: { rid: string; path: string }) => void;
  'read-file': (data: { rid: string; path: string }) => void;
  'start-file-watch': (data: { rid: string }) => void;
  'stop-file-watch': (data: { rid: string }) => void;

  // Web Push通知関連イベント
  'get-vapid-public-key': () => void;
  'subscribe-push': (data: { subscription: PushSubscriptionJSON }) => void;
  'unsubscribe-push': (data: { endpoint: string }) => void;
  'test-push-notification': (data?: { repositoryPath?: string }) => void;
}

// AI CLI 操作関連の型定義
export interface AiSession {
  process: unknown; // pty.IPty | ChildProcess
  isActive: boolean;
  workingDirectory: string;
  isPty: boolean;
  provider: AiProvider;
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
// scope === 'global' は全リポジトリ共通、'repository' は repositoryPath で指定された
// リポジトリでのみ表示する
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

// プロンプトループ関連の型定義
// キューに投入したプロンプトを Stop hook 着弾のたびに末尾へ再投入し、
// 同じプロンプトを繰り返し実行する（自走）ためのアイテム内部状態
export interface PromptLoopState {
  judge: 'ai' | 'user' | 'none';
  judgeEveryN: number; // 何周ごとに判断（judge !== 'none' のとき有効、1以上）
  judgeCriteria?: string; // AI 判断時のユーザー指定判定基準（終了条件）
  intervalSec: number; // 再送待機秒数（0 = 即時）
  iteration: number; // 現在の周回番号（1始まり、サーバ側で加算）
  startedAt: number;
  startedAtCommit?: string; // ループ開始時 HEAD（AI 判断の diff 起点）
  nextSendAt?: number; // インターバル待機中の次回送信予定 epoch ms
  pendingJudge?: boolean; // この周の送信前に AI 判断が必要
  awaitingUserApproval?: boolean;
  lastJudgeReason?: string;
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
  isCodexReview?: boolean; // 完了後にCodexレビューを自動実行するか
  model?: string; // 使用するモデル（例: 'opus', 'sonnet', 'haiku'）
  loop?: PromptLoopState; // 設定されているとループアイテムとして扱う
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
// マルチインスタンス化後はプライマリの状態のみを集約して返す
export interface RepoProcessStatus {
  rid: string;
  repositoryPath: string;
  aiInstancesTotal: number; // プライマリ + サブのインスタンス数
  terminals: number;
  promptQueuePending: number;
  selectedProvider: AiProvider;
  primaryProvider?: AiProvider; // プライマリインスタンスの provider
  primaryStatus?: AiExecutionStatus; // プライマリインスタンスの実行状態
  displayAiStatus: RepoDisplayAiStatus;
  displayProvider: AiProvider;
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

// Web Push通知関連の型定義
export interface PushSubscriptionJSON {
  endpoint: string;
  keys: {
    p256dh: string;
    auth: string;
  };
}


// アップロードファイル情報の型定義
export type FileSource = 'user' | 'claude';
export type FileType = 'image' | 'video' | 'markdown' | 'other';

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
