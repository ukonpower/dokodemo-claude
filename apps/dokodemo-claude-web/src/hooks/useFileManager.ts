import { useState, useEffect, useCallback, useRef } from 'react';
import { Socket } from 'socket.io-client';
import * as tus from 'tus-js-client';
import type {
  UploadedFileInfo,
  ServerToClientEvents,
  ClientToServerEvents,
} from '../types';
import { repositoryIdMap } from '../utils/repository-id-map';
import { BACKEND_URL } from '../utils/backend-url';

export interface UseFileManagerReturn {
  files: UploadedFileInfo[];
  isUploadingFile: boolean;
  uploadProgress: number | null;
  refreshFiles: () => void;
  deleteFile: (filename: string) => void;
  uploadFile: (file: File) => Promise<string | undefined>;
  clearState: () => void;
}

export function useFileManager(
  socket: Socket<ServerToClientEvents, ClientToServerEvents> | null,
  currentRepo: string
): UseFileManagerReturn {
  const [files, setFiles] = useState<UploadedFileInfo[]>([]);
  const [isUploadingFile, setIsUploadingFile] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);

  const currentRepoRef = useRef(currentRepo);

  useEffect(() => {
    currentRepoRef.current = currentRepo;
  }, [currentRepo]);

  useEffect(() => {
    if (!socket) return;

    const handleFilesList = (
      data: Parameters<ServerToClientEvents['files-list']>[0]
    ) => {
      const currentRid = repositoryIdMap.getRid(currentRepoRef.current);
      if (data.rid === currentRid) {
        setFiles(data.files);
      }
    };

    const handleFileDeleted = (
      data: Parameters<ServerToClientEvents['file-deleted']>[0]
    ) => {
      if (data.success) {
        const currentRid = repositoryIdMap.getRid(currentRepoRef.current);
        if (data.rid === currentRid) {
          setFiles((prev) =>
            prev.filter((f) => f.filename !== data.filename)
          );
        }
      }
    };

    const handleFileUploaded = (
      data: Parameters<ServerToClientEvents['file-uploaded']>[0]
    ) => {
      const currentRid = repositoryIdMap.getRid(currentRepoRef.current);
      if (data.rid === currentRid && data.success && data.file) {
        setFiles((prev) => {
          const exists = prev.some((f) => f.filename === data.file!.filename);
          if (exists) return prev;
          return [...prev, data.file!];
        });
      }
    };

    socket.on('files-list', handleFilesList);
    socket.on('file-deleted', handleFileDeleted);
    socket.on('file-uploaded', handleFileUploaded);

    return () => {
      socket.off('files-list', handleFilesList);
      socket.off('file-deleted', handleFileDeleted);
      socket.off('file-uploaded', handleFileUploaded);
    };
  }, [socket]);

  const refreshFiles = useCallback(() => {
    if (socket && currentRepo) {
      const rid = repositoryIdMap.getRid(currentRepo);
      if (!rid) return;
      socket.emit('get-files', { rid });
    }
  }, [socket, currentRepo]);

  const deleteFile = useCallback(
    (filename: string) => {
      if (socket && currentRepo) {
        const rid = repositoryIdMap.getRid(currentRepo);
        if (!rid) return;
        socket.emit('delete-file', { rid, filename });
      }
    },
    [socket, currentRepo]
  );

  const uploadFile = useCallback(
    (file: File): Promise<string | undefined> => {
      return new Promise((resolve) => {
        if (!currentRepo) {
          resolve(undefined);
          return;
        }
        const rid = repositoryIdMap.getRid(currentRepo);
        if (!rid) {
          resolve(undefined);
          return;
        }

        if (!socket) {
          resolve(undefined);
          return;
        }

        setIsUploadingFile(true);
        setUploadProgress(0);

        // アップロード完了後に file-uploaded 通知を待つ保険タイマー。
        // アップロード所要時間とはレースさせず、onSuccess 後にだけ張る。
        let fallbackTimeout: ReturnType<typeof setTimeout> | undefined;
        let settled = false;

        const cleanup = () => {
          socket.off('file-uploaded', handler);
          if (fallbackTimeout) clearTimeout(fallbackTimeout);
          setIsUploadingFile(false);
          setUploadProgress(null);
        };

        // 完了判定は一度きり。tus の onSuccess/onError と socket 通知が
        // 二重に走っても最初の 1 回だけ resolve する。
        const finish = (value: string | undefined) => {
          if (settled) return;
          settled = true;
          cleanup();
          resolve(value);
        };

        const handler = (
          data: Parameters<ServerToClientEvents['file-uploaded']>[0]
        ) => {
          if (data.rid === rid && data.success && data.file) {
            finish(data.file.path);
          }
        };
        socket.on('file-uploaded', handler);

        const upload = new tus.Upload(file, {
          endpoint: `${BACKEND_URL}/api/tus`,
          chunkSize: 5 * 1024 * 1024,
          retryDelays: [0, 1000, 3000, 5000],
          metadata: {
            filename: file.name,
            filetype: file.type,
            rid,
          },
          onProgress(bytesUploaded, bytesTotal) {
            setUploadProgress(
              Math.round((bytesUploaded / bytesTotal) * 100)
            );
          },
          onSuccess() {
            socket.emit('get-files', { rid });
            // アップロード自体は完了済み。ここから file-uploaded 通知を
            // 待つが、来なくても 10 秒でフォールバック解決する。
            if (fallbackTimeout) clearTimeout(fallbackTimeout);
            fallbackTimeout = setTimeout(() => {
              finish(undefined);
            }, 10000);
          },
          onError() {
            console.error('ファイルアップロードエラー');
            finish(undefined);
          },
        });
        upload.start();
      });
    },
    [currentRepo, socket]
  );

  const clearState = useCallback(() => {
    setFiles([]);
    setIsUploadingFile(false);
    setUploadProgress(null);
  }, []);

  // リポジトリ切り替え時はアップロード進行中表示だけリセット（files は socket 応答で上書き）
  useEffect(() => {
    setIsUploadingFile(false);
    setUploadProgress(null);
  }, [currentRepo]);

  return {
    files,
    isUploadingFile,
    uploadProgress,
    refreshFiles,
    deleteFile,
    uploadFile,
    clearState,
  };
}
