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
