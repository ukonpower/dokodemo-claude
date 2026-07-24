import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { Socket } from 'socket.io-client';
import type {
  EditorInfo,
  EditorType,
  ServerToClientEvents,
  ClientToServerEvents,
} from '@/types';
import { repositoryIdMap } from '@/shared/utils/repository-id-map';
import { useOutsideClose } from '@/shared/hooks/useOutsideClose';

/**
 * useEditorLauncher フックの戻り値
 */
export interface UseEditorLauncherReturn {
  // 状態
  availableEditors: EditorInfo[];
  showEditorMenu: boolean;
  startingCodeServer: boolean;
  showPopupBlockedModal: boolean;
  blockedCodeServerUrl: string;
  remoteUrl: string | null;

  // localhostアクセスかどうか
  isLocalhost: boolean;

  // アクション
  openInEditor: (editor: EditorType) => void;
  startCodeServer: () => void;
  setShowEditorMenu: (show: boolean) => void;
  setShowPopupBlockedModal: (show: boolean) => void;
  openBlockedUrl: () => void;

  // ref
  editorMenuRef: React.RefObject<HTMLDivElement | null>;
}

/**
 * エディタ起動を管理するカスタムフック
 */
export function useEditorLauncher(
  socket: Socket<ServerToClientEvents, ClientToServerEvents> | null,
  currentRepo: string
): UseEditorLauncherReturn {
  // 状態
  const [availableEditors, setAvailableEditors] = useState<EditorInfo[]>([]);
  const [showEditorMenu, setShowEditorMenu] = useState<boolean>(false);
  const [startingCodeServer, setStartingCodeServer] = useState<boolean>(false);
  const [showPopupBlockedModal, setShowPopupBlockedModal] =
    useState<boolean>(false);
  const [blockedCodeServerUrl, setBlockedCodeServerUrl] = useState<string>('');
  const [remoteUrl, setRemoteUrl] = useState<string | null>(null);

  // Ref
  const editorMenuRef = useRef<HTMLDivElement>(null);
  const currentRepoRef = useRef(currentRepo);

  useEffect(() => {
    currentRepoRef.current = currentRepo;
  }, [currentRepo]);

  // localhostからのアクセスかどうかを判定
  const isLocalhost = useMemo(() => {
    return (
      window.location.hostname === 'localhost' ||
      window.location.hostname === '127.0.0.1'
    );
  }, []);

  // ドロップダウンメニューの外側クリック / Escape で閉じる
  const closeEditorMenu = useCallback(() => setShowEditorMenu(false), []);
  useOutsideClose(showEditorMenu, closeEditorMenu, {
    ignore: [editorMenuRef],
  });

  // Socketイベントリスナー
  useEffect(() => {
    if (!socket) return;

    // 利用可能なエディタリストの受信
    const handleAvailableEditors = (
      data: Parameters<ServerToClientEvents['available-editors']>[0]
    ) => {
      // code-server は dokodemo-claude のコア機能のため、available 判定に関わらず常に選択肢に含める
      // （ローカルエディタが検出されたときも code-server を選べるようにする）
      setAvailableEditors(
        data.editors.filter(
          (editor: EditorInfo) => editor.available || editor.id === 'code-server'
        )
      );
    };

    // リモートURL受信
    const handleRemoteUrl = (
      data: Parameters<ServerToClientEvents['remote-url']>[0]
    ) => {
      if (data.success && data.remoteUrl) {
        setRemoteUrl(data.remoteUrl);
      } else {
        setRemoteUrl(null);
      }
    };

    // エディタ起動結果
    const handleEditorOpened = (
      data: Parameters<ServerToClientEvents['editor-opened']>[0]
    ) => {
      if (!data.success) {
        console.error(data.message);
        alert(data.message);
      }
    };

    // code-server URL取得結果
    const handleCodeServerUrl = (
      data: { success: boolean; url?: string; message?: string }
    ) => {
      setStartingCodeServer(false);
      if (data.success && data.url) {
        // 新しいタブでcode-serverを開く
        const newWindow = window.open(data.url, '_blank');
        if (
          !newWindow ||
          newWindow.closed ||
          typeof newWindow.closed === 'undefined'
        ) {
          console.warn('Popup blocked. Showing modal.');
          setBlockedCodeServerUrl(data.url);
          setShowPopupBlockedModal(true);
        }
      } else {
        console.error('Failed to get code-server URL:', data.message);
        alert(`code-serverのURLを取得できませんでした: ${data.message}`);
      }
    };

    socket.on('available-editors', handleAvailableEditors);
    socket.on('remote-url', handleRemoteUrl);
    socket.on('editor-opened', handleEditorOpened);
    socket.on('code-server-url', handleCodeServerUrl);

    return () => {
      socket.off('available-editors', handleAvailableEditors);
      socket.off('remote-url', handleRemoteUrl);
      socket.off('editor-opened', handleEditorOpened);
      socket.off('code-server-url', handleCodeServerUrl);
    };
  }, [socket]);

  // アクション関数
  const startCodeServer = useCallback(() => {
    if (socket && currentRepo) {
      setStartingCodeServer(true);
      const rid = repositoryIdMap.getRid(currentRepo);
      if (!rid) return;
      socket.emit('get-code-server-url', {
        rid,
        clientHost: window.location.host,
      });
    }
  }, [socket, currentRepo]);

  const openInEditor = useCallback(
    (editor: EditorType) => {
      if (socket && currentRepo) {
        setShowEditorMenu(false);
        if (editor === 'code-server') {
          startCodeServer();
        } else {
          const rid = repositoryIdMap.getRid(currentRepo);
          if (!rid) return;
          socket.emit('open-in-editor', { rid, editor });
        }
      }
    },
    [socket, currentRepo, startCodeServer]
  );

  const openBlockedUrl = useCallback(() => {
    window.open(blockedCodeServerUrl, '_blank');
  }, [blockedCodeServerUrl]);

  return {
    availableEditors,
    showEditorMenu,
    startingCodeServer,
    showPopupBlockedModal,
    blockedCodeServerUrl,
    remoteUrl,
    isLocalhost,
    openInEditor,
    startCodeServer,
    setShowEditorMenu,
    setShowPopupBlockedModal,
    openBlockedUrl,
    editorMenuRef,
  };
}
