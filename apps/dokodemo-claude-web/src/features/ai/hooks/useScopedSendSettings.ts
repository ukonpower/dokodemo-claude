import { useEffect, useState } from 'react';
import type { CommandSendSettings } from '@/app/hooks/useAppSettings';

const DEFAULT_SEND_SETTINGS: CommandSendSettings = {
  addToQueue: false,
  sendClear: false,
  sendCommit: false,
};

function getStorageKey(scopeKey: string): string {
  return `dashboard-send-settings-${encodeURIComponent(scopeKey)}`;
}

function loadInitial(scopeKey: string): CommandSendSettings {
  try {
    const saved = localStorage.getItem(getStorageKey(scopeKey));
    if (saved) {
      return { ...DEFAULT_SEND_SETTINGS, ...JSON.parse(saved) };
    }
  } catch {
    /* noop */
  }
  return DEFAULT_SEND_SETTINGS;
}

/**
 * ダッシュボード内の各入力欄（各 worktree カード / 一斉送信バー）が
 * 互いに干渉しないように、scopeKey 単位で独立した CommandSendSettings を
 * localStorage に紐づけて保持するためのフック。
 */
export function useScopedSendSettings(
  scopeKey: string
): [
  CommandSendSettings,
  React.Dispatch<React.SetStateAction<CommandSendSettings>>,
] {
  const [settings, setSettings] = useState<CommandSendSettings>(() =>
    loadInitial(scopeKey)
  );

  // scopeKey が変わったら、その scope の値で再読み込み
  useEffect(() => {
    setSettings(loadInitial(scopeKey));
  }, [scopeKey]);

  useEffect(() => {
    try {
      localStorage.setItem(getStorageKey(scopeKey), JSON.stringify(settings));
    } catch {
      /* noop */
    }
  }, [scopeKey, settings]);

  return [settings, setSettings];
}
