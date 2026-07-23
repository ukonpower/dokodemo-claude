import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import type { AiInstanceTabsHandle } from './components/AiInstanceTabs';
import type {
  AiOutputLine,
  ServerToClientEvents,
  ClientToServerEvents,
} from './types';
import { repositoryIdMap } from './utils/repository-id-map';

// フック
import {
  useSocket,
  useAppSettings,
  useRepository,
  useAiCli,
  useTerminal,
  useBranchWorktree,
  usePromptQueue,
  useGitDiff,
  useGitGraph,
  useFileManager,
  useEditorLauncher,
  useFileViewer,
  useCustomAiButtons,
  useNpmScripts,
  useSocketBootstrap,
  useRepositorySwitchFromList,
  useViewRouting,
  useDocumentTitle,
  useAppHotkeys,
} from './hooks';

// ビュー
import {
  HomeView,
  ProjectView,
  CodeBrowserView,
  DashboardView,
  SettingsView,
} from './views';

import ProjectSwitcherModal from './components/ProjectSwitcherModal';
import CommandPaletteModal from './components/CommandPaletteModal';
import { buildCommands, type CommandPaletteCommand } from './commands';
import { Socket } from 'socket.io-client';

function App() {
  // 基盤フック
  const { socket, isConnected, connectionAttempts, isReconnecting } =
    useSocket();

  // URLからリポジトリを取得
  const urlParams = new URLSearchParams(window.location.search);
  const initialRepo = urlParams.get('repo') || '';
  const initialViewFromUrl = urlParams.get('view');

  // リポジトリ管理
  const repository = useRepository(socket, initialRepo);

  // アプリケーション設定
  const appSettings = useAppSettings(repository.currentRepo);

  // AI CLI出力受信時のコールバック
  const onAiOutputReceived = useCallback(() => {
    repository.endLoadingOnOutput();
  }, [repository]);

  // AI CLI管理
  const aiCli = useAiCli(socket, repository.currentRepo, onAiOutputReceived);
  const { aiTerminalSize, primaryInstance, activeInstance } = aiCli;

  // AIインスタンスタブの追加メニューを Shift+→（右端）から開くための ref
  const aiInstanceTabsRef = useRef<AiInstanceTabsHandle>(null);
  const primaryProvider = primaryInstance?.provider;

  // ターミナル管理
  const terminal = useTerminal(socket, repository.currentRepo);

  // ブランチエラー時のコールバック
  const onBranchError = useCallback(
    (errorMessage: AiOutputLine) => {
      console.error('Branch error:', errorMessage.content);
    },
    []
  );

  // ブランチ・ワークツリー管理（プライマリの provider を渡す）
  const branchWorktree = useBranchWorktree(
    socket,
    repository.currentRepo,
    primaryProvider ?? 'claude',
    repository.switchRepository,
    onBranchError
  );

  // プロンプトキュー管理（プライマリの provider に同期）
  const promptQueue = usePromptQueue(
    socket,
    repository.currentRepo,
    primaryProvider
  );

  // Git差分管理
  const gitDiff = useGitDiff(socket, repository.currentRepo);

  // Git Graph（コミットグラフ）管理
  const gitGraph = useGitGraph(socket, repository.currentRepo);

  // ファイル管理
  const fileManager = useFileManager(socket, repository.currentRepo);

  // カスタム送信ボタン（global / repository スコープ両方）
  const customAiButtons = useCustomAiButtons(socket, repository.currentRepo);

  // ファイルビュワー管理
  const fileViewer = useFileViewer(socket, repository.currentRepo);

  // エディタ起動管理
  const editorLauncher = useEditorLauncher(socket, repository.currentRepo);

  // プロジェクト切り替えポップアップ
  const [isProjectSwitcherOpen, setIsProjectSwitcherOpen] = useState(false);
  // コマンドパレット
  const [isCommandPaletteOpen, setIsCommandPaletteOpen] = useState(false);

  // active instance が決まったら履歴を取得
  useEffect(() => {
    if (!socket || !activeInstance) return;
    socket.emit('get-ai-history', { instanceId: activeInstance.instanceId });
  }, [socket, activeInstance]);

  // プライマリの provider が決まったらキューを取得
  useEffect(() => {
    if (!socket || !repository.currentRepo || !primaryProvider) return;
    const rid = repositoryIdMap.getRid(repository.currentRepo);
    if (!rid) return;
    socket.emit('get-prompt-queue', { rid, provider: primaryProvider });
  }, [socket, repository.currentRepo, primaryProvider]);

  // npmスクリプト関連
  const npm = useNpmScripts(socket, repository.currentRepo, terminal.activeTerminalId);

  // Socket接続時の初期化処理・追加イベントリスナー
  useSocketBootstrap({
    socket,
    isConnected,
    currentRepo: repository.currentRepo,
    primaryProvider,
    aiTerminalSize,
    permissionMode: appSettings.appSettings.permissionMode,
    switchRepository: repository.switchRepository,
  });

  // ビュールーティング（dashboardMode / settingsMode の管理 + popstate 対応）
  const {
    dashboardMode,
    setDashboardModeAndPersist,
    settingsMode,
    openSettings,
    closeSettings,
  } = useViewRouting({
    initialRepo,
    initialViewFromUrl,
    repository,
    gitDiff,
    fileViewer,
    gitGraph,
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

  // リポジトリ一覧（HomeView / RepositorySwitcher）からのクリック時の切り替え
  const switchRepositoryFromList = useRepositorySwitchFromList(
    socket,
    repository.switchRepository
  );

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
        openFileViewer: () => {
          const url = new URL(window.location.href);
          url.searchParams.set('view', 'files');
          window.open(url.toString(), '_blank');
        },
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
      <SettingsView
        socket={socket as Socket<ServerToClientEvents, ClientToServerEvents>}
        settings={appSettings.appSettings}
        onSettingsChange={appSettings.handleSettingsChange}
        currentRepo={repository.currentRepo}
        onBack={closeSettings}
      />
      {overlays}
      </>
    );
  }

  // リポジトリが選択されていない場合はホーム画面
  if (!repository.currentRepo) {
    return (
      <>
      <HomeView
        isConnected={isConnected}
        connectionAttempts={connectionAttempts}
        isReconnecting={isReconnecting}
        repositories={repository.repositories}
        currentRepo={repository.currentRepo}
        repoProcessStatuses={repository.repoProcessStatuses}
        onCloneRepository={repository.cloneRepository}
        onCreateRepository={repository.createRepository}
        onStopProcesses={repository.showStopProcessConfirmDialog}
        onSwitchRepository={switchRepositoryFromList}
        onPullSelf={repository.pullSelf}
        selfUpdateAvailable={repository.selfUpdateAvailable}
        onOpenSettings={openSettings}
        isSwitchingRepo={repository.isSwitchingRepo}
        showStopProcessConfirm={repository.showStopProcessConfirm}
        stoppingProcesses={repository.stoppingProcesses}
        stopProcessTargetRid={repository.stopProcessTargetRid}
        onConfirmStopProcesses={repository.confirmStopProcesses}
        onCancelStopProcesses={repository.cancelStopProcesses}
      />
      {overlays}
      </>
    );
  }

  // 統合コード/git ブラウザ（変更ファイル / ツリー / グラフ を 1 画面に集約）
  if (fileViewer.isActive) {
    const repoInfo = repository.repositories.find(
      (r) => r.path === repository.currentRepo
    );
    const repoName = repoInfo?.name || '';
    const graphRepoName =
      repoInfo?.isWorktree &&
      repoInfo?.parentRepoName &&
      repoInfo?.worktreeBranch
        ? `${repoInfo.parentRepoName} / ${repoInfo.worktreeBranch}`
        : repoInfo?.name ||
          repository.currentRepo.split('/').filter(Boolean).pop() ||
          '';
    return (
      <>
      <CodeBrowserView
        fileViewer={fileViewer}
        gitDiff={gitDiff}
        gitGraph={gitGraph}
        repoName={repoName}
        graphRepoName={graphRepoName}
        currentRepo={repository.currentRepo}
        rid={repositoryIdMap.getRid(repository.currentRepo) || ''}
      />
      {overlays}
      </>
    );
  }

  // ダッシュボードビュー
  if (dashboardMode) {
    return (
      <>
      <DashboardView
        socket={socket as Socket<ServerToClientEvents, ClientToServerEvents>}
        isConnected={isConnected}
        isReconnecting={isReconnecting}
        connectionAttempts={connectionAttempts}
        primaryInstance={aiCli.primaryInstance}
        worktrees={branchWorktree.worktrees}
        parentRepoPath={branchWorktree.parentRepoPath}
        currentRepo={repository.currentRepo}
        repositories={repository.repositories}
        repoProcessStatuses={repository.repoProcessStatuses}
        onOpenSettings={openSettings}
        onPasteFile={fileManager.uploadFile}
        isUploadingFile={fileManager.isUploadingFile}
        uploadProgress={fileManager.uploadProgress}
        onCancelUpload={fileManager.cancelUpload}
        onSwitchToProjectView={() => setDashboardModeAndPersist(false)}
        onOpenWorktree={(path) => {
          setDashboardModeAndPersist(false);
          switchRepositoryFromList(path);
        }}
        onSwitchRepository={switchRepositoryFromList}
        onOpenFileViewer={() => {
          const url = new URL(window.location.href);
          url.searchParams.set('view', 'files');
          window.open(url.toString(), '_blank');
        }}
        onOpenGraphView={gitGraph.openGraphView}
        startingCodeServer={editorLauncher.startingCodeServer}
        isLocalhost={editorLauncher.isLocalhost}
        availableEditors={editorLauncher.availableEditors}
        showEditorMenu={editorLauncher.showEditorMenu}
        setShowEditorMenu={editorLauncher.setShowEditorMenu}
        editorMenuRef={editorLauncher.editorMenuRef}
        onOpenInEditor={editorLauncher.openInEditor}
        remoteUrl={editorLauncher.remoteUrl}
      />
      {overlays}
      </>
    );
  }

  // メイン画面（プロジェクトビュー）
  return (
    <>
    <ProjectView
      isConnected={isConnected}
      connectionAttempts={connectionAttempts}
      isReconnecting={isReconnecting}
      repositories={repository.repositories}
      currentRepo={repository.currentRepo}
      repoProcessStatuses={repository.repoProcessStatuses}
      aiInstanceTabsRef={aiInstanceTabsRef}
      aiInstances={aiCli.aiInstances}
      aiActivitySummaries={aiCli.aiActivitySummaries}
      activeInstance={aiCli.activeInstance}
      primaryInstance={aiCli.primaryInstance}
      currentAiMessages={aiCli.currentAiMessages}
      isLoadingRepoData={repository.isLoadingRepoData}
      terminalFontSize={appSettings.terminalFontSize}
      // タブ操作
      onActivateInstance={aiCli.activateInstance}
      onCreateInstance={aiCli.createInstance}
      onCloseInstance={aiCli.closeInstance}
      // AI CLI関連
      onSendCommand={aiCli.sendCommand}
      onSendArrowKey={aiCli.sendArrowKey}
      onSendAltT={aiCli.sendAltT}
      onSendInterrupt={aiCli.sendInterrupt}
      onSendEscape={aiCli.sendEscape}
      onSendSpace={aiCli.sendSpace}
      onSendClear={aiCli.sendClear}
      onSendCommit={aiCli.sendCommit}
      onSendPreview={aiCli.sendPreview}
      onSendResume={aiCli.sendResume}
      onSendUsage={aiCli.sendUsage}
      onSendMode={aiCli.sendMode}
      onChangeModel={aiCli.changeModel}
      onChangePrimaryProvider={aiCli.changePrimaryProvider}
      onRestartCli={aiCli.restartCli}
      onKeyInput={aiCli.handleKeyInput}
      onResize={aiCli.handleResize}
      // ターミナル関連
      terminals={terminal.terminals}
      activeTerminalId={terminal.activeTerminalId}
      terminalMessages={terminal.terminalMessages}
      terminalHistories={terminal.terminalHistories}
      isTerminalsLoaded={terminal.isTerminalsLoaded}
      shortcuts={terminal.shortcuts}
      devServerPortsByRepo={terminal.devServerPortsByRepo}
      onCreateTerminal={terminal.createTerminal}
      onCloseTerminal={terminal.closeTerminal}
      onTerminalInput={terminal.sendInput}
      onTerminalSignal={terminal.sendSignal}
      onTerminalResize={terminal.resize}
      onActiveTerminalChange={terminal.setActiveTerminalId}
      onCreateShortcut={terminal.createShortcut}
      onDeleteShortcut={terminal.deleteShortcut}
      onExecuteShortcut={terminal.executeShortcut}
      // ブランチ・ワークツリー関連
      branches={branchWorktree.branches}
      currentBranch={branchWorktree.currentBranch}
      worktrees={branchWorktree.worktrees}
      parentRepoPath={branchWorktree.parentRepoPath}
      mergeError={branchWorktree.mergeError}
      worktreeCreateError={branchWorktree.worktreeCreateError}
      worktreeCreateSuccessNonce={branchWorktree.worktreeCreateSuccessNonce}
      onClearWorktreeCreateError={branchWorktree.clearWorktreeCreateError}
      isDeletingWorktree={branchWorktree.isDeletingWorktree}
      deletingWorktreePath={branchWorktree.deletingWorktreePath}
      onSwitchBranch={branchWorktree.switchBranch}
      onDeleteBranch={branchWorktree.deleteBranch}
      onCreateBranch={branchWorktree.createBranch}
      onRefreshBranches={branchWorktree.refreshBranches}
      onPullBranch={branchWorktree.pullBranch}
      pullState={branchWorktree.pullState}
      onClearPullState={branchWorktree.clearPullState}
      syncStatus={branchWorktree.syncStatus}
      pushState={branchWorktree.pushState}
      onPushBranch={branchWorktree.pushBranch}
      onClearPushState={branchWorktree.clearPushState}
      onCreateWorktree={branchWorktree.createWorktree}
      onReorderWorktrees={branchWorktree.reorderWorktrees}
      worktreeSyncConfig={branchWorktree.worktreeSyncConfig}
      onRequestWorktreeSyncConfig={branchWorktree.requestWorktreeSyncConfig}
      onSaveWorktreeSyncConfig={branchWorktree.saveWorktreeSyncConfig}
      worktreeSyncCandidates={branchWorktree.worktreeSyncCandidates}
      onRequestWorktreeSyncCandidates={
        branchWorktree.requestWorktreeSyncCandidates
      }
      onDeleteWorktree={branchWorktree.deleteWorktree}
      onMergeWorktree={branchWorktree.mergeWorktree}
      onSaveWorktreeMemo={branchWorktree.saveWorktreeMemo}
      onClearMergeError={() => branchWorktree.setMergeError(null)}
      // プロンプトキュー関連
      promptQueue={promptQueue.promptQueue}
      isQueueProcessing={promptQueue.isQueueProcessing}
      isQueuePaused={promptQueue.isQueuePaused}
      currentQueueItemId={promptQueue.currentItemId}
      onAddToQueue={promptQueue.addToQueue}
      onRemoveFromQueue={promptQueue.removeFromQueue}
      onUpdateQueue={promptQueue.updateQueue}
      onPauseQueue={promptQueue.pauseQueue}
      onResumeQueue={promptQueue.resumeQueue}
      onResetQueue={promptQueue.resetQueue}
      onCancelCurrentItem={promptQueue.cancelCurrentItem}
      onForceSend={promptQueue.forceSend}
      onReorderQueue={promptQueue.reorderQueue}
      onRequeueItem={promptQueue.requeueItem}
      onStopLoop={promptQueue.stopLoop}
      onApproveLoop={promptQueue.approveLoopContinuation}
      loopEndInfo={promptQueue.loopEndInfo}
      onDismissLoopEnd={promptQueue.dismissLoopEnd}
      // ファイル管理関連
      files={fileManager.files}
      isUploadingFile={fileManager.isUploadingFile}
      uploadProgress={fileManager.uploadProgress}
      onCancelUpload={fileManager.cancelUpload}
      onRefreshFiles={fileManager.refreshFiles}
      onDeleteFile={fileManager.deleteFile}
      onPasteFile={fileManager.uploadFile}
      // Git差分関連
      diffSummary={gitDiff.diffSummary}
      diffSummaryLoading={gitDiff.diffSummaryLoading}
      diffSummaryError={gitDiff.diffSummaryError}
      onRefreshDiffSummary={gitDiff.refreshDiffSummary}
      onDiffFileClick={(filename) => {
        // 統合コード/git ブラウザを変更モードで別タブに開き、該当ファイルの差分を右ペインに表示
        const url = new URL(window.location.href);
        url.searchParams.set('view', 'files');
        url.searchParams.set('mode', 'changes');
        url.searchParams.set('file', filename);
        url.searchParams.delete('fullscreen');
        window.open(url.toString(), '_blank');
      }}
      // npmスクリプト関連
      npmScripts={npm.npmScripts}
      onExecuteNpmScript={npm.executeNpmScript}
      onRefreshNpmScripts={npm.refreshNpmScripts}
      // エディタ関連
      availableEditors={editorLauncher.availableEditors}
      showEditorMenu={editorLauncher.showEditorMenu}
      startingCodeServer={editorLauncher.startingCodeServer}
      showPopupBlockedModal={editorLauncher.showPopupBlockedModal}
      blockedCodeServerUrl={editorLauncher.blockedCodeServerUrl}
      remoteUrl={editorLauncher.remoteUrl}
      isLocalhost={editorLauncher.isLocalhost}
      editorMenuRef={editorLauncher.editorMenuRef}
      onOpenInEditor={editorLauncher.openInEditor}
      setShowEditorMenu={editorLauncher.setShowEditorMenu}
      setShowPopupBlockedModal={editorLauncher.setShowPopupBlockedModal}
      onOpenBlockedUrl={editorLauncher.openBlockedUrl}
      // 設定関連
      onOpenSettings={openSettings}
      sendSettings={appSettings.sendSettings}
      onSendSettingsChange={appSettings.setSendSettings}
      // リポジトリ操作
      showDeleteConfirm={repository.showDeleteConfirm}
      setShowDeleteConfirm={repository.setShowDeleteConfirm}
      onDeleteRepository={repository.deleteRepository}
      // プロセス停止
      showStopProcessConfirm={repository.showStopProcessConfirm}
      stoppingProcesses={repository.stoppingProcesses}
      stopProcessTargetRid={repository.stopProcessTargetRid}
      onConfirmStopProcesses={repository.confirmStopProcesses}
      onCancelStopProcesses={repository.cancelStopProcesses}
      // カスタム送信ボタン関連
      customAiButtons={customAiButtons.buttons}
      onCreateCustomAiButton={customAiButtons.createButton}
      onUpdateCustomAiButton={customAiButtons.updateButton}
      onDeleteCustomAiButton={customAiButtons.deleteButton}
      // ファイルビュワー
      onOpenFileViewer={() => {
        const url = new URL(window.location.href);
        url.searchParams.set('view', 'files');
        window.open(url.toString(), '_blank');
      }}
      onOpenWorkflowFile={(path: string) => {
        const url = new URL(window.location.href);
        url.searchParams.set('view', 'files');
        url.searchParams.set('file', path);
        url.searchParams.set('fullscreen', '1');
        window.open(url.toString(), '_blank');
      }}
      // リポジトリ切り替え（HomeView / RepositorySwitcher / WorktreeTabs 共通）。
      // WorktreeTabs はクリック時に setLastWorktreeForParent を先に呼ぶため、
      // ラッパー経由でも結果が変わらないことを担保している。
      onSwitchRepository={switchRepositoryFromList}
      // ダッシュボード切替
      onOpenDashboard={() => setDashboardModeAndPersist(true)}
      // Git Graph 表示
      onOpenGraphView={gitGraph.openGraphView}
    />
    {overlays}
    </>
  );
}

export default App;
