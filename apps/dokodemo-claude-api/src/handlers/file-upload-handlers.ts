import path from 'path';
import { promises as fs } from 'fs';
import os from 'os';
import { v4 as uuidv4 } from 'uuid';
import express from 'express';
import type { Express, RequestHandler } from 'express';
import { Server as TusServer } from '@tus/server';
import { FileStore } from '@tus/file-store';
import type { HandlerContext, TypedServer } from './types.js';
import { fileManager, MAX_FILE_SIZE } from '../services/file-manager.js';
import type { FileSource } from '../types/index.js';

// プレビューAPI: raw binary POST受け取り時の上限
const PREVIEW_MAX_FILE_SIZE = 50 * 1024 * 1024; // 50MB

/**
 * GET /api/media/:rid
 */
export const getFilesHandler: RequestHandler = async (req, res) => {
  const { rid } = req.params;
  const files = await fileManager.getFiles(rid);
  res.json({ rid, files });
};

/**
 * GET /api/media/:rid/:filename
 */
export const getFileHandler: RequestHandler = async (req, res) => {
  const { rid, filename } = req.params;

  const filePath = fileManager.getFilePath(rid, filename);

  if (!filePath) {
    res.status(404).json({
      success: false,
      message: 'ファイルが見つかりません',
    });
    return;
  }

  res.sendFile(filePath, (err: Error | undefined) => {
    if (err && !res.headersSent) {
      res.status(404).json({
        success: false,
        message: 'ファイルが見つかりません',
      });
    }
  });
};

/**
 * DELETE /api/media/:rid/:filename
 */
export const deleteFileHandler: RequestHandler = async (req, res) => {
  const { rid, filename } = req.params;

  const result = await fileManager.deleteFile(rid, filename);

  if (result.success) {
    res.json({ ...result, rid, filename });
  } else {
    res.status(400).json({ ...result, rid, filename });
  }
};

// CORS許可オリジン（カンマ区切り）
// 未設定または "*" の場合は全オリジン許可（@tus/serverのデフォルト動作）
function getAllowedOrigins(): string[] | undefined {
  const raw = process.env.DC_CORS_ORIGIN;
  if (!raw || raw.trim() === '' || raw.trim() === '*') return undefined;
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

function createTusServer(io: TypedServer): TusServer {
  return new TusServer({
    path: '/api/tus',
    relativeLocation: true,
    datastore: new FileStore({ directory: fileManager.getTusStorePath() }),
    maxSize: MAX_FILE_SIZE,
    // CORS設定: @tus/server自身にCORS処理を任せる
    // （express側のcorsミドルウェアと併用するとプリフライトでtus固有ヘッダーが
    // Access-Control-Allow-Headersから漏れてCORSエラーになるため）
    allowedCredentials: true,
    allowedOrigins: getAllowedOrigins(),
    onUploadFinish: async (_req, upload) => {
      const metadata = upload.metadata ?? {};
      const rid = metadata.rid;
      const source = (metadata.source as FileSource) || 'user';
      const title = metadata.title;
      const description = metadata.description;
      const originalname = metadata.filename || upload.id;
      const mimetype = metadata.filetype || 'application/octet-stream';

      if (!rid) {
        throw { status_code: 400, body: 'rid is required in metadata' };
      }

      const ext = path.extname(originalname).toLowerCase();
      const filename = `${Date.now()}_${uuidv4().substring(0, 8)}${ext}`;

      const result = await fileManager.saveFile(
        rid,
        {
          tmpPath: path.join(fileManager.getTusStorePath(), upload.id),
          filename,
          originalname,
          mimetype,
          size: upload.offset,
        },
        { source, title: title ?? undefined, description: description ?? undefined }
      );

      await fs
        .unlink(
          path.join(fileManager.getTusStorePath(), upload.id + '.json')
        )
        .catch(() => {});

      if (result.success) {
        io.emit('file-uploaded', {
          rid,
          success: true,
          message: 'ファイルがアップロードされました',
          file: result.file,
        });
      }

      return {};
    },
  });
}

/**
 * POST /api/preview/:rid
 * Claude Code等のCLIから画像（または任意ファイル）をシンプルにアップロードするための
 * raw binary 受け取りエンドポイント。
 *
 * - Content-Type: image/png 等の MIME を指定（filetype として保存される）
 * - Body: ファイルバイナリ
 * - クエリパラメータ:
 *   - filename: 元のファイル名（省略時は uuid + 拡張子）
 *   - source: 'claude' | 'user'（省略時 'claude'）
 *   - title: UI表示用タイトル
 *   - description: 補足説明
 */
export function createPreviewUploadHandler(io: TypedServer): RequestHandler {
  return async (req, res) => {
    try {
      const { rid } = req.params;
      if (!rid) {
        res.status(400).json({ success: false, message: 'rid が必要です' });
        return;
      }

      const body = req.body as Buffer | undefined;
      if (!Buffer.isBuffer(body) || body.length === 0) {
        res.status(400).json({
          success: false,
          message: 'ファイルバイナリがリクエストボディに含まれていません',
        });
        return;
      }

      const sourceParam = (req.query.source as string | undefined) ?? 'claude';
      const source: FileSource =
        sourceParam === 'user' || sourceParam === 'claude'
          ? sourceParam
          : 'claude';
      const title = (req.query.title as string | undefined) || undefined;
      const description =
        (req.query.description as string | undefined) || undefined;
      const mimetype = req.headers['content-type'] || 'application/octet-stream';

      const originalname =
        (req.query.filename as string | undefined) ||
        `${Date.now()}.${mimetype.split('/')[1] || 'bin'}`;

      const ext = path.extname(originalname).toLowerCase();
      const filename = `${Date.now()}_${uuidv4().substring(0, 8)}${ext}`;

      const tmpPath = path.join(
        os.tmpdir(),
        `dokodemo-preview-${uuidv4()}${ext}`
      );
      await fs.writeFile(tmpPath, body);

      const result = await fileManager.saveFile(
        rid,
        {
          tmpPath,
          filename,
          originalname,
          mimetype: mimetype.split(';')[0].trim(),
          size: body.length,
        },
        { source, title, description }
      );

      if (!result.success) {
        await fs.unlink(tmpPath).catch(() => {});
        res.status(400).json(result);
        return;
      }

      io.emit('file-uploaded', {
        rid,
        success: true,
        message: 'ファイルがアップロードされました',
        file: result.file,
      });

      res.status(201).json({
        success: true,
        message: result.message,
        file: result.file,
      });
    } catch (error) {
      console.error('プレビューアップロードエラー:', error);
      res.status(500).json({
        success: false,
        message: 'プレビューアップロードに失敗しました',
      });
    }
  };
}

/**
 * ExpressアプリにREST APIルートとtusサーバーを登録
 */
export function registerFileRoutes(app: Express, io: TypedServer): void {
  const tusServer = createTusServer(io);
  const tusHandler = tusServer.handle.bind(tusServer);
  // cors()ミドルウェアは経由させない（tusサーバー自身がCORSヘッダーを返す）
  app.all('/api/tus', tusHandler as RequestHandler);
  app.all('/api/tus/*', tusHandler as RequestHandler);

  app.get('/api/media/:rid', getFilesHandler as RequestHandler);
  app.get('/api/media/:rid/:filename', getFileHandler as RequestHandler);
  app.delete(
    '/api/media/:rid/:filename',
    deleteFileHandler as RequestHandler
  );

  // プレビュー用raw POST APIを登録（任意Content-Type受け取り）
  app.post(
    '/api/preview/:rid',
    express.raw({ type: '*/*', limit: PREVIEW_MAX_FILE_SIZE }),
    createPreviewUploadHandler(io)
  );
}

/**
 * Socket.IOイベントハンドラーを登録
 */
export function registerFileHandlers(ctx: HandlerContext): void {
  const { socket } = ctx;

  socket.on('get-files', async (data) => {
    const { rid } = data;
    const files = await fileManager.getFiles(rid);
    socket.emit('files-list', { rid, files });
  });

  socket.on('delete-file', async (data) => {
    const { rid, filename } = data;
    const result = await fileManager.deleteFile(rid, filename);
    socket.emit('file-deleted', {
      ...result,
      rid,
      filename,
    });
  });
}
