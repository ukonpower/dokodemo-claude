import { createContext, useContext, type ReactNode } from 'react';
import {
  useFileViewer,
  type UseFileViewerReturn,
} from '@/features/files/hooks/useFileViewer';
import {
  useFileManager,
  type UseFileManagerReturn,
} from '@/features/files/hooks/useFileManager';
import {
  useArtifacts,
  type UseArtifactsReturn,
} from '@/features/files/hooks/useArtifacts';
import { useSocketContext } from '@/app/providers/SocketProvider';
import { useRepositoryContext } from '@/features/repo/providers/RepositoryProvider';

const FileViewerContext = createContext<UseFileViewerReturn | null>(null);
const FileManagerContext = createContext<UseFileManagerReturn | null>(null);
const ArtifactsContext = createContext<UseArtifactsReturn | null>(null);

/**
 * ファイルビュワー（useFileViewer）・ファイル管理（useFileManager）・Artifact 一覧（useArtifacts）を
 * 1 つの Provider で呼び、それぞれ別の Context で提供する。
 */
export function FilesProvider({ children }: { children: ReactNode }) {
  const { socket } = useSocketContext();
  const { repository } = useRepositoryContext();

  // ファイルビュワー管理
  const fileViewer = useFileViewer(socket, repository.currentRepo);

  // ファイル管理
  const fileManager = useFileManager(socket, repository.currentRepo);

  // claude.ai Artifact 一覧
  const artifacts = useArtifacts(socket, repository.currentRepo);

  return (
    <FileViewerContext.Provider value={fileViewer}>
      <FileManagerContext.Provider value={fileManager}>
        <ArtifactsContext.Provider value={artifacts}>
          {children}
        </ArtifactsContext.Provider>
      </FileManagerContext.Provider>
    </FileViewerContext.Provider>
  );
}

export function useFileViewerContext(): UseFileViewerReturn {
  const ctx = useContext(FileViewerContext);
  if (!ctx) {
    throw new Error('useFileViewerContext must be used within FilesProvider');
  }
  return ctx;
}

export function useFileManagerContext(): UseFileManagerReturn {
  const ctx = useContext(FileManagerContext);
  if (!ctx) {
    throw new Error('useFileManagerContext must be used within FilesProvider');
  }
  return ctx;
}

export function useArtifactsContext(): UseArtifactsReturn {
  const ctx = useContext(ArtifactsContext);
  if (!ctx) {
    throw new Error('useArtifactsContext must be used within FilesProvider');
  }
  return ctx;
}
