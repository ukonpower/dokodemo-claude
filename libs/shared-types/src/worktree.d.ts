// Git Worktree関連の型定義
export interface GitWorktree {
  path: string; // ワークツリーの絶対パス
  branch: string; // ブランチ名
  head: string; // 現在のHEAD（commit hash）
  isMain: boolean; // メインワークツリーかどうか
  parentRepoPath: string; // 親リポジトリのパス
  memo?: string; // ワークツリーのメモ（本文のみ。URLは表示時に自動リンク化）
  memoSummary?: string; // メモの一言要約（haiku で生成。タブに表示）
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
