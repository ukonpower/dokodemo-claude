import { useState, useEffect, useCallback, useRef } from 'react';
import { io, Socket } from 'socket.io-client';
import type {
  ServerToClientEvents,
  ClientToServerEvents,
} from '../types';

/**
 * useSocket フックの戻り値
 */
export interface UseSocketReturn {
  socket: Socket<ServerToClientEvents, ClientToServerEvents> | null;
  isConnected: boolean;
  connectionAttempts: number;
  isReconnecting: boolean;
  emit: <E extends keyof ClientToServerEvents>(
    event: E,
    ...args: Parameters<ClientToServerEvents[E]>
  ) => void;
}

/**
 * Socket.IO接続を管理するカスタムフック
 * 接続・再接続ロジックをカプセル化
 */
export function useSocket(): UseSocketReturn {
  const [socket, setSocket] = useState<Socket<
    ServerToClientEvents,
    ClientToServerEvents
  > | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [connectionAttempts, setConnectionAttempts] = useState(0);
  const [isReconnecting, setIsReconnecting] = useState(false);

  // 再接続タイムアウト参照
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(
    null
  );

  // ソケットインスタンス参照（イベントリスナー登録用）
  const socketRef = useRef<Socket<
    ServerToClientEvents,
    ClientToServerEvents
  > | null>(null);

  useEffect(() => {
    const maxReconnectAttempts = 10;
    const reconnectDelay = 2000; // 2秒

    const createConnection = (): Socket<
      ServerToClientEvents,
      ClientToServerEvents
    > => {
      // フロントエンドと同じホスト名でバックエンドに接続（外部アクセス対応）
      const backendPort = import.meta.env.DC_API_PORT || '8001';
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const socketUrl = `${protocol}//${window.location.hostname}:${backendPort}`;

      // iOS Safariの検出
      const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
      const isSafari = /^((?!chrome|android).)*safari/i.test(
        navigator.userAgent
      );
      const isIOSSafari = isIOS && isSafari;

      const socketInstance = io(socketUrl, {
        autoConnect: true,
        reconnection: true,
        reconnectionAttempts: 10,
        reconnectionDelay: 1000,
        // iOS Safariでは初回接続が遅いため、タイムアウトを延長
        timeout: isIOSSafari ? 15000 : 10000,
        // iOS Safariではpollingを優先（より安定）
        transports: isIOSSafari
          ? ['polling', 'websocket']
          : ['websocket', 'polling'],
      }) as Socket<ServerToClientEvents, ClientToServerEvents>;

      socketRef.current = socketInstance;
      setSocket(socketInstance);

      // 接続イベントのハンドラ
      socketInstance.on('connect', () => {
        setIsConnected(true);
        setIsReconnecting(false);
        setConnectionAttempts(0);
      });

      socketInstance.on('disconnect', (reason) => {
        setIsConnected(false);

        // 自動再接続の場合は手動再接続を試行
        if (reason === 'io server disconnect') {
          setIsReconnecting(true);
          attemptReconnect();
        }
      });

      socketInstance.on('connect_error', () => {
        setIsConnected(false);
        setIsReconnecting(true);
        attemptReconnect();
      });

      return socketInstance;
    };

    const attemptReconnect = () => {
      setConnectionAttempts((prevAttempts) => {
        if (prevAttempts < maxReconnectAttempts) {
          const delay = reconnectDelay * (prevAttempts + 1);
          reconnectTimeoutRef.current = setTimeout(() => {
            createConnection();
          }, delay); // 指数バックオフ
          return prevAttempts + 1;
        } else {
          setIsReconnecting(false);
          return prevAttempts;
        }
      });
    };

    const socketInstance = createConnection();

    return () => {
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }
      socketInstance.disconnect();
    };
  }, []);

  // emit関数をラップして提供
  const emit = useCallback(
    <E extends keyof ClientToServerEvents>(
      event: E,
      ...args: Parameters<ClientToServerEvents[E]>
    ) => {
      if (socketRef.current) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (socketRef.current.emit as any)(event, ...args);
      }
    },
    []
  );

  return {
    socket,
    isConnected,
    connectionAttempts,
    isReconnecting,
    emit,
  };
}
