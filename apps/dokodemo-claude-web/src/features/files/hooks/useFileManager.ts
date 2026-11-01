import { useState, useEffect, useCallback, useRef } from 'react';
import { Socket } from 'socket.io-client';
import * as tus from 'tus-js-client';
import type {
  UploadedFileInfo,
  FileSource,
  ServerToClientEvents,
  ClientToServerEvents,
} from '@/types';

/**
 * アップロードファイル一括削除の結果
 */
export interface ClearFilesResult {
  success: boolean;
  message: string;
  deletedCount: number;
  freedBytes: number;
}
import { repositoryIdMap } from '@/shared/utils/repository-id-map';
import { useRefreshOnFocus } from '@/shared/hooks/useRefreshOnFocus';
import { BACKEND_URL } from '@/shared/utils/backend-url';

export interface UseFileManagerReturn {
  files: UploadedFileInfo[];
  isUploadingFile: boolean;
  uploadProgress: number | null;
  refreshFiles: () => void;
  deleteFile: (filename: string) => void;
  /** 種別を指定してアップロードファイルを一括削除する */
  deleteAllFiles: (source: FileSource | 'all') => void;
  /** 直近の一括削除の結果（実行前・別リポジトリ宛ては null） */
  clearFilesResult: ClearFilesResult | null;
  /** 一括削除の結果表示を消す */
  dismissClearFilesResult: () => void;
  uploadFile: (file: File) => Promise<string | undefined>;
  /** 進行中のアップロードを中断する（進捗リセット・resolve(undefined)） */
  cancelUpload: () => void;
  clearState: () => void;
}

export function useFileManager(
  socket: Socket<ServerToClientEvents, ClientToServerEvents> | null,
  currentRepo: string
): UseFileManagerReturn {
  const [files, setFiles] = useState<UploadedFileInfo[]>([]);
  const [isUploadingFile, setIsUploadingFile] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const [clearFilesResult, setClearFilesResult] =
    useState<ClearFilesResult | null>(null);

  const currentRepoRef = useRef(currentRepo);

  // 進行中アップロードの中断ハンドラ。uploadFile 内でセットし、cancelUpload から呼ぶ。
  const activeUploadRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    currentRepoRef.current = currentRepo;
  }, [currentRepo]);

  // タブ復帰時にファイル一覧を再取得する。
  // dokodemo-preview / dokodemo-md の受信は file-uploaded の push 通知で
  // 届くが、バックグラウンドタブでは通知を取り逃すことがあるため、
  // 復帰タイミングで一覧を取り直して補完する。
  useRefreshOnFocus(() => {
    if (!socket || !socket.connected) return;
    const rid = repositoryIdMap.getRid(currentRepoRef.current);
    if (!rid) return;
    socket.emit('get-files', { rid });
  });

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

    // 一括削除は全クライアントへ配信されるため、rid が一致する場合だけ反映する
    const handleFilesCleared = (
      data: Parameters<ServerToClientEvents['files-cleared']>[0]
    ) => {
      const currentRid = repositoryIdMap.getRid(currentRepoRef.current);
      if (data.rid !== currentRid) return;
      setClearFilesResult({
        success: data.success,
        message: data.message,
        deletedCount: data.deletedCount,
        freedBytes: data.freedBytes,
      });
      if (data.deletedCount > 0) {
        setFiles((prev) =>
          data.source === 'all'
            ? []
            : prev.filter((f) => f.source !== data.source)
        );
      }
    };

    socket.on('files-list', handleFilesList);
    socket.on('file-deleted', handleFileDeleted);
    socket.on('file-uploaded', handleFileUploaded);
    socket.on('files-cleared', handleFilesCleared);

    return () => {
      socket.off('files-list', handleFilesList);
      socket.off('file-deleted', handleFileDeleted);
      socket.off('file-uploaded', handleFileUploaded);
      socket.off('files-cleared', handleFilesCleared);
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

  const deleteAllFiles = useCallback(
    (source: FileSource | 'all') => {
      if (!socket || !currentRepo) return;
      const rid = repositoryIdMap.getRid(currentRepo);
      if (!rid) return;
      setClearFilesResult(null);
      socket.emit('delete-all-files', { rid, source });
    },
    [socket, currentRepo]
  );

  const dismissClearFilesResult = useCallback(() => {
    setClearFilesResult(null);
  }, []);

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
          activeUploadRef.current = null;
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

        // キャンセル時は tus を中断（サーバ側の部分アップロードも破棄）し、
        // undefined で解決する。abort の失敗は握りつぶす。
        activeUploadRef.current = () => {
          upload.abort(true).catch(() => undefined);
          finish(undefined);
        };

        upload.start();
      });
    },
    [currentRepo, socket]
  );

  const cancelUpload = useCallback(() => {
    activeUploadRef.current?.();
  }, []);

  const clearState = useCallback(() => {
    activeUploadRef.current?.();
    setFiles([]);
    setIsUploadingFile(false);
    setUploadProgress(null);
  }, []);

  // リポジトリ切り替え時はアップロード進行中表示と一括削除の結果表示をリセット
  // （files は socket 応答で上書きされる）
  useEffect(() => {
    setIsUploadingFile(false);
    setUploadProgress(null);
    setClearFilesResult(null);
  }, [currentRepo]);

  return {
    files,
    isUploadingFile,
    uploadProgress,
    refreshFiles,
    deleteFile,
    deleteAllFiles,
    clearFilesResult,
    dismissClearFilesResult,
    uploadFile,
    cancelUpload,
    clearState,
  };
}
