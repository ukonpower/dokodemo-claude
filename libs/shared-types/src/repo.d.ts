import type { AiProvider, AiExecutionStatus, RepoDisplayAiStatus } from './ai';

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

// エディタ関連の型定義
export type EditorType = 'vscode' | 'cursor' | 'code-server';

export interface EditorInfo {
  id: EditorType;
  name: string;
  command: string;
  available: boolean;
}

// dokodemo-claude 自身の更新先として選べるブランチ
export interface SelfBranch {
  name: string; // ブランチ名（例: "main" / "release/v0.1.28"）
  isCurrent: boolean; // 現在チェックアウト中か
  behind: number; // origin/<name> に対して未取り込みのコミット数
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
