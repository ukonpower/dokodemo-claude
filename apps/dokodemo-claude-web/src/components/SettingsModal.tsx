import React, { useState, useEffect } from 'react';
import { X, Link2, Bell, Package } from 'lucide-react';
import type { Socket } from 'socket.io-client';
import type { AiProvider } from '../types';
import { useWebPush } from '../hooks/useWebPush';
import s from './SettingsModal.module.scss';

/**
 * フォントサイズプリセット
 */
export type FontSizePreset = 'small' | 'medium' | 'large';

/**
 * パーミッションモード
 */
export type PermissionMode = 'disabled' | 'auto' | 'dangerous';

/**
 * アプリケーション設定
 */
export interface AppSettings {
  fontSizePreset: FontSizePreset;
  permissionMode?: PermissionMode;
}

/**
 * デフォルト設定
 */
export const DEFAULT_SETTINGS: AppSettings = {
  fontSizePreset: 'medium',
  permissionMode: 'dangerous',
};

/**
 * フォントサイズプリセットに対応するピクセル値を取得
 */
export function getFontSizeFromPreset(
  preset: FontSizePreset,
  isLargeScreen: boolean
): number {
  const sizes = {
    small: { large: 9, small: 8 },
    medium: { large: 11, small: 9 },
    large: { large: 14, small: 12 },
  };
  return isLargeScreen ? sizes[preset].large : sizes[preset].small;
}

interface SettingsModalProps {
  isOpen: boolean;
  settings: AppSettings;
  onClose: () => void;
  onSettingsChange: (settings: AppSettings) => void;
  socket: Socket | null;
  currentRepo?: string;
}

interface HooksProviderState {
  configured: boolean;
  loading: boolean;
  message: { type: 'success' | 'error'; text: string } | null;
}

interface PluginState {
  installed: boolean;
  loading: boolean;
  message: { type: 'success' | 'error'; text: string } | null;
}

const SettingsModal: React.FC<SettingsModalProps> = ({
  isOpen,
  settings,
  onClose,
  onSettingsChange,
  socket,
  currentRepo,
}) => {
  const webPush = useWebPush(socket, isOpen, currentRepo);

  const [hooksPort] = useState<number>(
    parseInt(import.meta.env.DC_API_PORT || '8001', 10)
  );
  const [claudeHooks, setClaudeHooks] = useState<HooksProviderState>({
    configured: false, loading: false, message: null,
  });
  const [codexHooks, setCodexHooks] = useState<HooksProviderState>({
    configured: false, loading: false, message: null,
  });
  const [pluginState, setPluginState] = useState<PluginState>({
    installed: false, loading: false, message: null,
  });

  useEffect(() => {
    if (!isOpen || !socket) return;

    socket.emit('check-hooks-status', { port: hooksPort, provider: 'claude' });
    socket.emit('check-hooks-status', { port: hooksPort, provider: 'codex' });

    const handleHooksStatus = (data: { configured: boolean; port: number; provider: AiProvider }) => {
      if (data.port !== hooksPort) return;
      if (data.provider === 'claude') {
        setClaudeHooks(prev => ({ ...prev, configured: data.configured }));
      } else {
        setCodexHooks(prev => ({ ...prev, configured: data.configured }));
      }
    };

    const handleHooksUpdated = (data: {
      success: boolean;
      message: string;
      configured: boolean;
      provider: AiProvider;
    }) => {
      const update: HooksProviderState = {
        configured: data.configured,
        loading: false,
        message: { type: data.success ? 'success' : 'error', text: data.message },
      };
      if (data.provider === 'claude') {
        setClaudeHooks(update);
      } else {
        setCodexHooks(update);
      }
      setTimeout(() => {
        if (data.provider === 'claude') {
          setClaudeHooks(prev => ({ ...prev, message: null }));
        } else {
          setCodexHooks(prev => ({ ...prev, message: null }));
        }
      }, 3000);
    };

    socket.on('hooks-status', handleHooksStatus);
    socket.on('hooks-updated', handleHooksUpdated);

    return () => {
      socket.off('hooks-status', handleHooksStatus);
      socket.off('hooks-updated', handleHooksUpdated);
    };
  }, [isOpen, socket, hooksPort]);

  useEffect(() => {
    if (!isOpen || !socket) return;

    socket.emit('check-plugin-status');

    const handlePluginStatus = (data: { installed: boolean }) => {
      setPluginState((prev) => ({ ...prev, installed: data.installed }));
    };

    const handlePluginUpdated = (data: {
      success: boolean;
      message: string;
      installed: boolean;
    }) => {
      setPluginState({
        installed: data.installed,
        loading: false,
        message: { type: data.success ? 'success' : 'error', text: data.message },
      });
      setTimeout(() => {
        setPluginState((prev) => ({ ...prev, message: null }));
      }, 3000);
    };

    socket.on('plugin-status', handlePluginStatus);
    socket.on('plugin-updated', handlePluginUpdated);

    return () => {
      socket.off('plugin-status', handlePluginStatus);
      socket.off('plugin-updated', handlePluginUpdated);
    };
  }, [isOpen, socket]);

  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const handleFontSizeChange = (preset: FontSizePreset) => {
    onSettingsChange({ ...settings, fontSizePreset: preset });
  };

  const handleToggleHooks = (provider: AiProvider) => {
    if (!socket) return;
    const state = provider === 'claude' ? claudeHooks : codexHooks;
    const setState = provider === 'claude' ? setClaudeHooks : setCodexHooks;
    setState(prev => ({ ...prev, loading: true, message: null }));

    if (state.configured) {
      socket.emit('remove-dokodemo-hooks', { port: hooksPort, provider });
    } else {
      socket.emit('add-dokodemo-hooks', { port: hooksPort, provider });
    }
  };

  const handleTogglePlugin = () => {
    if (!socket) return;
    setPluginState((prev) => ({ ...prev, loading: true, message: null }));
    if (pluginState.installed) {
      socket.emit('uninstall-plugin');
    } else {
      socket.emit('install-plugin');
    }
  };

  const handleBackdropClick = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) {
      onClose();
    }
  };

  const renderHooksRow = (provider: AiProvider, label: string, hint: string, state: HooksProviderState) => (
    <div className={s.hooksRow} key={provider}>
      <div className={s.hooksRowHeader}>
        <span className={s.hooksLabel}>{label}</span>
        <div className={s.hooksStatusAndButton}>
          {state.configured ? (
            <span className={s.statusActive}>
              <span className={`${s.statusDot} ${s.statusDotGreen}`}></span>
              設定済み
            </span>
          ) : (
            <span className={s.statusInactive}>
              <span className={`${s.statusDot} ${s.statusDotGray}`}></span>
              未設定
            </span>
          )}
          <button
            onClick={() => handleToggleHooks(provider)}
            disabled={state.loading}
            className={
              state.loading
                ? (state.configured ? s.buttonDangerSmallDisabled : s.buttonPrimarySmallDisabled)
                : (state.configured ? s.buttonDangerSmall : s.buttonPrimarySmall)
            }
          >
            {state.loading ? '処理中...' : state.configured ? '削除' : '追加'}
          </button>
        </div>
      </div>
      {state.message && (
        <div className={state.message.type === 'success' ? s.messageSuccess : s.messageError}>
          {state.message.text}
        </div>
      )}
      <p className={s.portHint}>{hint}</p>
    </div>
  );

  return (
    <div
      className={s.overlay}
      onClick={handleBackdropClick}
    >
      <div className={s.modal}>
        {/* ヘッダー */}
        <div className={s.header}>
          <h2 className={s.headerTitle}>
            <svg
              className={s.headerIcon}
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"
              />
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
              />
            </svg>
            設定
          </h2>
          <button
            onClick={onClose}
            className={s.closeButton}
            title="閉じる"
          >
            <X className={s.closeIcon} />
          </button>
        </div>

        {/* コンテンツ */}
        <div className={s.content}>
          {/* フォントサイズ設定 */}
          <div>
            <label className={s.label}>
              フォントサイズ
            </label>
            <div className={s.fontSizeButtons}>
              {(['small', 'medium', 'large'] as FontSizePreset[]).map(
                (preset) => (
                  <button
                    key={preset}
                    onClick={() => handleFontSizeChange(preset)}
                    className={`${s.fontSizeButton} ${
                      settings.fontSizePreset === preset
                        ? s.fontSizeButtonActive
                        : s.fontSizeButtonInactive
                    }`}
                  >
                    {preset === 'small' && '小'}
                    {preset === 'medium' && '中'}
                    {preset === 'large' && '大'}
                  </button>
                )
              )}
            </div>
            <p className={s.hint}>
              ※ターミナルとCLI出力に適用されます
            </p>
          </div>

          {/* パーミッションモード設定 */}
          <div className={s.section}>
            <div className={s.sectionHeader}>
              <label className={s.sectionLabel}>
                パーミッションモード
              </label>
              <select
                value={settings.permissionMode ?? 'dangerous'}
                onChange={(e) =>
                  onSettingsChange({
                    ...settings,
                    permissionMode: e.target.value as PermissionMode,
                  })
                }
                className={s.select}
              >
                <option value="disabled">無効</option>
                <option value="auto">オートモード</option>
                <option value="dangerous">デンジャラスパーミッション</option>
              </select>
            </div>
            <p className={s.hint}>
              ※無効: 権限確認あり / オートモード: ファイル編集を自動承認 / デンジャラス: 全権限スキップ。変更は次回セッション作成時に反映されます。
            </p>
          </div>

          {/* Web Push通知設定 */}
          <div className={s.section}>
            <div className={s.sectionIconLabel}>
              <Bell className={s.sectionIcon} />
              <label className={s.sectionLabel}>
                Web Push通知
              </label>
            </div>

            {!webPush.isSupported ? (
              <p className={s.notSupportedText}>
                このブラウザはWeb Push通知に対応していません
              </p>
            ) : (
              <>
                <div className={s.statusRow}>
                  <span className={s.statusLabel}>状態:</span>
                  {webPush.isSubscribed ? (
                    <span className={s.statusActive}>
                      <span className={`${s.statusDot} ${s.statusDotGreen}`}></span>
                      有効
                    </span>
                  ) : webPush.permissionState === 'denied' ? (
                    <span className={s.statusDenied}>
                      <span className={`${s.statusDot} ${s.statusDotRed}`}></span>
                      ブロック中
                    </span>
                  ) : (
                    <span className={s.statusInactive}>
                      <span className={`${s.statusDot} ${s.statusDotGray}`}></span>
                      無効
                    </span>
                  )}
                </div>

                {webPush.permissionState === 'denied' && (
                  <p className={s.deniedWarning}>
                    通知がブロックされています。ブラウザの設定から通知を許可してください。
                  </p>
                )}

                {webPush.message && (
                  <div
                    className={
                      webPush.message.type === 'success'
                        ? s.messageSuccess
                        : s.messageError
                    }
                  >
                    {webPush.message.text}
                  </div>
                )}

                <div className={s.buttonRow}>
                  {!webPush.isSubscribed ? (
                    <button
                      onClick={webPush.subscribe}
                      disabled={webPush.loading || webPush.permissionState === 'denied'}
                      className={
                        webPush.loading || webPush.permissionState === 'denied'
                          ? s.buttonPrimaryDisabled
                          : s.buttonPrimary
                      }
                    >
                      {webPush.loading ? '処理中...' : '通知を有効にする'}
                    </button>
                  ) : (
                    <>
                      <button
                        onClick={webPush.unsubscribe}
                        disabled={webPush.loading}
                        className={
                          webPush.loading
                            ? s.buttonDangerDisabled
                            : s.buttonDanger
                        }
                      >
                        {webPush.loading ? '処理中...' : '無効にする'}
                      </button>
                      <button
                        onClick={webPush.testNotification}
                        disabled={webPush.testLoading}
                        className={
                          webPush.testLoading
                            ? s.buttonSecondaryDisabled
                            : s.buttonSecondary
                        }
                      >
                        {webPush.testLoading ? '送信中...' : 'テスト送信'}
                      </button>
                    </>
                  )}
                </div>

                <p className={s.hint}>
                  ※処理完了時や質問待ち状態になったときにブラウザ通知を送信します
                </p>
              </>
            )}
          </div>

          {/* AI Hooks設定 */}
          <div className={s.section}>
            <div className={s.sectionIconLabel}>
              <Link2 className={s.sectionIcon} />
              <label className={s.sectionLabel}>
                AI Hooks
              </label>
            </div>

            <p className={s.descriptionText}>
              プロンプトキューの自動処理とWeb Push通知を有効化します。
              処理完了時に次のキューアイテムを自動実行できます。
            </p>

            <div className={s.fieldGroup}>
              <label className={s.fieldLabel}>
                接続先ポート
              </label>
              <div className={s.portDisplay}>
                {hooksPort}
              </div>
            </div>

            {renderHooksRow('claude', 'Claude Code', '~/.claude/settings.json に hooks 設定を追加', claudeHooks)}
            {renderHooksRow('codex', 'Codex CLI', '~/.codex/hooks.json に hooks 設定を追加', codexHooks)}
          </div>

          {/* Claude Code プラグイン */}
          <div className={s.section}>
            <div className={s.sectionIconLabel}>
              <Package className={s.sectionIcon} />
              <label className={s.sectionLabel}>
                Claude Code プラグイン
              </label>
            </div>

            <p className={s.descriptionText}>
              dokodemo-claude 専用のスラッシュコマンド（preview / workflow / git など）を
              Claude Code に追加します。
            </p>

            <div className={s.hooksRow}>
              <div className={s.hooksRowHeader}>
                <span className={s.hooksLabel}>dokodemo-claude-tools</span>
                <div className={s.hooksStatusAndButton}>
                  {pluginState.installed ? (
                    <span className={s.statusActive}>
                      <span className={`${s.statusDot} ${s.statusDotGreen}`}></span>
                      インストール済
                    </span>
                  ) : (
                    <span className={s.statusInactive}>
                      <span className={`${s.statusDot} ${s.statusDotGray}`}></span>
                      未インストール
                    </span>
                  )}
                  <button
                    onClick={handleTogglePlugin}
                    disabled={pluginState.loading}
                    className={
                      pluginState.loading
                        ? (pluginState.installed ? s.buttonDangerSmallDisabled : s.buttonPrimarySmallDisabled)
                        : (pluginState.installed ? s.buttonDangerSmall : s.buttonPrimarySmall)
                    }
                  >
                    {pluginState.loading
                      ? '処理中...'
                      : pluginState.installed
                        ? 'アンインストール'
                        : 'インストール'}
                  </button>
                </div>
              </div>
              {pluginState.message && (
                <div
                  className={
                    pluginState.message.type === 'success'
                      ? s.messageSuccess
                      : s.messageError
                  }
                >
                  {pluginState.message.text}
                </div>
              )}
              <p className={s.portHint}>
                ※ Claude Code を再起動すると変更が反映されます
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default SettingsModal;
