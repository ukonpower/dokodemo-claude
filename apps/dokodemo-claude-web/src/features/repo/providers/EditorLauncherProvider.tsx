import { createContext, useContext, type ReactNode } from 'react';
import {
  useEditorLauncher,
  type UseEditorLauncherReturn,
} from '@/features/repo/hooks/useEditorLauncher';
import { useSocketContext } from '@/app/providers/SocketProvider';
import { useRepositoryContext } from '@/features/repo/providers/RepositoryProvider';

const EditorLauncherContext = createContext<UseEditorLauncherReturn | null>(
  null
);

/**
 * エディタ起動管理（useEditorLauncher）を提供する Provider。
 */
export function EditorLauncherProvider({ children }: { children: ReactNode }) {
  const { socket } = useSocketContext();
  const { repository } = useRepositoryContext();

  // エディタ起動管理
  const editorLauncher = useEditorLauncher(socket, repository.currentRepo);

  return (
    <EditorLauncherContext.Provider value={editorLauncher}>
      {children}
    </EditorLauncherContext.Provider>
  );
}

export function useEditorLauncherContext(): UseEditorLauncherReturn {
  const ctx = useContext(EditorLauncherContext);
  if (!ctx) {
    throw new Error(
      'useEditorLauncherContext must be used within EditorLauncherProvider'
    );
  }
  return ctx;
}
