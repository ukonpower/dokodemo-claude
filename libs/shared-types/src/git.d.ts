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
