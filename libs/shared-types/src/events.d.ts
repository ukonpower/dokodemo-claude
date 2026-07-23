import type {
  AiProvider,
  AiMessage,
  AiInstance,
  AiOutputLine,
  CommandType,
  CustomAiButton,
  CustomAiButtonScope,
} from './ai';
import type { PermissionMode, PushSubscriptionJSON } from './settings';
import type {
  IdMappingData,
  GitRepository,
  RepoProcessStatus,
  EditorInfo,
  CodeServer,
} from './repo';
import type {
  GitBranch,
  GitDiffSummary,
  GitDiffDetail,
  GitGraphData,
  GitGraphCommitDetail,
} from './git';
import type {
  GitWorktree,
  WorktreeCreateRequest,
  WorktreeSyncEntry,
  WorktreeSyncResult,
} from './worktree';
import type {
  Terminal,
  TerminalMessage,
  TerminalOutputLine,
  DetectedPortInfo,
  CommandShortcut,
} from './terminal';
import type { PromptQueueItem, PromptLoopPlanning } from './queue';
import type { FileTreeEntry, FileContent, UploadedFileInfo } from './files';

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
  'clone-status': (data: { status: string; message: string }) => void;
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
  // AI タブの指示内容要約（タブのサブテキスト表示用）
  'ai-activity-summary': (data: {
    rid: string;
    instanceId: string;
    provider: AiProvider;
    summary: string;
    timestamp: number;
  }) => void;
  // AI タブの指示内容要約の設定（現在値の通知）
  'ai-summary-settings': (data: { enabled: boolean }) => void;
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

  // 自身のリモート更新（新リリース）有無の通知
  'self-update-status': (data: { updateAvailable: boolean }) => void;

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

  // ブランチ同期状態（ahead/behind）
  'branch-sync-status': (data: {
    rid: string;
    upstream: string | null; // 例 'origin/main'。追跡ブランチが無ければ null（ahead/behind は 0）
    ahead: number; // ローカルだけにあるコミット数（push で送られる分）
    behind: number; // upstream だけにあるコミット数（pull で取り込まれる分）
  }) => void;

  // ブランチ push 開始通知
  'branch-push-started': (data: { rid: string }) => void;

  // ブランチ push 進行ログ（stdout/stderr のストリーミング配信）
  'branch-push-progress': (data: {
    rid: string;
    chunk: string;
    stream: 'stdout' | 'stderr';
  }) => void;

  // ブランチ push 結果通知
  'branch-pushed': (data: { rid: string; success: boolean; message: string }) => void;

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

  // Git Graph関連イベント
  'git-graph': (data: { rid: string; graph: GitGraphData }) => void;
  'git-graph-commit-detail': (data: {
    rid: string;
    hash: string;
    detail: GitGraphCommitDetail;
  }) => void;
  'git-graph-file-diff': (data: {
    rid: string;
    hash: string;
    detail: GitDiffDetail;
  }) => void; // GitDiffDetail は既存型
  'git-graph-error': (data: { rid: string; message: string }) => void;
  'git-graph-action-result': (data: {
    rid: string;
    action: 'checkout' | 'merge' | 'pull' | 'push' | 'fetch';
    success: boolean;
    message: string;
  }) => void;
  'git-graph-remotes-result': (data: {
    rid: string;
    remotes: string[];
  }) => void;

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
    type?: CommandType;
  }) => void;
  'ai-interrupt': (data: { instanceId: string }) => void;
  'get-ai-history': (data: { instanceId: string }) => void;
  'clear-ai-output': (data: { instanceId: string }) => void;
  'restart-ai-cli': (data: {
    instanceId: string;
    initialSize?: { cols: number; rows: number };
    permissionMode?: PermissionMode;
    /** true の場合、会話を破棄して新しいセッションで起動する */
    fresh?: boolean;
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
    rid: string; // リポジトリID（必須）
    repositoryPath?: string; // rid が引けない場合のフォールバック
  }) => void;
  'create-shortcut': (data: {
    name?: string;
    command: string;
    rid: string; // リポジトリID（必須）
    repositoryPath?: string; // rid が引けない場合のフォールバック
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
    repositoryPath?: string; // rid が引けない場合のフォールバック
  }) => void;
  'switch-branch': (data: {
    rid: string; // リポジトリID（必須）
    repositoryPath?: string; // rid が引けない場合のフォールバック
    branchName: string;
  }) => void;
  'delete-branch': (data: {
    rid: string; // リポジトリID（必須）
    repositoryPath?: string; // rid が引けない場合のフォールバック
    branchName: string;
    deleteRemote?: boolean;
  }) => void;
  'create-branch': (data: {
    rid: string; // リポジトリID（必須）
    repositoryPath?: string; // rid が引けない場合のフォールバック
    branchName: string;
    baseBranch?: string;
  }) => void;

  // ワークツリー関連イベント
  'list-worktrees': (data: {
    rid: string; // リポジトリID（必須）
    repositoryPath?: string; // rid が引けない場合のフォールバック
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
    rid: string; // リポジトリID（必須）
    repositoryPath?: string; // rid が引けない場合のフォールバック
  }) => void;
  'execute-npm-script': (data: {
    rid: string; // リポジトリID（必須）
    repositoryPath?: string; // rid が引けない場合のフォールバック
    scriptName: string;
    terminalId?: string;
  }) => void;

  // エディタ起動関連イベント
  'get-available-editors': () => void;
  'open-in-editor': (data: {
    rid: string; // リポジトリID（必須）
    repositoryPath?: string; // rid が引けない場合のフォールバック
    editor: 'vscode' | 'cursor';
  }) => void;

  // リモートURL関連イベント
  'get-remote-url': (data: {
    rid: string; // リポジトリID（必須）
    repositoryPath?: string; // rid が引けない場合のフォールバック
  }) => void;

  // code-server関連イベント
  'start-code-server': () => void;
  'stop-code-server': () => void;
  'get-code-server': () => void;
  'get-code-server-url': (data: {
    rid: string; // リポジトリID（必須）
    repositoryPath?: string; // rid が引けない場合のフォールバック
    clientHost?: string; // クライアント側で見えているホスト（window.location.host）
  }) => void;

  // dokodemo-claude自身の更新関連イベント
  'pull-self': () => void;

  // 現在ブランチの pull
  'pull-branch': (data: {
    rid?: string;
    repositoryPath?: string;
  }) => void;

  // 現在ブランチの ahead/behind 状態を取得
  // fetch: true で git fetch により remote-tracking ref を最新化してから計算する
  'get-branch-sync-status': (data: { rid: string; fetch?: boolean }) => void;

  // 現在ブランチの push
  'push-branch': (data: { rid: string }) => void;

  // プロンプトキュー関連イベント
  'add-to-prompt-queue': (data: {
    rid: string; // リポジトリID（必須）
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
      planning?: PromptLoopPlanning;
    };
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
    isCodexReview?: boolean;
    model?: string;
    // null: ループ解除 / 値あり: 設定を差し替え（iteration 等の状態は維持）
    loop?: {
      judge: 'ai' | 'user' | 'none';
      judgeEveryN: number;
      intervalSec: number;
      judgeCriteria?: string;
      planning?: PromptLoopPlanning;
    } | null;
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

  // Git Graph関連イベント
  'get-git-graph': (data: {
    rid: string;
    branches: string[] | null;
    maxCommits: number;
  }) => void;
  'get-git-graph-commit-detail': (data: { rid: string; hash: string }) => void;
  'get-git-graph-file-diff': (data: {
    rid: string;
    hash: string;
    filename: string;
    oldFilename?: string;
  }) => void;
  'git-graph-checkout': (data: {
    rid: string;
    kind: 'branch' | 'remote' | 'commit';
    name: string; // ブランチ名 / リモートブランチ名 / コミット hash
    localName?: string; // kind='remote' 時に作成するローカルブランチ名
  }) => void;
  'git-graph-merge': (data: {
    rid: string;
    target: string; // ブランチ名 or コミット hash
    noFF: boolean;
    squash: boolean;
    noCommit: boolean;
  }) => void;
  'git-graph-remotes': (data: { rid: string }) => void;
  'git-graph-pull': (data: { rid: string }) => void;
  'git-graph-push': (data: {
    rid: string;
    remote?: string; // push 先 remote 名（未指定なら upstream 追跡先へ）
    force?: boolean;
    setUpstream?: boolean;
  }) => void;
  'git-graph-fetch': (data: { rid: string; prune?: boolean }) => void;

  // AI Hooks設定関連イベント
  'check-hooks-status': (data: { provider: AiProvider }) => void;
  'add-dokodemo-hooks': (data: { provider: AiProvider }) => void;
  'remove-dokodemo-hooks': (data: { provider: AiProvider }) => void;

  // AI タブの指示内容要約の設定
  'get-ai-summary-settings': () => void;
  'set-ai-summary-settings': (data: { enabled: boolean }) => void;

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
