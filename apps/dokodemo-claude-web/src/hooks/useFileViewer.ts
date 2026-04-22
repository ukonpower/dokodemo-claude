import { useState, useEffect, useCallback, useRef } from 'react';
import { Socket } from 'socket.io-client';
import type {
  FileTreeEntry,
  FileContent,
  GitDiffDetail,
  ServerToClientEvents,
  ClientToServerEvents,
} from '../types';
import { repositoryIdMap } from '../utils/repository-id-map';

/**
 * useFileViewer フックの戻り値
 */
export interface UseFileViewerReturn {
  // ビュー状態
  isActive: boolean;
  selectedFilePath: string | null;

  // データ
  directoryCache: Map<string, FileTreeEntry[]>;
  expandedDirs: Set<string>;
  fileContent: FileContent | null;
  isLoadingFile: boolean;
  error: string | null;

  // 差分関連
  diffDetail: GitDiffDetail | null;
  isDiffMode: boolean;

  // 全画面
  isFullScreen: boolean;

  // アクション
  open: () => void;
  close: () => void;
  toggleDir: (path: string) => void;
  selectFile: (path: string, gitStatus?: string) => void;
  backToTree: () => void;
  clearState: () => void;
  toggleDiffMode: () => void;
  toggleFullScreen: () => void;
}

/**
 * ファイルビュワーを管理するカスタムフック
 */
export function useFileViewer(
  socket: Socket<ServerToClientEvents, ClientToServerEvents> | null,
  currentRepo: string
): UseFileViewerReturn {
  // ビュー状態
  const [isActive, setIsActive] = useState<boolean>(() => {
    const urlParams = new URLSearchParams(window.location.search);
    return urlParams.get('view') === 'files';
  });
  const [selectedFilePath, setSelectedFilePath] = useState<string | null>(
    () => {
      const urlParams = new URLSearchParams(window.location.search);
      return urlParams.get('view') === 'files'
        ? urlParams.get('file') || null
        : null;
    }
  );

  // データ
  const [directoryCache, setDirectoryCache] = useState<
    Map<string, FileTreeEntry[]>
  >(new Map());
  const [expandedDirs, setExpandedDirs] = useState<Set<string>>(
    new Set([''])
  );
  const [fileContent, setFileContent] = useState<FileContent | null>(null);
  const [isLoadingFile, setIsLoadingFile] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 差分関連
  const [diffDetail, setDiffDetail] = useState<GitDiffDetail | null>(null);
  const [isDiffMode, setIsDiffMode] = useState(false);
  const [isFullScreen, setIsFullScreen] = useState<boolean>(() => {
    const urlParams = new URLSearchParams(window.location.search);
    return urlParams.get('fullscreen') === '1';
  });

  // Ref
  const currentRepoRef = useRef(currentRepo);
  const isActiveRef = useRef(isActive);

  useEffect(() => {
    currentRepoRef.current = currentRepo;
  }, [currentRepo]);
  useEffect(() => {
    isActiveRef.current = isActive;
  }, [isActive]);

  // Socketイベントリスナー
  useEffect(() => {
    if (!socket) return;

    const handleDirectoryContents = (
      data: Parameters<ServerToClientEvents['directory-contents']>[0]
    ) => {
      const currentRid = repositoryIdMap.getRid(currentRepoRef.current);
      if (data.rid === currentRid) {
        setDirectoryCache((prev) => {
          const next = new Map(prev);
          next.set(data.path, data.entries);
          return next;
        });
      }
    };

    const handleFileContent = (
      data: Parameters<ServerToClientEvents['file-content']>[0]
    ) => {
      const currentRid = repositoryIdMap.getRid(currentRepoRef.current);
      if (data.rid === currentRid) {
        setFileContent(data.content);
        setIsLoadingFile(false);
        setError(null);
      }
    };

    const handleFileViewerError = (
      data: Parameters<ServerToClientEvents['file-viewer-error']>[0]
    ) => {
      const currentRid = repositoryIdMap.getRid(currentRepoRef.current);
      if (data.rid === currentRid) {
        setError(data.message);
        setIsLoadingFile(false);
      }
    };

    const handleGitDiffDetail = (
      data: Parameters<ServerToClientEvents['git-diff-detail']>[0]
    ) => {
      const currentRid = repositoryIdMap.getRid(currentRepoRef.current);
      if (data.rid === currentRid) {
        setDiffDetail(data.detail);
      }
    };

    // ファイル変更通知を受信して自動更新
    const handleFileChanged = (
      data: Parameters<ServerToClientEvents['file-changed']>[0]
    ) => {
      const currentRid = repositoryIdMap.getRid(currentRepoRef.current);
      if (data.rid !== currentRid) return;

      // 変更されたファイルの親ディレクトリのキャッシュを無効化して再取得
      const changedDir = data.path.includes('/')
        ? data.path.substring(0, data.path.lastIndexOf('/'))
        : '';

      // rename（ファイル作成/削除）の場合はディレクトリツリーも更新
      if (data.type === 'rename') {
        setDirectoryCache((prev) => {
          if (prev.has(changedDir)) {
            socket.emit('read-directory', { rid: data.rid, path: changedDir });
          }
          return prev;
        });
      }

      // 現在表示中のファイルが変更された場合は再読み込み
      setSelectedFilePath((currentFile) => {
        if (currentFile === data.path) {
          setIsLoadingFile(true);
          socket.emit('read-file', { rid: data.rid, path: data.path });
        }
        return currentFile;
      });
    };

    // IDマッピング受信時にファイルビューワーが有効ならルートディレクトリを読み込む
    const handleIdMapping = (
      data: Parameters<ServerToClientEvents['id-mapping']>[0]
    ) => {
      // 自身でマップを更新してから読み込む（他ハンドラとの順序に依存しない）
      repositoryIdMap.update(data);

      if (!isActiveRef.current || !currentRepoRef.current) return;
      const rid = repositoryIdMap.getRid(currentRepoRef.current);
      if (!rid) return;

      // ルートディレクトリがキャッシュにない場合のみ読み込む
      setDirectoryCache((prev) => {
        if (!prev.has('')) {
          socket.emit('read-directory', { rid, path: '' });
        }
        return prev;
      });
    };

    socket.on('directory-contents', handleDirectoryContents);
    socket.on('file-content', handleFileContent);
    socket.on('file-viewer-error', handleFileViewerError);
    socket.on('git-diff-detail', handleGitDiffDetail);
    socket.on('file-changed', handleFileChanged);
    socket.on('id-mapping', handleIdMapping);
    socket.on('id-mapping-updated', handleIdMapping);

    return () => {
      socket.off('directory-contents', handleDirectoryContents);
      socket.off('file-content', handleFileContent);
      socket.off('file-viewer-error', handleFileViewerError);
      socket.off('git-diff-detail', handleGitDiffDetail);
      socket.off('file-changed', handleFileChanged);
      socket.off('id-mapping', handleIdMapping);
      socket.off('id-mapping-updated', handleIdMapping);
    };
  }, [socket]);

  // ビュワーを開いたときにルートディレクトリを読み込み、ファイル監視を開始
  useEffect(() => {
    if (isActive && socket && currentRepo) {
      const tryLoadRoot = () => {
        const rid = repositoryIdMap.getRid(currentRepo);
        if (!rid) return false;

        // ファイル監視を開始
        socket.emit('start-file-watch', { rid });

        // ルートディレクトリがキャッシュにない場合に読み込む
        if (!directoryCache.has('')) {
          socket.emit('read-directory', { rid, path: '' });
        }

        // URLにファイルパスがある場合はファイルも読み込む
        if (selectedFilePath) {
          setIsLoadingFile(true);
          socket.emit('read-file', { rid, path: selectedFilePath });

          // ファイルパスの親ディレクトリを展開
          const parts = selectedFilePath.split('/');
          const dirsToExpand = new Set(['']);
          for (let i = 1; i < parts.length; i++) {
            const dirPath = parts.slice(0, i).join('/');
            dirsToExpand.add(dirPath);
          }
          setExpandedDirs((prev) => {
            const next = new Set(prev);
            dirsToExpand.forEach((d) => next.add(d));
            return next;
          });
          // 各ディレクトリの中身を読み込む
          dirsToExpand.forEach((dirPath) => {
            if (!directoryCache.has(dirPath)) {
              socket.emit('read-directory', { rid, path: dirPath });
            }
          });
        }
        return true;
      };

      if (!tryLoadRoot()) {
        // RIDがまだ利用できない場合、短いインターバルでリトライ
        const retryInterval = setInterval(() => {
          if (tryLoadRoot()) {
            clearInterval(retryInterval);
          }
        }, 200);
        const timeout = setTimeout(() => clearInterval(retryInterval), 5000);
        return () => {
          clearInterval(retryInterval);
          clearTimeout(timeout);
        };
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isActive, socket, currentRepo]);

  // アクション
  const open = useCallback(() => {
    setIsActive(true);
    setError(null);

    // ファイル監視を開始
    if (socket && currentRepo) {
      const rid = repositoryIdMap.getRid(currentRepo);
      if (rid) {
        socket.emit('start-file-watch', { rid });
      }
    }

    const urlParams = new URLSearchParams(window.location.search);
    urlParams.set('view', 'files');
    const newUrl = `${window.location.pathname}?${urlParams.toString()}`;
    window.history.pushState({}, '', newUrl);
  }, [socket, currentRepo]);

  const close = useCallback(() => {
    setIsActive(false);
    setSelectedFilePath(null);
    setFileContent(null);
    setError(null);
    setDiffDetail(null);
    setIsDiffMode(false);
    setIsFullScreen(false);

    // ファイル監視を停止
    if (socket && currentRepo) {
      const rid = repositoryIdMap.getRid(currentRepo);
      if (rid) {
        socket.emit('stop-file-watch', { rid });
      }
    }

    const urlParams = new URLSearchParams(window.location.search);
    urlParams.delete('view');
    urlParams.delete('file');
    const newUrl = urlParams.toString()
      ? `${window.location.pathname}?${urlParams.toString()}`
      : window.location.pathname;
    window.history.pushState({}, '', newUrl);
  }, [socket, currentRepo]);

  const toggleDir = useCallback(
    (dirPath: string) => {
      setExpandedDirs((prev) => {
        const next = new Set(prev);
        if (next.has(dirPath)) {
          next.delete(dirPath);
        } else {
          next.add(dirPath);
          // ディレクトリの中身がキャッシュにない場合は読み込む
          if (!directoryCache.has(dirPath) && socket && currentRepo) {
            const rid = repositoryIdMap.getRid(currentRepo);
            if (rid) {
              socket.emit('read-directory', { rid, path: dirPath });
            }
          }
        }
        return next;
      });
    },
    [socket, currentRepo, directoryCache]
  );

  const selectFile = useCallback(
    (filePath: string, gitStatus?: string) => {
      setSelectedFilePath(filePath);
      setFileContent(null);
      setIsLoadingFile(true);
      setError(null);
      setDiffDetail(null);
      setIsDiffMode(false);

      if (socket && currentRepo) {
        const rid = repositoryIdMap.getRid(currentRepo);
        if (rid) {
          socket.emit('read-file', { rid, path: filePath });

          // 変更ファイルなら差分も取得
          if (gitStatus && gitStatus !== 'D') {
            socket.emit('get-git-diff-detail', { rid, filename: filePath });
          }
        }
      }

      // URLを更新
      const urlParams = new URLSearchParams(window.location.search);
      urlParams.set('view', 'files');
      urlParams.set('file', filePath);
      const newUrl = `${window.location.pathname}?${urlParams.toString()}`;
      window.history.pushState({}, '', newUrl);
    },
    [socket, currentRepo]
  );

  const backToTree = useCallback(() => {
    setSelectedFilePath(null);
    setFileContent(null);
    setError(null);
    setDiffDetail(null);
    setIsDiffMode(false);
    setIsFullScreen(false);

    // URLからファイルパスを削除
    const urlParams = new URLSearchParams(window.location.search);
    urlParams.delete('file');
    const newUrl = `${window.location.pathname}?${urlParams.toString()}`;
    window.history.pushState({}, '', newUrl);
  }, []);

  const toggleDiffMode = useCallback(() => {
    setIsDiffMode((prev) => !prev);
  }, []);

  const toggleFullScreen = useCallback(() => {
    setIsFullScreen((prev) => !prev);
  }, []);

  const clearState = useCallback(() => {
    setIsActive(false);
    setSelectedFilePath(null);
    setDirectoryCache(new Map());
    setExpandedDirs(new Set(['']));
    setFileContent(null);
    setIsLoadingFile(false);
    setError(null);
    setDiffDetail(null);
    setIsDiffMode(false);
    setIsFullScreen(false);
  }, []);

  // リポジトリ切り替え時に状態をリセット（初回マウントでは URL から復元した状態を保持）
  const isInitialMountRef = useRef(true);
  useEffect(() => {
    if (isInitialMountRef.current) {
      isInitialMountRef.current = false;
      return;
    }
    clearState();
  }, [currentRepo, clearState]);

  return {
    isActive,
    selectedFilePath,
    directoryCache,
    expandedDirs,
    fileContent,
    isLoadingFile,
    error,
    diffDetail,
    isDiffMode,
    isFullScreen,
    open,
    close,
    toggleDir,
    selectFile,
    backToTree,
    clearState,
    toggleDiffMode,
    toggleFullScreen,
  };
}
