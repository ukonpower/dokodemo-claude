import { createContext, useContext, type ReactNode } from 'react';
import {
  useTerminal,
  type UseTerminalReturn,
} from '@/features/terminal/hooks/useTerminal';
import {
  useNpmScripts,
  type UseNpmScriptsReturn,
} from '@/features/terminal/hooks/useNpmScripts';
import { useSocketContext } from '@/app/providers/SocketProvider';
import { useRepositoryContext } from '@/features/repo/providers/RepositoryProvider';

export interface TerminalContextValue {
  terminal: UseTerminalReturn;
  npm: UseNpmScriptsReturn;
}

const TerminalContext = createContext<TerminalContextValue | null>(null);

/**
 * ターミナル管理（useTerminal）と npm スクリプト（useNpmScripts）を提供する Provider。
 */
export function TerminalProvider({ children }: { children: ReactNode }) {
  const { socket } = useSocketContext();
  const { repository } = useRepositoryContext();

  // ターミナル管理
  const terminal = useTerminal(socket, repository.currentRepo);

  // npmスクリプト関連
  const npm = useNpmScripts(
    socket,
    repository.currentRepo,
    terminal.activeTerminalId
  );

  return (
    <TerminalContext.Provider value={{ terminal, npm }}>
      {children}
    </TerminalContext.Provider>
  );
}

export function useTerminalContext(): TerminalContextValue {
  const ctx = useContext(TerminalContext);
  if (!ctx) {
    throw new Error('useTerminalContext must be used within TerminalProvider');
  }
  return ctx;
}
