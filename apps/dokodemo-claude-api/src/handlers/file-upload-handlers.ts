import path from 'path';
import { promises as fs } from 'fs';
import { v4 as uuidv4 } from 'uuid';
import type { Express, RequestHandler } from 'express';
import cors from 'cors';
import { Server as TusServer } from '@tus/server';
import { FileStore } from '@tus/file-store';
import type { HandlerContext, TypedServer } from './types.js';
import { fileManager, MAX_FILE_SIZE } from '../services/file-manager.js';
import type { FileSource } from '../types/index.js';

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

function createTusServer(io: TypedServer): TusServer {
  return new TusServer({
    path: '/api/tus',
    relativeLocation: true,
    datastore: new FileStore({ directory: fileManager.getTusStorePath() }),
    maxSize: MAX_FILE_SIZE,
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
 * ExpressアプリにREST APIルートとtusサーバーを登録
 */
export function registerFileRoutes(app: Express, io: TypedServer): void {
  const tusServer = createTusServer(io);
  const tusHandler = tusServer.handle.bind(tusServer);
  app.all('/api/tus', cors({ origin: true, credentials: true }), tusHandler as RequestHandler);
  app.all('/api/tus/*', cors({ origin: true, credentials: true }), tusHandler as RequestHandler);

  app.get('/api/media/:rid', getFilesHandler as RequestHandler);
  app.get('/api/media/:rid/:filename', getFileHandler as RequestHandler);
  app.delete(
    '/api/media/:rid/:filename',
    deleteFileHandler as RequestHandler
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
