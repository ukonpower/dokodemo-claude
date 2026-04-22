import { promises as fs } from 'fs';
import path from 'path';
import type { UploadedFileInfo, FileSource, FileType } from '../types/index.js';

const METADATA_FILENAME = 'metadata.json';

interface FileMetadata {
  [filename: string]: {
    source: FileSource;
    title?: string;
    description?: string;
  };
}

const UPLOADS_ROOT_DIR = 'uploads';

export const MAX_FILE_SIZE = 2 * 1024 * 1024 * 1024; // 2GB

class FileManager {
  private projectRoot: string;

  constructor() {
    this.projectRoot = process.cwd();
  }

  setProjectRoot(root: string): void {
    this.projectRoot = root;
  }

  private getUploadsRootPath(): string {
    return path.join(this.projectRoot, UPLOADS_ROOT_DIR);
  }

  getTusStorePath(): string {
    return path.join(this.getUploadsRootPath(), '_tus');
  }

  getRepositoryUploadsPath(rid: string): string {
    return path.join(this.getUploadsRootPath(), rid);
  }

  async ensureUploadsDir(rid: string): Promise<void> {
    const dirPath = this.getRepositoryUploadsPath(rid);
    try {
      await fs.access(dirPath);
    } catch {
      await fs.mkdir(dirPath, { recursive: true });
    }
  }

  private getMetadataPath(rid: string): string {
    return path.join(this.getRepositoryUploadsPath(rid), METADATA_FILENAME);
  }

  private async readMetadata(rid: string): Promise<FileMetadata> {
    const metadataPath = this.getMetadataPath(rid);
    try {
      const content = await fs.readFile(metadataPath, 'utf-8');
      return JSON.parse(content) as FileMetadata;
    } catch {
      return {};
    }
  }

  private async writeMetadata(
    rid: string,
    metadata: FileMetadata
  ): Promise<void> {
    const metadataPath = this.getMetadataPath(rid);
    await fs.writeFile(
      metadataPath,
      JSON.stringify(metadata, null, 2),
      'utf-8'
    );
  }

  private async updateFileMetadata(
    rid: string,
    filename: string,
    data: { source: FileSource; title?: string; description?: string }
  ): Promise<void> {
    const metadata = await this.readMetadata(rid);
    metadata[filename] = {
      source: data.source,
      title: data.title,
      description: data.description,
    };
    await this.writeMetadata(rid, metadata);
  }

  private async deleteFileMetadata(
    rid: string,
    filename: string
  ): Promise<void> {
    const metadata = await this.readMetadata(rid);
    delete metadata[filename];
    await this.writeMetadata(rid, metadata);
  }

  private getMimeType(filename: string): string {
    const ext = path.extname(filename).toLowerCase();
    const mimeMap: Record<string, string> = {
      '.png': 'image/png',
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.gif': 'image/gif',
      '.webp': 'image/webp',
      '.mp4': 'video/mp4',
      '.webm': 'video/webm',
      '.mov': 'video/quicktime',
    };
    return mimeMap[ext] || 'application/octet-stream';
  }

  private getFileType(mimeType: string): FileType {
    if (mimeType.startsWith('image/')) return 'image';
    if (mimeType.startsWith('video/')) return 'video';
    return 'other';
  }

  async saveFile(
    rid: string,
    file: {
      tmpPath: string;
      filename: string;
      originalname: string;
      mimetype: string;
      size: number;
    },
    options?: {
      source?: FileSource;
      title?: string;
      description?: string;
    }
  ): Promise<{ success: boolean; message: string; file?: UploadedFileInfo }> {
    if (!rid) {
      return {
        success: false,
        message: 'リポジトリIDが指定されていません',
      };
    }

    if (file.size > MAX_FILE_SIZE) {
      return {
        success: false,
        message: `ファイルサイズが大きすぎます。最大サイズ: ${MAX_FILE_SIZE / 1024 / 1024}MB`,
      };
    }

    const source: FileSource = options?.source || 'user';

    try {
      await this.ensureUploadsDir(rid);

      const finalPath = path.join(
        this.getRepositoryUploadsPath(rid),
        file.filename
      );

      await fs.rename(file.tmpPath, finalPath);

      await this.updateFileMetadata(rid, file.filename, {
        source,
        title: options?.title,
        description: options?.description,
      });

      const fileInfo: UploadedFileInfo = {
        id: path.parse(file.filename).name,
        filename: file.filename,
        path: finalPath,
        rid,
        uploadedAt: Date.now(),
        size: file.size,
        mimeType: file.mimetype,
        source,
        type: this.getFileType(file.mimetype),
        title: options?.title,
        description: options?.description,
      };

      return {
        success: true,
        message: 'ファイルをアップロードしました',
        file: fileInfo,
      };
    } catch (error) {
      console.error('ファイル保存エラー:', error);
      return {
        success: false,
        message: 'ファイルの保存に失敗しました',
      };
    }
  }

  async getFiles(rid: string): Promise<UploadedFileInfo[]> {
    if (!rid) {
      return [];
    }

    const dirPath = this.getRepositoryUploadsPath(rid);

    try {
      await fs.access(dirPath);
    } catch {
      return [];
    }

    try {
      const entries = await fs.readdir(dirPath);
      const files: UploadedFileInfo[] = [];

      const metadata = await this.readMetadata(rid);

      for (const filename of entries) {
        if (filename === METADATA_FILENAME) continue;

        const filePath = path.join(dirPath, filename);
        const stats = await fs.stat(filePath);

        if (!stats.isFile()) continue;

        const mimeType = this.getMimeType(filename);

        const fileMeta = metadata[filename] || {
          source: 'user' as FileSource,
        };

        files.push({
          id: path.parse(filename).name,
          filename,
          path: filePath,
          rid,
          uploadedAt: stats.mtimeMs,
          size: stats.size,
          mimeType,
          source: fileMeta.source,
          type: this.getFileType(mimeType),
          title: fileMeta.title,
          description: fileMeta.description,
        });
      }

      files.sort((a, b) => b.uploadedAt - a.uploadedAt);

      return files;
    } catch (error) {
      console.error('ファイル一覧取得エラー:', error);
      return [];
    }
  }

  async deleteFile(
    rid: string,
    filename: string
  ): Promise<{ success: boolean; message: string }> {
    if (!rid) {
      return {
        success: false,
        message: 'リポジトリIDが指定されていません',
      };
    }

    const sanitizedFilename = path.basename(filename);
    if (sanitizedFilename !== filename) {
      return {
        success: false,
        message: '無効なファイル名です',
      };
    }

    const filePath = path.join(
      this.getRepositoryUploadsPath(rid),
      sanitizedFilename
    );

    try {
      await fs.access(filePath);
      await fs.unlink(filePath);
      await this.deleteFileMetadata(rid, sanitizedFilename);
      return {
        success: true,
        message: 'ファイルを削除しました',
      };
    } catch (error) {
      console.error('ファイル削除エラー:', error);
      return {
        success: false,
        message: 'ファイルの削除に失敗しました',
      };
    }
  }

  getFilePath(rid: string, filename: string): string | null {
    if (!rid) {
      return null;
    }

    const sanitizedFilename = path.basename(filename);
    if (sanitizedFilename !== filename) {
      return null;
    }

    return path.join(this.getRepositoryUploadsPath(rid), sanitizedFilename);
  }

  async initialize(): Promise<void> {
    const rootPath = this.getUploadsRootPath();
    await fs.mkdir(rootPath, { recursive: true });

    const tusPath = this.getTusStorePath();
    await fs.mkdir(tusPath, { recursive: true });
    const tusFiles = await fs.readdir(tusPath);
    for (const file of tusFiles) {
      await fs.unlink(path.join(tusPath, file)).catch(() => {});
    }
  }
}

export const fileManager = new FileManager();
export { FileManager };
