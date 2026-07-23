import { useState, useEffect, useMemo } from 'react';

// フック
import { useSocketBootstrap } from '@/app/hooks/useSocketBootstrap';
import { useDocumentTitle } from '@/app/hooks/useDocumentTitle';
import { useAppHotkeys } from '@/app/hooks/useAppHotkeys';

// Provider（context）
import { useSocketContext } from '@/app/providers/SocketProvider';
import { useRepositoryContext } from '@/features/repo/providers/RepositoryProvider';
import { useAppSettingsContext } from '@/app/providers/AppSettingsProvider';
import { useAiContext } from '@/features/ai/providers/AiProvider';
import {
  useGitDiffContext,
  useGitGraphContext,
} from '@/features/git/providers/GitProvider';
import { useFileViewerContext } from '@/features/files/providers/FilesProvider';
import { useNavigationContext } from '@/app/providers/NavigationProvider';
import { openFileViewerTab } from '@/app/utils/open-views';

// ビュー
import { HomeView } from '@/views/HomeView';
import { ProjectView } from '@/views/ProjectView';
import { CodeBrowserView } from '@/views/CodeBrowserView';
import { DashboardView } from '@/views/DashboardView';
import { SettingsView } from '@/views/SettingsView';

import ProjectSwitcherModal from '@/features/repo/components/ProjectSwitcherModal';
import CommandPaletteModal from '@/shared/components/CommandPaletteModal';
import { buildCommands, type CommandPaletteCommand } from '@/app/commands';

/**
 * 各 context を消費してビュー分岐・全体オーバーレイ・アプリ横断の副作用を担う。
 * ビュー分岐の構造（settingsMode → !currentRepo → fileViewer.isActive →
 * dashboardMode → ProjectView）は App.tsx 時代のまま維持する。
 */
export function AppContent() {
  const { socket, isConnected } = useSocketContext();
  const { repository, switchRepositoryFromList } = useRepositoryContext();
  const appSettings = useAppSettingsContext();
  const { aiCli, aiInstanceTabsRef, primaryProvider } = useAiContext();
  const gitDiff = useGitDiffContext();
  const gitGraph = useGitGraphContext();
  const fileViewer = useFileViewerContext();
  const { dashboardMode, setDashboardModeAndPersist, settingsMode } =
    useNavigationContext();

  // プロジェクト切り替えポップアップ
  const [isProjectSwitcherOpen, setIsProjectSwitcherOpen] = useState(false);
  // コマンドパレット
  const [isCommandPaletteOpen, setIsCommandPaletteOpen] = useState(false);

  // Socket接続時の初期化処理・追加イベントリスナー
  useSocketBootstrap({
    socket,
    isConnected,
    currentRepo: repository.currentRepo,
    primaryProvider,
    aiTerminalSize: aiCli.aiTerminalSize,
    permissionMode: appSettings.appSettings.permissionMode,
    switchRepository: repository.switchRepository,
  });

  // ファイルビュワーが開かれたらGit差分サマリーを取得
  useEffect(() => {
    if (fileViewer.isActive) {
      gitDiff.refreshDiffSummary();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fileViewer.isActive]);

  // Ctrl+P / Cmd+P でプロジェクト切り替え、Ctrl+Shift+P / Cmd+Shift+P でコマンドパレット
  useAppHotkeys({
    onToggleProjectSwitcher: () => setIsProjectSwitcherOpen((open) => !open),
    onToggleCommandPalette: () => setIsCommandPaletteOpen((open) => !open),
    // Shift+←→: プロジェクトビューでAIインスタンスタブを切り替え
    // （右端でさらに右を押すと provider を選ぶ追加メニューを開く）
    onSwitchAiInstance: (direction) => {
      if (dashboardMode || gitGraph.isActive || fileViewer.isActive) return;
      const sorted = [...aiCli.aiInstances].sort((a, b) => a.order - b.order);
      if (sorted.length === 0) return;
      const currentIndex = sorted.findIndex(
        (i) => i.instanceId === aiCli.activeInstance?.instanceId
      );
      const targetIndex = currentIndex + direction;
      // 左端でさらに左：何もしない
      if (targetIndex < 0) return;
      // 右端でさらに右：provider（Claude / Codex）を選ぶ追加メニューを開く
      if (targetIndex >= sorted.length) {
        aiInstanceTabsRef.current?.openAddMenu();
        return;
      }
      aiCli.activateInstance(sorted[targetIndex].instanceId);
    },
    // Shift+↓: 選択中タブのメニュー（再起動 / 新規セッション / シャットダウン）を開く
    onOpenActiveTabMenu: () => {
      if (dashboardMode || gitGraph.isActive || fileViewer.isActive) return;
      const active = aiCli.activeInstance;
      if (active) aiInstanceTabsRef.current?.openTabMenu(active.instanceId);
    },
  });

  // ビュー別ページタイトル設定
  useDocumentTitle(repository, fileViewer, gitDiff);

  // どのビューでも共通でレンダリングするプロジェクト切り替えポップアップ
  const projectSwitcher = (
    <ProjectSwitcherModal
      isOpen={isProjectSwitcherOpen}
      onClose={() => setIsProjectSwitcherOpen(false)}
      repositories={repository.repositories}
      currentRepo={repository.currentRepo}
      repoProcessStatuses={repository.repoProcessStatuses}
      onSwitchRepository={switchRepositoryFromList}
    />
  );

  // コマンドパレットを開いたら push 先選択用に remote 一覧を取得しておく
  useEffect(() => {
    if (isCommandPaletteOpen && repository.currentRepo) {
      gitGraph.requestRemotes();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isCommandPaletteOpen, repository.currentRepo]);

  // コマンドパレット。リポジトリ選択中ならどのビューでも pull/push/fetch を出す。
  const paletteCommands = useMemo<CommandPaletteCommand[]>(
    () =>
      buildCommands({
        currentRepo: repository.currentRepo,
        gitGraph,
        dashboardMode,
        setDashboardMode: setDashboardModeAndPersist,
        openFileViewer: openFileViewerTab,
      }),
    [gitGraph, repository.currentRepo, dashboardMode, setDashboardModeAndPersist]
  );

  const commandPalette = (
    <CommandPaletteModal
      isOpen={isCommandPaletteOpen}
      onClose={() => setIsCommandPaletteOpen(false)}
      commands={paletteCommands}
    />
  );

  const overlays = (
    <>
      {projectSwitcher}
      {commandPalette}
    </>
  );

  // 設定ページ（リポジトリ未選択でも表示できるため最優先で分岐）
  if (settingsMode) {
    return (
      <>
      <SettingsView />
      {overlays}
      </>
    );
  }

  // リポジトリが選択されていない場合はホーム画面
  if (!repository.currentRepo) {
    return (
      <>
      <HomeView />
      {overlays}
      </>
    );
  }

  // 統合コード/git ブラウザ（変更ファイル / ツリー / グラフ を 1 画面に集約）
  if (fileViewer.isActive) {
    return (
      <>
      <CodeBrowserView />
      {overlays}
      </>
    );
  }

  // ダッシュボードビュー
  if (dashboardMode) {
    return (
      <>
      <DashboardView />
      {overlays}
      </>
    );
  }

  // メイン画面（プロジェクトビュー）
  return (
    <>
    <ProjectView />
    {overlays}
    </>
  );
}
