import { useState, useEffect, useCallback, useRef } from 'react';
import type {
  AiOutputLine,
  ServerToClientEvents,
  ClientToServerEvents,
} from './types';
import { repositoryIdMap } from './utils/repository-id-map';
import {
  getLastWorktreeForParent,
  setLastWorktreeForParent,
  pruneStaleLastWorktreeRefs,
} from './utils/last-tab-storage';

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
} from './hooks';

// ビュー
import {
  HomeView,
  ProjectView,
  FileViewerView,
  DashboardView,
  GitGraphView,
} from './views';

// 差分詳細ビュー
import DiffViewer from './components/DiffViewer';
import RepositorySwitcher from './components/RepositorySwitcher';
import ProjectSwitcherModal from './components/ProjectSwitcherModal';
import { Socket } from 'socket.io-client';

import s from './App.module.scss';

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

  // ダッシュボードビューモードの状態管理
  // URL に ?view=dashboard が付いていれば最優先で有効化、無ければ localStorage
  // から前回の状態を復元する。ファイルビュワー (?view=files) や diff が
  // アクティブなら下流の条件分岐で隠れるため、ここでは購読範囲のみ管理する。
  const [dashboardMode, setDashboardMode] = useState<boolean>(() => {
    if (initialViewFromUrl === 'dashboard') return true;
    if (!initialRepo) return false;
    try {
      return localStorage.getItem(`dokodemo-view-mode-${initialRepo}`) === 'dashboard';
    } catch {
      return false;
    }
  });

  // アプリケーション設定
  const appSettings = useAppSettings(repository.currentRepo);

  // AI CLI出力受信時のコールバック
  const onAiOutputReceived = useCallback(() => {
    repository.endLoadingOnOutput();
  }, [repository]);

  // AI CLI管理
  const aiCli = useAiCli(socket, repository.currentRepo, onAiOutputReceived);
  const { aiTerminalSize, primaryInstance, activeInstance } = aiCli;
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

  // npmスクリプト関連
  const [npmScripts, setNpmScripts] = useState<Record<string, string>>({});

  // プロジェクト切り替えポップアップ
  const [isProjectSwitcherOpen, setIsProjectSwitcherOpen] = useState(false);

  // currentRepoの参照
  const currentRepoRef = useRef(repository.currentRepo);
  const primaryProviderRef = useRef<typeof primaryProvider>(primaryProvider);
  const activeInstanceIdRef = useRef(activeInstance?.instanceId);
  // useEffect 依存に repository 全体を入れると毎レンダリングで effect が
  // 再発火するため、最新の switchRepository だけを ref 経由で参照する。
  const switchRepositoryRef = useRef(repository.switchRepository);

  useEffect(() => {
    currentRepoRef.current = repository.currentRepo;
  }, [repository.currentRepo]);
  useEffect(() => {
    primaryProviderRef.current = primaryProvider;
  }, [primaryProvider]);
  useEffect(() => {
    activeInstanceIdRef.current = activeInstance?.instanceId;
  }, [activeInstance]);
  useEffect(() => {
    switchRepositoryRef.current = repository.switchRepository;
  }, [repository.switchRepository]);

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

  // Socket接続時の初期化処理
  useEffect(() => {
    if (!socket || !isConnected) return;

    // リポジトリ一覧を取得
    socket.emit('list-repos');
    // 利用可能なエディタリストを取得
    socket.emit('get-available-editors');

    // リポジトリが選択されている場合は各種情報を取得
    const currentPath = currentRepoRef.current;
    if (!currentPath) return;

    // URL の `?repo=<path>` 経由で復元された path は、ユーザがその worktree を
    // ブラウザに開いたまま削除した結果として実体が消えている可能性がある。
    // そのまま `switch-repo` を投げると node-pty が cwd 不存在で失敗し、
    // UI が「何もできない」状態のまま残ってしまうため、事前に存在確認する。
    // - 存在する → 通常どおり switch-repo
    // - 存在しない & 親リポを推測できる → 親リポへフォールバック
    // - それ以外 → URL を消してホームへ戻す
    const switchOptions = {
      initialSize: aiTerminalSize || undefined,
      permissionMode: appSettings.appSettings.permissionMode,
    } as const;

    const handler = (
      data: Parameters<ServerToClientEvents['repo-path-checked']>[0]
    ) => {
      if (data.path !== currentPath) return;
      socket.off('repo-path-checked', handler);

      if (data.exists) {
        socket.emit('switch-repo', { path: currentPath, ...switchOptions });
        return;
      }

      // 削除済み worktree への参照を localStorage からも掃除する
      // （`last-worktree-for-parent` の親→最終 worktree マップが
      // この path を指したままだと、後でホーム経由で開き直しても再び
      // 同じ broken state に飛んでしまう）
      pruneStaleLastWorktreeRefs(currentPath);

      if (data.fallbackParentPath && data.fallbackParentExists) {
        switchRepositoryRef.current(data.fallbackParentPath);
      } else {
        // 親も推測できない/存在しない場合はホームへ戻す
        switchRepositoryRef.current('');
      }
    };
    socket.on('repo-path-checked', handler);
    socket.emit('check-repo-path', { path: currentPath });

    return () => {
      socket.off('repo-path-checked', handler);
    };
  }, [socket, isConnected, aiTerminalSize, appSettings.appSettings.permissionMode]);

  // Socket追加イベントリスナー
  useEffect(() => {
    if (!socket) return;

    // IDマッピング受信時の処理
    const handleIdMapping = (
      data: Parameters<ServerToClientEvents['id-mapping']>[0]
    ) => {
      repositoryIdMap.update(data);

      const currentPath = currentRepoRef.current;
      if (currentPath) {
        const rid = repositoryIdMap.getRid(currentPath);
        if (rid) {
          socket.emit('list-ai-instances', { rid });
          socket.emit('list-worktrees', { rid });
          socket.emit('list-terminals', { rid });
          socket.emit('list-shortcuts', { rid });
          socket.emit('list-branches', { rid });
          socket.emit('get-npm-scripts', { rid });
          const provider = primaryProviderRef.current;
          if (provider) {
            socket.emit('get-prompt-queue', { rid, provider });
          }
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
        alert(`✅ ${data.message}\n\n${data.output}`);
      } else {
        alert(`❌ ${data.message}\n\n${data.output}`);
      }
    };

    // リポジトリ切り替え完了時に追加データを取得
    const handleRepoSwitched = (
      data: Parameters<ServerToClientEvents['repo-switched']>[0]
    ) => {
      if (data.success && data.rid) {
        socket.emit('list-ai-instances', { rid: data.rid });
        if (data.primaryProvider) {
          socket.emit('get-prompt-queue', {
            rid: data.rid,
            provider: data.primaryProvider,
          });
        }
        socket.emit('list-worktrees', { rid: data.rid });
        socket.emit('list-terminals', { rid: data.rid });
        socket.emit('list-shortcuts', { rid: data.rid });
        socket.emit('list-branches', { rid: data.rid });
        socket.emit('get-npm-scripts', { rid: data.rid });
        socket.emit('get-files', { rid: data.rid });
        socket.emit('get-git-diff-summary', { rid: data.rid });
        socket.emit('get-repos-process-status');
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
  }, [socket]);

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

      if (viewFromUrl === 'graph') {
        setDashboardMode(false);
        gitDiff.handleDiffViewBack();
        fileViewer.clearState();
        gitGraph.syncActive(true);
        return;
      }

      // graph 以外へ遷移する場合は graph ビューを閉じる
      gitGraph.syncActive(false);

      if (viewFromUrl === 'files') {
        // ファイルビュワーのpopstate対応はフック内で状態管理
        setDashboardMode(false);
      } else if (viewFromUrl === 'diff' && fileFromUrl) {
        setDashboardMode(false);
        gitDiff.handleDiffFileClick(fileFromUrl);
      } else if (viewFromUrl === 'dashboard') {
        setDashboardMode(true);
        gitDiff.handleDiffViewBack();
        fileViewer.clearState();
      } else {
        setDashboardMode(false);
        gitDiff.handleDiffViewBack();
        fileViewer.clearState();
      }
    };

    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, [repository, gitDiff, fileViewer, gitGraph]);

  // リポジトリ切り替え時にダッシュボードモードを localStorage から復元
  useEffect(() => {
    if (!repository.currentRepo) return;
    try {
      const saved = localStorage.getItem(
        `dokodemo-view-mode-${repository.currentRepo}`
      );
      setDashboardMode(saved === 'dashboard');
    } catch {
      /* noop */
    }
  }, [repository.currentRepo]);

  // ダッシュボードモード切替（URL と localStorage に反映）
  const setDashboardModeAndPersist = useCallback(
    (next: boolean) => {
      setDashboardMode(next);
      const repo = currentRepoRef.current;
      if (repo) {
        try {
          localStorage.setItem(
            `dokodemo-view-mode-${repo}`,
            next ? 'dashboard' : 'project'
          );
        } catch {
          /* noop */
        }
      }
      // URL も同期（リポジトリ切替で消えるので個別管理）
      const url = new URL(window.location.href);
      if (next) {
        url.searchParams.set('view', 'dashboard');
      } else {
        if (url.searchParams.get('view') === 'dashboard') {
          url.searchParams.delete('view');
        }
      }
      window.history.pushState({}, '', url.toString());
    },
    []
  );

  // ファイルビュワーが開かれたらGit差分サマリーを取得
  useEffect(() => {
    if (fileViewer.isActive) {
      gitDiff.refreshDiffSummary();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fileViewer.isActive]);

  // Ctrl+Shift+P / Cmd+Shift+P でプロジェクト切り替えポップアップを開く
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && !e.altKey && e.key.toLowerCase() === 'p') {
        e.preventDefault();
        setIsProjectSwitcherOpen((open) => !open);
      }
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, []);

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

  // リポジトリ一覧（HomeView / RepositorySwitcher）からのクリック時に、
  // 親リポに紐づく「最後に選んだ worktree」が保存されていれば差し替える。
  // 自動 restore は本ハンドラ呼び出し時にのみ発火（描画時の useEffect では
  // やらない）。これにより「topに戻る」ボタンを押してもホームに留まれる。
  // 保存された worktree が削除済みだった場合は親リポへフォールバックし、
  // 保存値をクリアして次回以降の無効参照を防ぐ。
  const switchRepositoryFromList = useCallback(
    (path: string) => {
      if (!path) {
        repository.switchRepository(path);
        return;
      }
      const lastPath = getLastWorktreeForParent(path);
      if (!lastPath || lastPath === path || !socket) {
        repository.switchRepository(path);
        return;
      }
      // サーバに存在確認 → 結果次第で worktree か親リポへ切り替える
      const handler = (data: { path: string; exists: boolean }) => {
        if (data.path !== lastPath) return;
        socket.off('repo-path-checked', handler);
        if (data.exists) {
          repository.switchRepository(lastPath);
        } else {
          // 削除されていた worktree への参照を捨てて親リポへ戻す
          setLastWorktreeForParent(path, path);
          repository.switchRepository(path);
        }
      };
      socket.on('repo-path-checked', handler);
      socket.emit('check-repo-path', { path: lastPath });
    },
    [repository, socket]
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

  // リポジトリが選択されていない場合はホーム画面
  if (!repository.currentRepo) {
    return (
      <>
      <HomeView
        socket={socket as Socket<ServerToClientEvents, ClientToServerEvents>}
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
      {projectSwitcher}
      </>
    );
  }

  // ファイルビュワービュー
  if (fileViewer.isActive) {
    const repoName =
      repository.repositories.find((r) => r.path === repository.currentRepo)
        ?.name || '';
    return (
      <>
      <FileViewerView
        fileViewer={fileViewer}
        repoName={repoName}
        diffSummary={gitDiff.diffSummary}
        rid={repositoryIdMap.getRid(repository.currentRepo) || ''}
      />
      {projectSwitcher}
      </>
    );
  }

  // Git Graph ビュー（diff 分岐より上。file diff オーバーレイを graph 側に持たせる）
  if (gitGraph.isActive) {
    const repoInfo = repository.repositories.find(
      (r) => r.path === repository.currentRepo
    );
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
        <GitGraphView
          gitGraph={gitGraph}
          repoName={graphRepoName}
          rid={repositoryIdMap.getRid(repository.currentRepo) || ''}
        />
        {projectSwitcher}
      </>
    );
  }

  // 差分詳細ビュー
  if (gitDiff.currentView === 'diff' && gitDiff.diffViewFilename) {
    return (
      <>
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
          repoProcessStatuses={repository.repoProcessStatuses}
          onSwitchRepository={switchRepositoryFromList}
        />
      </div>
      {projectSwitcher}
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
        appSettings={appSettings.appSettings}
        onSettingsChange={appSettings.handleSettingsChange}
        onPasteFile={fileManager.uploadFile}
        isUploadingFile={fileManager.isUploadingFile}
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
      {projectSwitcher}
      </>
    );
  }

  // メイン画面（プロジェクトビュー）
  return (
    <>
    <ProjectView
      socket={socket as Socket<ServerToClientEvents, ClientToServerEvents>}
      isConnected={isConnected}
      connectionAttempts={connectionAttempts}
      isReconnecting={isReconnecting}
      repositories={repository.repositories}
      currentRepo={repository.currentRepo}
      repoProcessStatuses={repository.repoProcessStatuses}
      aiInstances={aiCli.aiInstances}
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
      // リポジトリ切り替え（HomeView / RepositorySwitcher / WorktreeTabs 共通）。
      // WorktreeTabs はクリック時に setLastWorktreeForParent を先に呼ぶため、
      // ラッパー経由でも結果が変わらないことを担保している。
      onSwitchRepository={switchRepositoryFromList}
      // ダッシュボード切替
      onOpenDashboard={() => setDashboardModeAndPersist(true)}
      // Git Graph 表示
      onOpenGraphView={gitGraph.openGraphView}
    />
    {projectSwitcher}
    </>
  );
}

export default App;
