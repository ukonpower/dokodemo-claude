import { createContext, useContext, type ReactNode } from 'react';
import {
  useAppSettings,
  type UseAppSettingsReturn,
} from '@/app/hooks/useAppSettings';
import { useRepositoryContext } from '@/features/repo/providers/RepositoryProvider';

const AppSettingsContext = createContext<UseAppSettingsReturn | null>(null);

/**
 * アプリケーション設定（useAppSettings）を提供する Provider。
 */
export function AppSettingsProvider({ children }: { children: ReactNode }) {
  const { repository } = useRepositoryContext();

  // アプリケーション設定
  const appSettings = useAppSettings(repository.currentRepo);

  return (
    <AppSettingsContext.Provider value={appSettings}>
      {children}
    </AppSettingsContext.Provider>
  );
}

export function useAppSettingsContext(): UseAppSettingsReturn {
  const ctx = useContext(AppSettingsContext);
  if (!ctx) {
    throw new Error(
      'useAppSettingsContext must be used within AppSettingsProvider'
    );
  }
  return ctx;
}
