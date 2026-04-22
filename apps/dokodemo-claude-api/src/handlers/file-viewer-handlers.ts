import * as fs from 'fs/promises';
import * as path from 'path';
import type { HandlerContext } from './types.js';
import type { FileTreeEntry, FileContent } from '../types/index.js';
import { repositoryIdManager } from '../services/repository-id-manager.js';
import { startWatching, stopWatching } from '../services/file-watcher.js';

// 除外するディレクトリ名
const EXCLUDED_DIRS = new Set([
  '.git',
  'node_modules',
  'dist',
  '.next',
  '__pycache__',
  '.venv',
  '.cache',
  '.turbo',
  '.nx',
]);

// 最大ファイルサイズ（テキスト: 1MB、画像: 10MB、動画: 50MB）
const MAX_FILE_SIZE = 1 * 1024 * 1024;
const MAX_IMAGE_SIZE = 10 * 1024 * 1024;
const MAX_VIDEO_SIZE = 50 * 1024 * 1024;

// 画像ファイルの拡張子
export const IMAGE_EXTENSIONS = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.ico', '.svg', '.avif',
]);

// 動画ファイルの拡張子
export const VIDEO_EXTENSIONS = new Set([
  '.mp4', '.webm', '.mov', '.ogg',
]);

/**
 * ファイルの種類を拡張子から判定
 */
function getFileType(filePath: string): 'text' | 'image' | 'video' {
  const ext = path.extname(filePath).toLowerCase();
  if (IMAGE_EXTENSIONS.has(ext)) return 'image';
  if (VIDEO_EXTENSIONS.has(ext)) return 'video';
  return 'text';
}

// 最大行数
const MAX_LINES = 10000;

// 拡張子→言語マッピング
const EXTENSION_LANGUAGE_MAP: Record<string, string> = {
  '.ts': 'typescript',
  '.tsx': 'tsx',
  '.js': 'javascript',
  '.jsx': 'jsx',
  '.py': 'python',
  '.rs': 'rust',
  '.go': 'go',
  '.java': 'java',
  '.kt': 'kotlin',
  '.swift': 'swift',
  '.c': 'c',
  '.cpp': 'cpp',
  '.h': 'c',
  '.hpp': 'cpp',
  '.cs': 'csharp',
  '.rb': 'ruby',
  '.php': 'php',
  '.html': 'html',
  '.css': 'css',
  '.scss': 'scss',
  '.sass': 'sass',
  '.less': 'less',
  '.json': 'json',
  '.yaml': 'yaml',
  '.yml': 'yaml',
  '.xml': 'xml',
  '.md': 'markdown',
  '.mdx': 'mdx',
  '.sql': 'sql',
  '.sh': 'bash',
  '.bash': 'bash',
  '.zsh': 'bash',
  '.fish': 'bash',
  '.ps1': 'powershell',
  '.dockerfile': 'dockerfile',
  '.toml': 'toml',
  '.ini': 'ini',
  '.cfg': 'ini',
  '.env': 'bash',
  '.graphql': 'graphql',
  '.gql': 'graphql',
  '.vue': 'html',
  '.svelte': 'html',
  '.lua': 'lua',
  '.r': 'r',
  '.dart': 'dart',
  '.ex': 'elixir',
  '.exs': 'elixir',
  '.erl': 'erlang',
  '.hs': 'haskell',
  '.scala': 'scala',
  '.clj': 'clojure',
  '.vim': 'vim',
  '.makefile': 'makefile',
  '.cmake': 'cmake',
  '.tf': 'hcl',
  '.proto': 'protobuf',
};

/**
 * ファイル拡張子から言語を推定
 */
function getLanguageFromPath(filePath: string): string {
  const basename = path.basename(filePath).toLowerCase();

  // 特殊ファイル名のマッピング
  if (basename === 'dockerfile') return 'dockerfile';
  if (basename === 'makefile') return 'makefile';
  if (basename === 'cmakelists.txt') return 'cmake';

  const ext = path.extname(filePath).toLowerCase();
  return EXTENSION_LANGUAGE_MAP[ext] || 'text';
}

/**
 * パストラバーサル防止チェック
 * resolvedPath がリポジトリルート配下にあることを確認
 */
export function isPathSafe(repoRoot: string, targetPath: string): boolean {
  const resolved = path.resolve(repoRoot, targetPath);
  return resolved.startsWith(repoRoot + path.sep) || resolved === repoRoot;
}

/**
 * ディレクトリの内容を読み取る
 */
async function readDirectoryContents(
  repoRoot: string,
  relativePath: string
): Promise<FileTreeEntry[]> {
  const targetDir = path.resolve(repoRoot, relativePath);

  const dirents = await fs.readdir(targetDir, { withFileTypes: true });
  const entries: FileTreeEntry[] = [];

  for (const dirent of dirents) {
    // 隠しファイル/ディレクトリのうち、除外対象のものはスキップ
    if (EXCLUDED_DIRS.has(dirent.name)) continue;

    const entryRelativePath = relativePath
      ? path.join(relativePath, dirent.name)
      : dirent.name;

    if (dirent.isDirectory()) {
      entries.push({
        name: dirent.name,
        path: entryRelativePath,
        type: 'directory',
      });
    } else if (dirent.isFile()) {
      try {
        const stat = await fs.stat(path.join(targetDir, dirent.name));
        entries.push({
          name: dirent.name,
          path: entryRelativePath,
          type: 'file',
          size: stat.size,
        });
      } catch {
        // stat に失敗した場合はサイズなしで追加
        entries.push({
          name: dirent.name,
          path: entryRelativePath,
          type: 'file',
        });
      }
    }
  }

  // ディレクトリ→先、ファイル→後でソート。名前でアルファベット順
  entries.sort((a, b) => {
    if (a.type !== b.type) {
      return a.type === 'directory' ? -1 : 1;
    }
    return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
  });

  return entries;
}

/**
 * ファイルの内容を読み取る
 */
async function readFileContent(
  repoRoot: string,
  relativePath: string
): Promise<FileContent> {
  const targetFile = path.resolve(repoRoot, relativePath);

  const stat = await fs.stat(targetFile);
  const fileType = getFileType(relativePath);

  // メディアファイルの場合はサイズ制限を緩和し、内容は読まない
  if (fileType === 'image') {
    if (stat.size > MAX_IMAGE_SIZE) {
      throw new Error(
        `画像ファイルサイズが大きすぎます（${(stat.size / 1024 / 1024).toFixed(1)}MB）。10MB以下の画像のみ表示できます。`
      );
    }
    return {
      path: relativePath,
      content: '',
      size: stat.size,
      language: getLanguageFromPath(relativePath),
      truncated: false,
      fileType: 'image',
    };
  }

  if (fileType === 'video') {
    if (stat.size > MAX_VIDEO_SIZE) {
      throw new Error(
        `動画ファイルサイズが大きすぎます（${(stat.size / 1024 / 1024).toFixed(1)}MB）。50MB以下の動画のみ表示できます。`
      );
    }
    return {
      path: relativePath,
      content: '',
      size: stat.size,
      language: getLanguageFromPath(relativePath),
      truncated: false,
      fileType: 'video',
    };
  }

  // テキストファイルの場合は従来通り
  if (stat.size > MAX_FILE_SIZE) {
    throw new Error(
      `ファイルサイズが大きすぎます（${(stat.size / 1024 / 1024).toFixed(1)}MB）。1MB以下のファイルのみ表示できます。`
    );
  }

  const rawContent = await fs.readFile(targetFile, 'utf-8');
  const lines = rawContent.split('\n');
  const totalLines = lines.length;
  const truncated = totalLines > MAX_LINES;
  const content = truncated ? lines.slice(0, MAX_LINES).join('\n') : rawContent;

  return {
    path: relativePath,
    content,
    size: stat.size,
    language: getLanguageFromPath(relativePath),
    truncated,
    totalLines: truncated ? totalLines : undefined,
    fileType: 'text',
  };
}

/**
 * Socket.IOイベントハンドラーを登録
 */
export function registerFileViewerHandlers(ctx: HandlerContext): void {
  const { socket } = ctx;

  // ディレクトリ内容取得
  socket.on('read-directory', async (data) => {
    const { rid, path: dirPath } = data;

    const repoPath = repositoryIdManager.getPath(rid);

    // パストラバーサル防止
    if (dirPath && !isPathSafe(repoPath, dirPath)) {
      socket.emit('file-viewer-error', {
        rid,
        message: '無効なパスです',
      });
      return;
    }

    try {
      const entries = await readDirectoryContents(repoPath, dirPath || '');
      socket.emit('directory-contents', {
        rid,
        path: dirPath || '',
        entries,
      });
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : 'ディレクトリの読み取りに失敗しました';
      socket.emit('file-viewer-error', { rid, message });
    }
  });

  // ファイル監視開始
  socket.on('start-file-watch', (data) => {
    const { rid } = data;
    const repoPath = repositoryIdManager.getPath(rid);
    startWatching(rid, repoPath, ctx.io);
  });

  // ファイル監視停止
  socket.on('stop-file-watch', (data) => {
    const { rid } = data;
    stopWatching(rid);
  });

  // ファイル内容取得
  socket.on('read-file', async (data) => {
    const { rid, path: filePath } = data;

    const repoPath = repositoryIdManager.getPath(rid);

    // パストラバーサル防止
    if (!filePath || !isPathSafe(repoPath, filePath)) {
      socket.emit('file-viewer-error', {
        rid,
        message: '無効なファイルパスです',
      });
      return;
    }

    try {
      const content = await readFileContent(repoPath, filePath);
      socket.emit('file-content', { rid, content });
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : 'ファイルの読み取りに失敗しました';
      socket.emit('file-viewer-error', { rid, message });
    }
  });
}
