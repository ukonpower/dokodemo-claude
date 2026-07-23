import type { ReactNode } from 'react';
import { SocketProvider } from '@/app/providers/SocketProvider';
import { RepositoryProvider } from '@/features/repo/providers/RepositoryProvider';
import { AppSettingsProvider } from '@/app/providers/AppSettingsProvider';
import { AiProvider } from '@/features/ai/providers/AiProvider';
import { TerminalProvider } from '@/features/terminal/providers/TerminalProvider';
import { WorktreeProvider } from '@/features/worktree/providers/WorktreeProvider';
import { QueueProvider } from '@/features/ai/providers/QueueProvider';
import { GitProvider } from '@/features/git/providers/GitProvider';
import { FilesProvider } from '@/features/files/providers/FilesProvider';
import { EditorLauncherProvider } from '@/features/repo/providers/EditorLauncherProvider';

/**
 * 各機能の Provider を依存順に合成する。
 * 依存順: Socket → Repository → AppSettings → Ai → Terminal → Worktree → Queue → Git → Files → EditorLauncher
 */
export function AppProviders({ children }: { children: ReactNode }) {
  return (
    <SocketProvider>
      <RepositoryProvider>
        <AppSettingsProvider>
          <AiProvider>
            <TerminalProvider>
              <WorktreeProvider>
                <QueueProvider>
                  <GitProvider>
                    <FilesProvider>
                      <EditorLauncherProvider>{children}</EditorLauncherProvider>
                    </FilesProvider>
                  </GitProvider>
                </QueueProvider>
              </WorktreeProvider>
            </TerminalProvider>
          </AiProvider>
        </AppSettingsProvider>
      </RepositoryProvider>
    </SocketProvider>
  );
}
