import { useState, useEffect, useCallback, useRef } from 'react';
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
  useFileManager,
  useEditorLauncher,
  useFileViewer,
  useCustomAiButtons,
} from './hooks';

// ビュー
import { HomeView, ProjectView, FileViewerView } from './views';

// 差分詳細ビュー
import DiffViewer from './components/DiffViewer';
import RepositorySwitcher from './components/RepositorySwitcher';
import { Socket } from 'socket.io-client';

import s from './App.module.scss';

function App() {
  // 基盤フック
  const { socket, isConnected, connectionAttempts, isReconnecting } =
    useSocket();

  // URLからリポジトリを取得
  const urlParams = new URLSearchParams(window.location.search);
  const initialRepo = urlParams.get('repo') || '';

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
  const {
    currentProvider,
    aiTerminalSize,
    syncProvider,
  } = aiCli;

  // ターミナル管理
  const terminal = useTerminal(socket, repository.currentRepo);

  // ブランチエラー時のコールバック
  const onBranchError = useCallback(
    (errorMessage: AiOutputLine) => {
      // エラーメッセージをAI CLIに追加するロジックは
      // 既存のロジックに合わせてダミー実装
      console.error('Branch error:', errorMessage.content);
    },
    []
  );

  // ブランチ・ワークツリー管理
  const branchWorktree = useBranchWorktree(
    socket,
    repository.currentRepo,
    currentProvider,
    repository.switchRepository,
    onBranchError
  );

  // プロンプトキュー管理
  const promptQueue = usePromptQueue(
    socket,
    repository.currentRepo,
    currentProvider
  );

  // Git差分管理
  const gitDiff = useGitDiff(socket, repository.currentRepo);

  // ファイル管理
  const fileManager = useFileManager(socket, repository.currentRepo);

  // カスタム送信ボタン（global / repository スコープ両方）
  const customAiButtons = useCustomAiButtons(socket, repository.currentRepo);

  // ファイルビュワー管理
  const fileViewer = useFileViewer(socket, repository.currentRepo);

  // エディタ起動管理
  const editorLauncher = useEditorLauncher(socket, repository.currentRepo);

  // npmスクリプト関連
  const [npmScripts, setNpmScripts] = useState<Record<string, string>>({});

  const currentRepoStatus = repository.repoProcessStatuses.find(
    (status) => status.repositoryPath === repository.currentRepo
  );

  // currentRepoの参照
  const currentRepoRef = useRef(repository.currentRepo);
  const currentProviderRef = useRef(aiCli.currentProvider);

  useEffect(() => {
    currentRepoRef.current = repository.currentRepo;
  }, [repository.currentRepo]);
  useEffect(() => {
    currentProviderRef.current = currentProvider;
  }, [currentProvider]);

  useEffect(() => {
    if (currentRepoStatus?.selectedProvider) {
      syncProvider(currentRepoStatus.selectedProvider);
    }
  }, [currentRepoStatus?.selectedProvider, syncProvider]);

  useEffect(() => {
    if (!socket || !repository.currentRepo) return;

    const rid = repositoryIdMap.getRid(repository.currentRepo);
    if (!rid) return;

    socket.emit('get-ai-history', {
      rid,
      provider: currentProvider,
    });
    socket.emit('get-prompt-queue', {
      rid,
      provider: currentProvider,
    });
  }, [socket, repository.currentRepo, currentProvider]);

  // Socket接続時の初期化処理
  useEffect(() => {
    if (!socket || !isConnected) return;

    // リポジトリ一覧を取得
    socket.emit('list-repos');
    // 利用可能なエディタリストを取得
    socket.emit('get-available-editors');

    // リポジトリが選択されている場合は各種情報を取得
    const currentPath = currentRepoRef.current;
    if (currentPath) {
      socket.emit('switch-repo', {
        path: currentPath,
        initialSize: aiTerminalSize || undefined,
        permissionMode: appSettings.appSettings.permissionMode ?? 'dangerous',
      });
    }
  }, [socket, isConnected, aiTerminalSize, appSettings.appSettings.permissionMode]);

  // Socket追加イベントリスナー
  useEffect(() => {
    if (!socket) return;

    // IDマッピング受信時の処理
    const handleIdMapping = (
      data: Parameters<ServerToClientEvents['id-mapping']>[0]
    ) => {
      repositoryIdMap.update(data);

      // 現在のリポジトリに対して各種情報を取得
      const currentPath = currentRepoRef.current;
      const provider = currentProviderRef.current;
      if (currentPath) {
        const rid = repositoryIdMap.getRid(currentPath);
        if (rid) {
          socket.emit('get-ai-history', { rid, provider });
          socket.emit('list-worktrees', { rid });
          socket.emit('list-terminals', { rid });
          socket.emit('list-shortcuts', { rid });
          socket.emit('list-branches', { rid });
          socket.emit('get-npm-scripts', { rid });
          socket.emit('get-prompt-queue', { rid, provider });
          socket.emit('get-files', { rid });
        }
      }
    };

    const handleIdMappingUpdated = (
      data: Parameters<ServerToClientEvents['id-mapping-updated']>[0]
    ) => {
      repositoryIdMap.update(data);
      const currentPath = currentRepoRef.current;
      if (currentPath) {
        const rid = repositoryIdMap.getRid(currentPath);
        if (rid) {
          socket.emit('list-worktrees', { rid });
        }
      }
    };

    // npmスクリプト関連
    const handleNpmScriptsList = (
      data: Parameters<ServerToClientEvents['npm-scripts-list']>[0]
    ) => {
      const currentRid = repositoryIdMap.getRid(currentRepoRef.current);
      if (data.rid === currentRid) {
        setNpmScripts(data.scripts);
      }
    };

    // Self pulled
    const handleSelfPulled = (
      data: Parameters<ServerToClientEvents['self-pulled']>[0]
    ) => {
      if (data.success) {
        alert(
          `✅ ${data.message}\n\n${data.output}\n\n更新を反映するには、ブラウザをリロードしてください。`
        );
      } else {
        alert(`❌ ${data.message}\n\n${data.output}`);
      }
    };

    // リポジトリ切り替え完了時に追加データを取得
    const handleRepoSwitched = (
      data: Parameters<ServerToClientEvents['repo-switched']>[0]
    ) => {
      const provider = data.provider ?? currentProviderRef.current;
      if (data.provider) {
        syncProvider(data.provider);
      }

      if (data.success && data.rid) {
        socket.emit('get-ai-history', { rid: data.rid, provider });
        socket.emit('get-prompt-queue', { rid: data.rid, provider });
        socket.emit('list-worktrees', { rid: data.rid });
        socket.emit('list-terminals', { rid: data.rid });
        socket.emit('list-shortcuts', { rid: data.rid });
        socket.emit('list-branches', { rid: data.rid });
        socket.emit('get-npm-scripts', { rid: data.rid });
        socket.emit('get-files', { rid: data.rid });
        socket.emit('get-git-diff-summary', { rid: data.rid });
        socket.emit('get-repos-process-status');
        // リモートURLを取得
        // @ts-expect-error get-remote-url is not in ClientToServerEvents
        socket.emit('get-remote-url', { rid: data.rid });
      }
    };

    socket.on('id-mapping', handleIdMapping);
    socket.on('id-mapping-updated', handleIdMappingUpdated);
    socket.on('npm-scripts-list', handleNpmScriptsList);
    socket.on('self-pulled', handleSelfPulled);
    socket.on('repo-switched', handleRepoSwitched);

    return () => {
      socket.off('id-mapping', handleIdMapping);
      socket.off('id-mapping-updated', handleIdMappingUpdated);
      socket.off('npm-scripts-list', handleNpmScriptsList);
      socket.off('self-pulled', handleSelfPulled);
      socket.off('repo-switched', handleRepoSwitched);
    };
  }, [socket, syncProvider]);

  // npmスクリプト実行ハンドラ
  const handleExecuteNpmScript = useCallback(
    (scriptName: string) => {
      if (socket && repository.currentRepo) {
        const rid = repositoryIdMap.getRid(repository.currentRepo);
        if (!rid) return;
        socket.emit('execute-npm-script', {
          rid,
          scriptName,
          terminalId: terminal.activeTerminalId || undefined,
        });
      }
    },
    [socket, repository.currentRepo, terminal.activeTerminalId]
  );

  // npmスクリプト更新ハンドラ
  const handleRefreshNpmScripts = useCallback(() => {
    if (socket && repository.currentRepo) {
      const rid = repositoryIdMap.getRid(repository.currentRepo);
      if (!rid) return;
      socket.emit('get-npm-scripts', { rid });
    }
  }, [socket, repository.currentRepo]);

  // ブラウザの戻る/進むボタン対応
  useEffect(() => {
    const handlePopState = () => {
      const urlParams = new URLSearchParams(window.location.search);
      const repoFromUrl = urlParams.get('repo') || '';
      const viewFromUrl = urlParams.get('view');
      const fileFromUrl = urlParams.get('file') || '';

      // リポジトリが変化していれば切り替え（URL は既にブラウザ側で更新済み）
      if (repoFromUrl !== currentRepoRef.current) {
        repository.switchRepository(repoFromUrl, { skipPushState: true });
        return;
      }

      if (viewFromUrl === 'files') {
        // ファイルビュワーのpopstate対応はフック内で状態管理
        // ここでは何もしない（URLから状態を復元するため）
      } else if (viewFromUrl === 'diff' && fileFromUrl) {
        gitDiff.handleDiffFileClick(fileFromUrl);
      } else {
        gitDiff.handleDiffViewBack();
        fileViewer.clearState();
      }
    };

    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, [repository, gitDiff, fileViewer]);

  // ファイルビュワーが開かれたらGit差分サマリーを取得
  useEffect(() => {
    if (fileViewer.isActive) {
      gitDiff.refreshDiffSummary();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fileViewer.isActive]);

  // ビュー別ページタイトル設定
  useEffect(() => {
    const repoInfo = repository.repositories.find((r) => r.path === repository.currentRepo);
    let repoName: string;
    if (repoInfo?.isWorktree && repoInfo?.parentRepoName && repoInfo?.worktreeBranch) {
      repoName = `${repoInfo.parentRepoName} / ${repoInfo.worktreeBranch}`;
    } else if (repoInfo) {
      repoName = repoInfo.name;
    } else if (repository.currentRepo) {
      repoName = repository.currentRepo.split('/').filter(Boolean).pop() || 'Repository';
    } else {
      document.title = 'dokodemo-claude';
      return;
    }

    if (fileViewer.isActive) {
      if (fileViewer.selectedFilePath) {
        const fileName = fileViewer.selectedFilePath.split('/').pop() || 'Files';
        document.title = `${fileName} | ${repoName}`;
      } else {
        document.title = `Files | ${repoName}`;
      }
    } else if (gitDiff.currentView === 'diff' && gitDiff.diffViewFilename) {
      document.title = `Diff | ${repoName}`;
    } else {
      document.title = repoName;
    }
  }, [
    repository.currentRepo,
    repository.repositories,
    fileViewer.isActive,
    fileViewer.selectedFilePath,
    gitDiff.currentView,
    gitDiff.diffViewFilename,
  ]);

  // リポジトリが選択されていない場合はホーム画面
  if (!repository.currentRepo) {
    return (
      <HomeView
        socket={socket as Socket<ServerToClientEvents, ClientToServerEvents>}
        isConnected={isConnected}
        connectionAttempts={connectionAttempts}
        isReconnecting={isReconnecting}
        repositories={repository.repositories}
        currentRepo={repository.currentRepo}
        repoProcessStatuses={repository.repoProcessStatuses}
        lastAccessTimes={repository.lastAccessTimes}
        onCloneRepository={repository.cloneRepository}
        onCreateRepository={repository.createRepository}
        onStopProcesses={repository.showStopProcessConfirmDialog}
        onSwitchRepository={repository.switchRepository}
        onPullSelf={repository.pullSelf}
        appSettings={appSettings.appSettings}
        showSettingsModal={appSettings.showSettingsModal}
        setShowSettingsModal={appSettings.setShowSettingsModal}
        onSettingsChange={appSettings.handleSettingsChange}
        isSwitchingRepo={repository.isSwitchingRepo}
        showStopProcessConfirm={repository.showStopProcessConfirm}
        stoppingProcesses={repository.stoppingProcesses}
        stopProcessTargetRid={repository.stopProcessTargetRid}
        onConfirmStopProcesses={repository.confirmStopProcesses}
        onCancelStopProcesses={repository.cancelStopProcesses}
      />
    );
  }

  // ファイルビュワービュー
  if (fileViewer.isActive) {
    const repoName =
      repository.repositories.find((r) => r.path === repository.currentRepo)
        ?.name || '';
    return (
      <FileViewerView
        fileViewer={fileViewer}
        repoName={repoName}
        diffSummary={gitDiff.diffSummary}
        rid={repositoryIdMap.getRid(repository.currentRepo) || ''}
      />
    );
  }

  // 差分詳細ビュー
  if (gitDiff.currentView === 'diff' && gitDiff.diffViewFilename) {
    return (
      <div className={s.diffViewWrapper}>
        <DiffViewer
          rid={repositoryIdMap.getRid(repository.currentRepo) || ''}
          filename={gitDiff.diffViewFilename}
          detail={gitDiff.diffDetail}
          isLoading={gitDiff.diffDetailLoading}
          error={gitDiff.diffDetailError}
          onRefresh={gitDiff.refreshDiffDetail}
          onBack={gitDiff.handleDiffViewBack}
        />
        <RepositorySwitcher
          repositories={repository.repositories}
          currentRepo={repository.currentRepo}
          lastAccessTimes={repository.lastAccessTimes}
          repoProcessStatuses={repository.repoProcessStatuses}
          onSwitchRepository={repository.switchRepository}
        />
      </div>
    );
  }

  // メイン画面（プロジェクトビュー）
  return (
    <ProjectView
      socket={socket as Socket<ServerToClientEvents, ClientToServerEvents>}
      isConnected={isConnected}
      connectionAttempts={connectionAttempts}
      isReconnecting={isReconnecting}
      repositories={repository.repositories}
      currentRepo={repository.currentRepo}
      lastAccessTimes={repository.lastAccessTimes}
      repoProcessStatuses={repository.repoProcessStatuses}
      currentSessionId={aiCli.currentSessionId}
      currentAiMessages={aiCli.currentAiMessages}
      currentProvider={aiCli.currentProvider}
      isLoadingRepoData={repository.isLoadingRepoData}
      terminalFontSize={appSettings.terminalFontSize}
      // AI CLI関連
      onSendCommand={aiCli.sendCommand}
      onSendArrowKey={aiCli.sendArrowKey}
      onSendAltT={aiCli.sendAltT}
      onSendInterrupt={aiCli.sendInterrupt}
      onSendEscape={aiCli.sendEscape}
      onSendClear={aiCli.sendClear}
      onSendCommit={aiCli.sendCommit}
      onSendResume={aiCli.sendResume}
      onSendUsage={aiCli.sendUsage}
      onSendMode={aiCli.sendMode}
      onChangeModel={aiCli.changeModel}
      onChangeProvider={aiCli.changeProvider}
      onRestartCli={aiCli.restartCli}
      onClearHistory={aiCli.clearHistory}
      onKeyInput={aiCli.handleKeyInput}
      onResize={aiCli.handleResize}
      onReload={aiCli.handleReload}
      // ターミナル関連
      terminals={terminal.terminals}
      activeTerminalId={terminal.activeTerminalId}
      terminalMessages={terminal.terminalMessages}
      terminalHistories={terminal.terminalHistories}
      isTerminalsLoaded={terminal.isTerminalsLoaded}
      shortcuts={terminal.shortcuts}
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
      isDeletingWorktree={branchWorktree.isDeletingWorktree}
      deletingWorktreePath={branchWorktree.deletingWorktreePath}
      onSwitchBranch={branchWorktree.switchBranch}
      onDeleteBranch={branchWorktree.deleteBranch}
      onCreateBranch={branchWorktree.createBranch}
      onRefreshBranches={branchWorktree.refreshBranches}
      onPullBranch={branchWorktree.pullBranch}
      isPulling={branchWorktree.isPulling}
      pullError={branchWorktree.pullError}
      onClearPullError={() => branchWorktree.setPullError(null)}
      onCreateWorktree={branchWorktree.createWorktree}
      onDeleteWorktree={branchWorktree.deleteWorktree}
      onMergeWorktree={branchWorktree.mergeWorktree}
      onClearMergeError={() => branchWorktree.setMergeError(null)}
      // プロンプトキュー関連
      promptQueue={promptQueue.promptQueue}
      isQueueProcessing={promptQueue.isQueueProcessing}
      isQueuePaused={promptQueue.isQueuePaused}
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
      // ファイル管理関連
      files={fileManager.files}
      isUploadingFile={fileManager.isUploadingFile}
      onRefreshFiles={fileManager.refreshFiles}
      onDeleteFile={fileManager.deleteFile}
      onPasteFile={fileManager.uploadFile}
      // Git差分関連
      diffSummary={gitDiff.diffSummary}
      diffSummaryLoading={gitDiff.diffSummaryLoading}
      diffSummaryError={gitDiff.diffSummaryError}
      onRefreshDiffSummary={gitDiff.refreshDiffSummary}
      onDiffFileClick={gitDiff.handleDiffFileClick}
      // npmスクリプト関連
      npmScripts={npmScripts}
      onExecuteNpmScript={handleExecuteNpmScript}
      onRefreshNpmScripts={handleRefreshNpmScripts}
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
      onStartCodeServer={editorLauncher.startCodeServer}
      setShowEditorMenu={editorLauncher.setShowEditorMenu}
      setShowPopupBlockedModal={editorLauncher.setShowPopupBlockedModal}
      onOpenBlockedUrl={editorLauncher.openBlockedUrl}
      // 設定関連
      appSettings={appSettings.appSettings}
      showSettingsModal={appSettings.showSettingsModal}
      setShowSettingsModal={appSettings.setShowSettingsModal}
      onSettingsChange={appSettings.handleSettingsChange}
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
      // リポジトリ切り替え
      onSwitchRepository={repository.switchRepository}
    />
  );
}

export default App;
