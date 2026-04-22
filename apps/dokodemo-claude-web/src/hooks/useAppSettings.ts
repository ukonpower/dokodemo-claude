import { useState, useEffect, useCallback, useMemo } from 'react';
import {
  AppSettings,
  DEFAULT_SETTINGS,
  getFontSizeFromPreset,
} from '../components/SettingsModal';

/**
 * コマンド入力設定の型
 */
export interface CommandSendSettings {
  addToQueue: boolean;
  sendClear: boolean;
  sendCommit: boolean;
  model?: string;
  workflowSkill?: string;
  autoTarget?: 'plan' | 'implement';
  autoReview?: boolean;
  autoClear?: boolean;
}

/**
 * useAppSettings フックの戻り値
 */
export interface UseAppSettingsReturn {
  // アプリケーション設定
  appSettings: AppSettings;
  setAppSettings: (settings: AppSettings) => void;
  showSettingsModal: boolean;
  setShowSettingsModal: (show: boolean) => void;
  handleSettingsChange: (newSettings: AppSettings) => void;

  // フォントサイズ
  terminalFontSize: number;
  isLargeScreen: boolean;

  // コマンド入力設定（リポジトリ単位）
  sendSettings: CommandSendSettings;
  setSendSettings: React.Dispatch<React.SetStateAction<CommandSendSettings>>;
  loadSettingsForRepo: (repoPath: string) => CommandSendSettings;
}

/**
 * リポジトリ単位の設定キーを生成
 */
function getRepoSettingsKey(repoPath: string): string {
  if (!repoPath) return 'command-send-settings-default';
  const encoded = encodeURIComponent(repoPath);
  return `command-send-settings-${encoded}`;
}

/**
 * リポジトリ用の設定を読み込む
 */
function loadSettingsForRepoInternal(repoPath: string): CommandSendSettings {
  const key = getRepoSettingsKey(repoPath);
  const saved = localStorage.getItem(key);
  if (saved) {
    try {
      return JSON.parse(saved);
    } catch {
      // パース失敗時はデフォルト値
    }
  }
  return {
    addToQueue: false,
    sendClear: false,
    sendCommit: false,
    model: 'Sonnet',
  };
}

/**
 * アプリケーション設定を管理するカスタムフック
 * LocalStorage連携、フォントサイズ計算などを行う
 */
export function useAppSettings(currentRepo: string): UseAppSettingsReturn {
  // アプリケーション設定（フォントサイズ等）
  const [appSettings, setAppSettings] = useState<AppSettings>(() => {
    // localStorageから設定を復元
    const saved = localStorage.getItem('app-settings');
    if (saved) {
      try {
        return { ...DEFAULT_SETTINGS, ...JSON.parse(saved) };
      } catch {
        return DEFAULT_SETTINGS;
      }
    }
    return DEFAULT_SETTINGS;
  });

  const [showSettingsModal, setShowSettingsModal] = useState(false);

  // 設定変更時にlocalStorageに保存
  const handleSettingsChange = useCallback((newSettings: AppSettings) => {
    setAppSettings(newSettings);
    localStorage.setItem('app-settings', JSON.stringify(newSettings));
  }, []);

  // フォントサイズを計算（画面サイズに応じて変動）
  const [isLargeScreen, setIsLargeScreen] = useState(
    window.innerWidth >= 1024
  );

  useEffect(() => {
    const handleResize = () => {
      setIsLargeScreen(window.innerWidth >= 1024);
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  const terminalFontSize = useMemo(
    () => getFontSizeFromPreset(appSettings.fontSizePreset, isLargeScreen),
    [appSettings.fontSizePreset, isLargeScreen]
  );

  // コマンド入力設定の状態（リポジトリ単位でlocalStorageから初期化）
  const [sendSettings, setSendSettings] = useState<CommandSendSettings>(() => {
    // 初期化時はURLパラメータからリポジトリを取得して読み込む
    const urlParams = new URLSearchParams(window.location.search);
    const repoFromUrl = urlParams.get('repo') || '';
    return loadSettingsForRepoInternal(repoFromUrl);
  });

  // リポジトリ用の設定を読み込むコールバック
  const loadSettingsForRepo = useCallback(
    (repoPath: string): CommandSendSettings => {
      return loadSettingsForRepoInternal(repoPath);
    },
    []
  );

  // currentRepoが変わった時に設定を読み込む
  useEffect(() => {
    if (currentRepo) {
      const settings = loadSettingsForRepoInternal(currentRepo);
      setSendSettings(settings);
    }
  }, [currentRepo]);

  // sendSettingsの変更をリポジトリ単位でlocalStorageに保存
  useEffect(() => {
    const key = getRepoSettingsKey(currentRepo);
    localStorage.setItem(key, JSON.stringify(sendSettings));
  }, [sendSettings, currentRepo]);

  return {
    appSettings,
    setAppSettings,
    showSettingsModal,
    setShowSettingsModal,
    handleSettingsChange,
    terminalFontSize,
    isLargeScreen,
    sendSettings,
    setSendSettings,
    loadSettingsForRepo,
  };
}
