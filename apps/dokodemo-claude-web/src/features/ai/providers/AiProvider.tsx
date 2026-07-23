import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  type ReactNode,
  type RefObject,
} from 'react';
import type { AiInstanceTabsHandle } from '@/features/ai/components/AiInstanceTabs';
import type { AiProvider as AiProviderName } from '@/types';
import { useAiCli, type UseAiCliReturn } from '@/features/ai/hooks/useAiCli';
import {
  useCustomAiButtons,
  type UseCustomAiButtonsReturn,
} from '@/features/ai/hooks/useCustomAiButtons';
import { useSocketContext } from '@/app/providers/SocketProvider';
import { useRepositoryContext } from '@/features/repo/providers/RepositoryProvider';

export interface AiContextValue {
  aiCli: UseAiCliReturn;
  customAiButtons: UseCustomAiButtonsReturn;
  /** AIインスタンスタブの追加メニューを Shift+→（右端）から開くための ref */
  aiInstanceTabsRef: RefObject<AiInstanceTabsHandle | null>;
  primaryProvider: AiProviderName | undefined;
}

const AiContext = createContext<AiContextValue | null>(null);

/**
 * AI CLI 管理（useAiCli）・カスタム送信ボタン・AIインスタンスタブ ref を提供する Provider。
 */
export function AiProvider({ children }: { children: ReactNode }) {
  const { socket } = useSocketContext();
  const { repository } = useRepositoryContext();

  // AI CLI出力受信時のコールバック
  const onAiOutputReceived = useCallback(() => {
    repository.endLoadingOnOutput();
  }, [repository]);

  // AI CLI管理
  const aiCli = useAiCli(socket, repository.currentRepo, onAiOutputReceived);
  const { activeInstance } = aiCli;

  // AIインスタンスタブの追加メニューを Shift+→（右端）から開くための ref
  const aiInstanceTabsRef = useRef<AiInstanceTabsHandle>(null);
  const primaryProvider = aiCli.primaryInstance?.provider;

  // カスタム送信ボタン（global / repository スコープ両方）
  const customAiButtons = useCustomAiButtons(socket, repository.currentRepo);

  // active instance が決まったら履歴を取得
  useEffect(() => {
    if (!socket || !activeInstance) return;
    socket.emit('get-ai-history', { instanceId: activeInstance.instanceId });
  }, [socket, activeInstance]);

  return (
    <AiContext.Provider
      value={{ aiCli, customAiButtons, aiInstanceTabsRef, primaryProvider }}
    >
      {children}
    </AiContext.Provider>
  );
}

export function useAiContext(): AiContextValue {
  const ctx = useContext(AiContext);
  if (!ctx) {
    throw new Error('useAiContext must be used within AiProvider');
  }
  return ctx;
}
