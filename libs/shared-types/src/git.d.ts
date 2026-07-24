// ブランチ関連の型定義
export interface GitBranch {
  name: string;
  current: boolean;
  remote?: string;
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

// Git Graph関連の型定義
export interface GitGraphRef {
  name: string; // 'main', 'origin/main', 'v1.0' など refs/ プレフィックスを剥がした表示名
  type: 'head' | 'branch' | 'remote' | 'tag';
  // 他の worktree がチェックアウト中のローカルブランチ（type: 'branch' のときのみ意味を持つ）
  worktree?: boolean;
}
export interface GitGraphCommit {
  hash: string;
  parents: string[];
  author: string;
  email: string;
  date: number; // unix 秒
  message: string; // subject 1 行
  refs: GitGraphRef[];
}
export interface GitGraphData {
  commits: GitGraphCommit[];
  headHash: string; // detached でも HEAD の SHA。空リポジトリは ''
  currentBranch: string | null; // チェックアウト中のローカルブランチ名（detached なら null）
  uncommitted: { fileCount: number } | null;
  branchOptions: { name: string; isRemote: boolean }[];
  remotes: string[]; // 登録済み remote 名の一覧（push 先選択用）
  moreAvailable: boolean;
}
export interface GitGraphFileChange {
  filename: string;
  oldFilename?: string; // rename 時のみ
  status: 'A' | 'M' | 'D' | 'R';
  additions: number;
  deletions: number;
}
export interface GitGraphCommitDetail {
  hash: string;
  parents: string[];
  author: string;
  email: string;
  authorDate: number;
  committer: string;
  commitDate: number;
  body: string; // フルメッセージ（%B）
  files: GitGraphFileChange[];
}
