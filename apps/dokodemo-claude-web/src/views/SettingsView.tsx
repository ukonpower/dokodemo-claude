import React, { useState, useEffect, useRef } from 'react';
import { ArrowLeft, Monitor, Sparkles, Bell, Link2 } from 'lucide-react';
import type { AiProvider } from '@/types';
import type { FontSizePreset, PermissionMode } from '@/app/utils/app-settings';
import { useWebPush } from '@/app/hooks/useWebPush';
import { useSocketContext } from '@/app/providers/SocketProvider';
import { useAppSettingsContext } from '@/app/providers/AppSettingsProvider';
import { useRepositoryContext } from '@/features/repo/providers/RepositoryProvider';
import { useNavigationContext } from '@/app/providers/NavigationProvider';
import s from './SettingsView.module.scss';

type SectionId = 'appearance' | 'ai' | 'notification' | 'integration';

const SECTIONS: { id: SectionId; label: string; icon: React.FC<{ className?: string }> }[] = [
  { id: 'appearance', label: '表示', icon: Monitor },
  { id: 'ai', label: 'AIセッション', icon: Sparkles },
  { id: 'notification', label: '通知', icon: Bell },
  { id: 'integration', label: '連携', icon: Link2 },
];

const FONT_SIZE_OPTIONS: { preset: FontSizePreset; label: string; previewPx: number }[] = [
  { preset: 'small', label: '小', previewPx: 11 },
  { preset: 'medium', label: '中', previewPx: 13 },
  { preset: 'large', label: '大', previewPx: 16 },
];

const PERMISSION_OPTIONS: {
  value: PermissionMode | '';
  label: string;
  description: string;
}[] = [
  { value: '', label: '未設定', description: 'Claude CLI 既定の権限確認モードで起動します' },
  { value: 'disabled', label: '無効', description: '通常どおり権限確認を行います' },
  { value: 'auto', label: 'オートモード', description: 'ファイル編集を自動承認します' },
  { value: 'dangerous', label: 'デンジャラスパーミッション', description: 'すべての権限確認をスキップします' },
];

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

export function SettingsView() {
  const { socket } = useSocketContext();
  const {
    appSettings: settings,
    handleSettingsChange: onSettingsChange,
  } = useAppSettingsContext();
  const { repository } = useRepositoryContext();
  const { currentRepo } = repository;
  const { closeSettings: onBack } = useNavigationContext();

  const webPush = useWebPush(socket, true, currentRepo);

  const [claudeHooks, setClaudeHooks] = useState<HooksProviderState>({
    configured: false, loading: false, message: null,
  });
  const [codexHooks, setCodexHooks] = useState<HooksProviderState>({
    configured: false, loading: false, message: null,
  });
  const [pluginState, setPluginState] = useState<PluginState>({
    installed: false, loading: false, message: null,
  });
  // AIタブの指示内容要約の on/off（null = 未取得）
  const [summaryEnabled, setSummaryEnabled] = useState<boolean | null>(null);

  // カテゴリナビのスクロールスパイ
  const bodyRef = useRef<HTMLDivElement>(null);
  const [activeSection, setActiveSection] = useState<SectionId>('appearance');

  useEffect(() => {
    if (!socket) return;

    socket.emit('check-hooks-status', { provider: 'claude' });
    socket.emit('check-hooks-status', { provider: 'codex' });

    const handleHooksStatus = (data: { configured: boolean; provider: AiProvider }) => {
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
  }, [socket]);

  useEffect(() => {
    if (!socket) return;

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
  }, [socket]);

  useEffect(() => {
    if (!socket) return;

    socket.emit('get-ai-summary-settings');

    const handleSummarySettings = (data: { enabled: boolean }) => {
      setSummaryEnabled(data.enabled);
    };

    socket.on('ai-summary-settings', handleSummarySettings);

    return () => {
      socket.off('ai-summary-settings', handleSummarySettings);
    };
  }, [socket]);

  // スクロール位置から現在のカテゴリを判定してナビをハイライト
  useEffect(() => {
    const body = bodyRef.current;
    if (!body) return;

    const handleScroll = () => {
      const sections = Array.from(
        body.querySelectorAll<HTMLElement>('[data-section-id]')
      );
      const line = body.getBoundingClientRect().top + 120;
      let current: string | undefined = sections[0]?.dataset.sectionId;
      for (const section of sections) {
        if (section.getBoundingClientRect().top <= line) {
          current = section.dataset.sectionId;
        }
      }
      // 最終セクションが短いと判定線に届かないため、最下部到達時は最終セクションを優先
      if (body.scrollTop + body.clientHeight >= body.scrollHeight - 4) {
        current = sections[sections.length - 1]?.dataset.sectionId ?? current;
      }
      if (current) setActiveSection(current as SectionId);
    };

    body.addEventListener('scroll', handleScroll, { passive: true });
    handleScroll();
    return () => body.removeEventListener('scroll', handleScroll);
  }, []);

  const scrollToSection = (id: SectionId) => {
    const prefersReducedMotion = window.matchMedia(
      '(prefers-reduced-motion: reduce)'
    ).matches;
    document.getElementById(`settings-${id}`)?.scrollIntoView({
      behavior: prefersReducedMotion ? 'auto' : 'smooth',
      block: 'start',
    });
  };

  const handleToggleHooks = (provider: AiProvider) => {
    if (!socket) return;
    const state = provider === 'claude' ? claudeHooks : codexHooks;
    const setState = provider === 'claude' ? setClaudeHooks : setCodexHooks;
    setState(prev => ({ ...prev, loading: true, message: null }));

    if (state.configured) {
      socket.emit('remove-dokodemo-hooks', { provider });
    } else {
      socket.emit('add-dokodemo-hooks', { provider });
    }
  };

  const handleToggleSummary = () => {
    if (!socket || summaryEnabled === null) return;
    socket.emit('set-ai-summary-settings', { enabled: !summaryEnabled });
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

  const renderStatus = (
    active: boolean,
    activeText: string,
    inactiveText: string
  ) => (
    <span className={active ? s.statusActive : s.statusInactive}>
      <span className={`${s.statusDot} ${active ? s.statusDotGreen : s.statusDotGray}`} />
      {active ? activeText : inactiveText}
    </span>
  );

  const renderHooksRow = (
    provider: AiProvider,
    label: string,
    hint: string,
    state: HooksProviderState
  ) => (
    <div className={s.row} key={provider}>
      <div className={s.rowInfo}>
        <span className={s.rowLabel}>{label}</span>
        <p className={s.rowDesc}>{hint}</p>
        {state.message && (
          <p className={state.message.type === 'success' ? s.messageSuccess : s.messageError}>
            {state.message.text}
          </p>
        )}
      </div>
      <div className={s.rowControl}>
        {renderStatus(state.configured, '設定済み', '未設定')}
        <button
          onClick={() => handleToggleHooks(provider)}
          disabled={state.loading}
          className={state.configured ? s.buttonDanger : s.buttonPrimary}
        >
          {state.loading ? '処理中...' : state.configured ? '削除' : '追加'}
        </button>
      </div>
    </div>
  );

  return (
    <div className={s.root}>
      {/* ヘッダー */}
      <header className={s.header}>
        <button onClick={onBack} className="btn-icon" title="戻る" aria-label="戻る">
          <ArrowLeft className={s.backIcon} />
        </button>
        <h1 className={s.headerTitle}>設定</h1>
      </header>

      <div className={s.body} ref={bodyRef}>
        <div className={s.layout}>
          {/* カテゴリナビ */}
          <nav className={s.nav} aria-label="設定カテゴリ">
            {SECTIONS.map(({ id, label, icon: Icon }) => (
              <button
                key={id}
                onClick={() => scrollToSection(id)}
                className={`${s.navItem} ${activeSection === id ? s.navItemActive : ''}`}
              >
                <Icon className={s.navIcon} />
                {label}
              </button>
            ))}
          </nav>

          {/* 設定コンテンツ */}
          <div className={s.content}>
            {/* 表示 */}
            <section
              id="settings-appearance"
              data-section-id="appearance"
              className={s.section}
            >
              <h2 className={s.sectionTitle}>表示</h2>
              <div className={s.card}>
                <div className={s.row}>
                  <div className={s.rowInfo}>
                    <span className={s.rowLabel}>フォントサイズ</span>
                    <p className={s.rowDesc}>
                      ターミナルとCLI出力の文字サイズ
                    </p>
                  </div>
                  <div className={s.rowControl}>
                    <div className={s.segmented} role="group" aria-label="フォントサイズ">
                      {FONT_SIZE_OPTIONS.map(({ preset, label, previewPx }) => (
                        <button
                          key={preset}
                          onClick={() =>
                            onSettingsChange({ ...settings, fontSizePreset: preset })
                          }
                          aria-pressed={settings.fontSizePreset === preset}
                          className={`${s.segmentedButton} ${
                            settings.fontSizePreset === preset
                              ? s.segmentedButtonActive
                              : ''
                          }`}
                        >
                          <span
                            className={s.fontPreview}
                            style={{ fontSize: `${previewPx}px` }}
                            aria-hidden="true"
                          >
                            Aa
                          </span>
                          {label}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            </section>

            {/* AIセッション */}
            <section id="settings-ai" data-section-id="ai" className={s.section}>
              <h2 className={s.sectionTitle}>AIセッション</h2>
              <div className={s.card}>
                <div className={s.rowStack}>
                  <div className={s.rowInfo}>
                    <span className={s.rowLabel}>パーミッションモード</span>
                    <p className={s.rowDesc}>
                      Claude CLI セッション起動時の権限確認の扱い。変更は次回セッション作成時に反映されます
                    </p>
                  </div>
                  <div className={s.radioGroup} role="radiogroup" aria-label="パーミッションモード">
                    {PERMISSION_OPTIONS.map(({ value, label, description }) => {
                      const selected = (settings.permissionMode ?? '') === value;
                      return (
                        <button
                          key={value}
                          role="radio"
                          aria-checked={selected}
                          onClick={() =>
                            onSettingsChange({
                              ...settings,
                              permissionMode:
                                value === '' ? undefined : value,
                            })
                          }
                          className={`${s.radioItem} ${selected ? s.radioItemSelected : ''}`}
                        >
                          <span className={s.radioMark} aria-hidden="true" />
                          <span className={s.radioText}>
                            <span className={s.radioLabel}>{label}</span>
                            <span className={s.radioDesc}>{description}</span>
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div className={s.row}>
                  <div className={s.rowInfo}>
                    <span className={s.rowLabel}>AIタブの指示内容要約</span>
                    <p className={s.rowDesc}>
                      AIに送った指示から「そのセッションが何に取り組んでいるか」を生成してタブに表示します（haiku を使用）
                    </p>
                  </div>
                  <div className={s.rowControl}>
                    <button
                      role="switch"
                      aria-checked={summaryEnabled === true}
                      aria-label="AIタブの指示内容要約"
                      onClick={handleToggleSummary}
                      disabled={summaryEnabled === null}
                      className={`${s.switch} ${summaryEnabled ? s.switchOn : ''}`}
                    >
                      <span className={s.switchKnob} />
                    </button>
                  </div>
                </div>
              </div>
            </section>

            {/* 通知 */}
            <section
              id="settings-notification"
              data-section-id="notification"
              className={s.section}
            >
              <h2 className={s.sectionTitle}>通知</h2>
              <div className={s.card}>
                <div className={s.row}>
                  <div className={s.rowInfo}>
                    <span className={s.rowLabel}>Web Push通知</span>
                    <p className={s.rowDesc}>
                      処理完了時や質問待ち状態になったときにブラウザ通知を送信します
                    </p>
                    {webPush.permissionState === 'denied' && (
                      <p className={s.deniedWarning}>
                        通知がブロックされています。ブラウザの設定から通知を許可してください
                      </p>
                    )}
                    {webPush.message && (
                      <p
                        className={
                          webPush.message.type === 'success'
                            ? s.messageSuccess
                            : s.messageError
                        }
                      >
                        {webPush.message.text}
                      </p>
                    )}
                  </div>
                  <div className={s.rowControl}>
                    {!webPush.isSupported ? (
                      <span className={s.notSupportedText}>
                        このブラウザは非対応です
                      </span>
                    ) : (
                      <>
                        {webPush.isSubscribed
                          ? renderStatus(true, '有効', '')
                          : webPush.permissionState === 'denied'
                            ? (
                              <span className={s.statusDenied}>
                                <span className={`${s.statusDot} ${s.statusDotRed}`} />
                                ブロック中
                              </span>
                            )
                            : renderStatus(false, '', '無効')}
                        {!webPush.isSubscribed ? (
                          <button
                            onClick={webPush.subscribe}
                            disabled={
                              webPush.loading ||
                              webPush.permissionState === 'denied'
                            }
                            className={s.buttonPrimary}
                          >
                            {webPush.loading ? '処理中...' : '有効にする'}
                          </button>
                        ) : (
                          <>
                            <button
                              onClick={webPush.testNotification}
                              disabled={webPush.testLoading}
                              className={s.buttonSecondary}
                            >
                              {webPush.testLoading ? '送信中...' : 'テスト送信'}
                            </button>
                            <button
                              onClick={webPush.unsubscribe}
                              disabled={webPush.loading}
                              className={s.buttonDanger}
                            >
                              {webPush.loading ? '処理中...' : '無効にする'}
                            </button>
                          </>
                        )}
                      </>
                    )}
                  </div>
                </div>
              </div>
            </section>

            {/* 連携 */}
            <section
              id="settings-integration"
              data-section-id="integration"
              className={s.section}
            >
              <h2 className={s.sectionTitle}>連携</h2>
              <div className={s.card}>
                <div className={s.groupHeader}>
                  <span className={s.groupTitle}>AI Hooks</span>
                  <p className={s.groupDesc}>
                    プロンプトキューの自動処理とWeb Push通知を有効化します。処理完了時に次のキューアイテムを自動実行できます
                  </p>
                </div>
                {renderHooksRow('claude', 'Claude Code', '~/.claude/settings.json に hooks 設定を追加', claudeHooks)}
                {renderHooksRow('codex', 'Codex CLI', '~/.codex/hooks.json に hooks 設定を追加', codexHooks)}

                <div className={s.groupHeader}>
                  <span className={s.groupTitle}>Claude Code プラグイン</span>
                  <p className={s.groupDesc}>
                    dokodemo-claude 専用のスラッシュコマンド（preview / workflow / git など）を Claude Code に追加します。Claude Code を再起動すると変更が反映されます
                  </p>
                </div>
                <div className={s.row}>
                  <div className={s.rowInfo}>
                    <span className={s.rowLabel}>dokodemo-claude-tools</span>
                    {pluginState.message && (
                      <p
                        className={
                          pluginState.message.type === 'success'
                            ? s.messageSuccess
                            : s.messageError
                        }
                      >
                        {pluginState.message.text}
                      </p>
                    )}
                  </div>
                  <div className={s.rowControl}>
                    {renderStatus(pluginState.installed, 'インストール済', '未インストール')}
                    <button
                      onClick={handleTogglePlugin}
                      disabled={pluginState.loading}
                      className={pluginState.installed ? s.buttonDanger : s.buttonPrimary}
                    >
                      {pluginState.loading
                        ? '処理中...'
                        : pluginState.installed
                          ? 'アンインストール'
                          : 'インストール'}
                    </button>
                  </div>
                </div>
              </div>
            </section>
          </div>
        </div>
      </div>
    </div>
  );
}
