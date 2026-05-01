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
 *
 * Socket.IOクライアント標準の自動再接続(reconnection: true)に再接続ロジックを委ねる。
 * 独自の再接続実装は複数socketインスタンスの並列接続を引き起こすため避ける。
 */
export function useSocket(): UseSocketReturn {
  const [socket, setSocket] = useState<Socket<
    ServerToClientEvents,
    ClientToServerEvents
  > | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [connectionAttempts, setConnectionAttempts] = useState(0);
  const [isReconnecting, setIsReconnecting] = useState(false);

  // ソケットインスタンス参照（emit関数から参照するため）
  const socketRef = useRef<Socket<
    ServerToClientEvents,
    ClientToServerEvents
  > | null>(null);

  useEffect(() => {
    // フロントエンドと同じホスト名でバックエンドに接続（外部アクセス対応）
    const backendPort = import.meta.env.DC_API_PORT || '8001';
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const socketUrl = `${protocol}//${window.location.hostname}:${backendPort}`;

    // transports は指定せず Socket.IO デフォルト（polling → WebSocket アップグレード）に任せる。
    // 初回接続の安定性・速度のためにはこれが最も確実。
    // 参考: https://socket.io/docs/v4/client-options/#transports
    const socketInstance = io(socketUrl, {
      autoConnect: true,
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
      timeout: 10000,
    }) as Socket<ServerToClientEvents, ClientToServerEvents>;

    socketRef.current = socketInstance;
    setSocket(socketInstance);

    // 接続成功
    const handleConnect = () => {
      setIsConnected(true);
      setIsReconnecting(false);
      setConnectionAttempts(0);
    };

    // 切断
    const handleDisconnect = () => {
      setIsConnected(false);
    };

    // 初回接続失敗（Socket.IO自身が自動再接続するので、ここで新しいsocketを作らない）
    const handleConnectError = () => {
      setIsConnected(false);
      setIsReconnecting(true);
    };

    // 再接続試行中（Manager レベルのイベント）
    const handleReconnectAttempt = (attempt: number) => {
      setConnectionAttempts(attempt);
      setIsReconnecting(true);
    };

    // 再接続成功（Manager レベルのイベント）
    const handleReconnect = () => {
      setIsConnected(true);
      setIsReconnecting(false);
      setConnectionAttempts(0);
    };

    // 再接続失敗（最大試行回数到達。reconnectionAttempts: Infinity のため通常は発火しない）
    const handleReconnectFailed = () => {
      setIsReconnecting(false);
    };

    socketInstance.on('connect', handleConnect);
    socketInstance.on('disconnect', handleDisconnect);
    socketInstance.on('connect_error', handleConnectError);
    socketInstance.io.on('reconnect_attempt', handleReconnectAttempt);
    socketInstance.io.on('reconnect', handleReconnect);
    socketInstance.io.on('reconnect_failed', handleReconnectFailed);

    return () => {
      socketInstance.off('connect', handleConnect);
      socketInstance.off('disconnect', handleDisconnect);
      socketInstance.off('connect_error', handleConnectError);
      socketInstance.io.off('reconnect_attempt', handleReconnectAttempt);
      socketInstance.io.off('reconnect', handleReconnect);
      socketInstance.io.off('reconnect_failed', handleReconnectFailed);
      socketInstance.disconnect();
      socketRef.current = null;
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
