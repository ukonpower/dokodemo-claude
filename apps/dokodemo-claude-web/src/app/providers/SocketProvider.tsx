import { createContext, useContext, type ReactNode } from 'react';
import { useSocket, type UseSocketReturn } from '@/app/hooks/useSocket';

const SocketContext = createContext<UseSocketReturn | null>(null);

/**
 * Socket.IO接続を提供する Provider。
 * value は useSocket の戻り値（socket / isConnected / connectionAttempts / isReconnecting 等）をそのまま渡す。
 */
export function SocketProvider({ children }: { children: ReactNode }) {
  // 基盤フック
  const socket = useSocket();

  return (
    <SocketContext.Provider value={socket}>{children}</SocketContext.Provider>
  );
}

export function useSocketContext(): UseSocketReturn {
  const ctx = useContext(SocketContext);
  if (!ctx) {
    throw new Error('useSocketContext must be used within SocketProvider');
  }
  return ctx;
}
