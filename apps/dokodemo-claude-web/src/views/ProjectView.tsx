import { useRef, useCallback, useState, useEffect } from 'react';
import type { Ref } from 'react';
import {
  LayoutDashboard,
  PanelRightClose,
  PanelRightOpen,
} from 'lucide-react';
import type {
  GitRepository,
  GitBranch,
  GitWorktree,
  Terminal,
  TerminalMessage,
  TerminalOutputLine,
  AiOutputLine,
  AiInstance,
  CommandShortcut,
  DetectedPortInfo,
  AiProvider,
  EditorInfo,
  EditorType,
  PromptQueueItem,
  UploadedFileInfo,
  GitDiffSummary,
  RepoProcessStatus,
  CustomAiButton,
  CustomAiButtonScope,
  WorktreeSyncEntry,
} from '../types';
import { repositoryIdMap } from '../utils/repository-id-map';
import type { CommandSendSettings } from '../hooks/useAppSettings';
import type { LoopEndInfo } from '../hooks/usePromptQueue';
import type {
  WorktreeSyncConfigState,
  WorktreeSyncCandidatesState,
  PullState,
  BranchSyncStatus,
} from '../hooks/useBranchWorktree';

import AiOutput, { AiOutputRef } from '../components/AiOutput';
import TextInput, { TextInputRef } from '../components/CommandInput';
import { KeyboardButtons } from '../components/KeyboardButtons';
import TerminalManager from '../components/TerminalManager';
import BranchSelector from '../components/BranchSelector';
import NpmScripts from '../components/NpmScripts';
import { PopupBlockedModal } from '../components/PopupBlockedModal';
import RepoHeader from '../components/RepoHeader';
import RepositorySwitcher from '../components/RepositorySwitcher';
import WorktreeTabs from '../components/WorktreeTabs';
import WorktreeOperations from '../components/WorktreeOperations';
import PromptQueue from '../components/PromptQueue';
import SidePanel from '../components/SidePanel';
import AiInstanceTabs from '../components/AiInstanceTabs';
import type { AiInstanceTabsHandle } from '../components/AiInstanceTabs';
import DrawingCanvas from '../components/DrawingCanvas';
import s from './ProjectView.module.scss';

// SidePanel（右列：送信/受信/MD/Git）の折りたたみ状態をリポジトリ単位で保存する。
// PC（lg 以上・右列配置時）でのみ意味を持ち、CLI を横幅いっぱいに広げるための設定。
const SIDECOL_COLLAPSE_KEY_PREFIX = 'dokodemo-sidecol-collapsed';

function getSideColCollapseKey(repo: string): string {
  return repo
    ? `${SIDECOL_COLLAPSE_KEY_PREFIX}-${repo}`
    : SIDECOL_COLLAPSE_KEY_PREFIX;
}

function getStoredSideColCollapsed(repo: string): boolean {
  try {
    return localStorage.getItem(getSideColCollapseKey(repo)) === '1';
  } catch {
    return false;
  }
}

interface ProjectViewProps {
  // 接続状態
  isConnected: boolean;
  connectionAttempts: number;
  isReconnecting: boolean;

  // リポジトリ関連（repositories はサーバー側でソート済み）
  repositories: GitRepository[];
  currentRepo: string;
  repoProcessStatuses: RepoProcessStatus[];

  // AI CLI関連
  aiInstances: AiInstance[];
  // instanceId → 指示内容の要約（タブのサブテキスト表示用）
  aiActivitySummaries: Record<string, string>;
  activeInstance: AiInstance | undefined;
  primaryInstance: AiInstance | undefined;
  currentAiMessages: AiOutputLine[];
  isLoadingRepoData: boolean;
  terminalFontSize: number;

  // タブ操作
  aiInstanceTabsRef: Ref<AiInstanceTabsHandle>;
  onActivateInstance: (instanceId: string) => void;
  onCreateInstance: (provider: AiProvider) => void;
  onCloseInstance: (instanceId: string) => void;

  // AIアクション（active instance に対する操作）
  onSendCommand: (command: string) => void;
  onSendArrowKey: (direction: 'up' | 'down' | 'left' | 'right') => void;
  onSendAltT: () => void;
  onSendInterrupt: () => void;
  onSendEscape: () => void;
  onSendSpace: () => void;
  onSendClear: () => void;
  onSendCommit: () => void;
  onSendPreview: () => void;
  onSendResume: () => void;
  onSendUsage: () => void;
  onSendMode: () => void;
  onChangeModel: (model: string) => void;
  onChangePrimaryProvider: (provider: AiProvider) => void;
  onRestartCli: (instanceId?: string, fresh?: boolean) => void;
  onKeyInput: (key: string) => void;
  onResize: (cols: number, rows: number) => void;

  // ターミナル関連
  terminals: Terminal[];
  activeTerminalId: string;
  terminalMessages: TerminalMessage[];
  terminalHistories: Map<string, TerminalOutputLine[]>;
  isTerminalsLoaded: boolean;
  shortcuts: CommandShortcut[];
  devServerPortsByRepo: Map<string, DetectedPortInfo[]>;
  onCreateTerminal: (cwd: string, name?: string) => void;
  onCloseTerminal: (terminalId: string) => void;
  onTerminalInput: (terminalId: string, input: string) => void;
  onTerminalSignal: (terminalId: string, signal: string) => void;
  onTerminalResize: (terminalId: string, cols: number, rows: number) => void;
  onActiveTerminalChange: (terminalId: string) => void;
  onCreateShortcut: (name: string, command: string) => void;
  onDeleteShortcut: (shortcutId: string) => void;
  onExecuteShortcut: (shortcutId: string, terminalId: string) => void;

  // ブランチ・ワークツリー関連
  branches: GitBranch[];
  currentBranch: string;
  worktrees: GitWorktree[];
  parentRepoPath: string;
  mergeError: {
    message: string;
    conflictFiles?: string[];
    errorDetails?: string;
  } | null;
  worktreeCreateError: { message: string } | null;
  worktreeCreateSuccessNonce: number;
  onClearWorktreeCreateError: () => void;
  isDeletingWorktree: boolean;
  deletingWorktreePath: string | null;
  onSwitchBranch: (branchName: string) => void;
  onDeleteBranch: (branchName: string, deleteRemote?: boolean) => void;
  onCreateBranch: (branchName: string, baseBranch?: string) => void;
  onRefreshBranches: () => void;
  onPullBranch: () => void;
  pullState: PullState | null;
  onClearPullState: () => void;
  syncStatus: BranchSyncStatus | null;
  isSyncStatusRefreshing: boolean;
  onRefreshSyncStatus: () => void;
  pushState: PullState | null;
  onPushBranch: () => void;
  onClearPushState: () => void;
  onCreateWorktree: (
    branchName: string,
    baseBranch: string | undefined,
    useExisting: boolean,
    syncEntries: WorktreeSyncEntry[]
  ) => void;
  worktreeSyncConfig: WorktreeSyncConfigState | null;
  onRequestWorktreeSyncConfig: () => void;
  onSaveWorktreeSyncConfig: (entries: WorktreeSyncEntry[]) => void;
  worktreeSyncCandidates: WorktreeSyncCandidatesState | null;
  onRequestWorktreeSyncCandidates: (dirPath: string) => void;
  onReorderWorktrees: (orderedBranchPaths: string[]) => void;
  onDeleteWorktree: (worktreePath: string, deleteBranch?: boolean) => void;
  onMergeWorktree: (worktreePath: string) => void;
  onSaveWorktreeMemo: (worktreePath: string, memo: string) => void;
  onClearMergeError: () => void;

  // プロンプトキュー関連
  promptQueue: PromptQueueItem[];
  isQueueProcessing: boolean;
  isQueuePaused: boolean;
  currentQueueItemId?: string;
  onAddToQueue: (
    command: string,
    sendClearBefore: boolean,
    sendCommitAfter: boolean,
    model?: string,
    loop?: {
      judge: 'ai' | 'user' | 'none';
      judgeEveryN: number;
      intervalSec: number;
      judgeCriteria?: string;
      planning?: { everyN: number; model: string; prompt: string };
    }
  ) => void;
  onRemoveFromQueue: (itemId: string) => void;
  onUpdateQueue: (
    itemId: string,
    prompt: string,
    sendClearBefore: boolean,
    isAutoCommit: boolean,
    model?: string,
    loop?: {
      judge: 'ai' | 'user' | 'none';
      judgeEveryN: number;
      intervalSec: number;
      judgeCriteria?: string;
      planning?: { everyN: number; model: string; prompt: string };
    } | null
  ) => void;
  onPauseQueue: () => void;
  onResumeQueue: () => void;
  onResetQueue: () => void;
  onCancelCurrentItem: () => void;
  onForceSend: (itemId: string) => void;
  onReorderQueue: (reorderedQueue: PromptQueueItem[]) => void;
  onRequeueItem: (itemId: string) => void;
  onStopLoop: (itemId: string) => void;
  onApproveLoop: (itemId: string, approved: boolean) => void;
  loopEndInfo: LoopEndInfo | null;
  onDismissLoopEnd: () => void;

  // ファイル管理関連
  files: UploadedFileInfo[];
  isUploadingFile: boolean;
  uploadProgress: number | null;
  onCancelUpload: () => void;
  onRefreshFiles: () => void;
  onDeleteFile: (filename: string) => void;
  onPasteFile: (file: File) => Promise<string | undefined>;

  // Git差分関連
  diffSummary: GitDiffSummary | null;
  diffSummaryLoading: boolean;
  diffSummaryError: string | null;
  onRefreshDiffSummary: () => void;
  onDiffFileClick: (filename: string) => void;

  // npmスクリプト関連
  npmScripts: Record<string, string>;
  onExecuteNpmScript: (scriptName: string) => void;
  onRefreshNpmScripts: () => void;

  // エディタ関連
  availableEditors: EditorInfo[];
  showEditorMenu: boolean;
  startingCodeServer: boolean;
  showPopupBlockedModal: boolean;
  blockedCodeServerUrl: string;
  remoteUrl: string | null;
  isLocalhost: boolean;
  editorMenuRef: React.RefObject<HTMLDivElement | null>;
  onOpenInEditor: (editor: EditorType) => void;
  setShowEditorMenu: (show: boolean) => void;
  setShowPopupBlockedModal: (show: boolean) => void;
  onOpenBlockedUrl: () => void;

  // 設定関連
  onOpenSettings: () => void;
  sendSettings: CommandSendSettings;
  onSendSettingsChange: React.Dispatch<React.SetStateAction<CommandSendSettings>>;

  // リポジトリ操作
  showDeleteConfirm: boolean;
  setShowDeleteConfirm: (show: boolean) => void;
  onDeleteRepository: (path: string, name: string) => void;

  // プロセス停止
  showStopProcessConfirm: boolean;
  stoppingProcesses: boolean;
  stopProcessTargetRid: string | null;
  onConfirmStopProcesses: () => void;
  onCancelStopProcesses: () => void;

  // カスタム送信ボタン関連
  customAiButtons: CustomAiButton[];
  onCreateCustomAiButton: (
    name: string,
    command: string,
    scope: CustomAiButtonScope,
    repositoryPath?: string
  ) => void;
  onUpdateCustomAiButton: (
    id: string,
    name: string,
    command: string,
    scope: CustomAiButtonScope,
    repositoryPath?: string
  ) => void;
  onDeleteCustomAiButton: (id: string) => void;

  // ファイルビュワー
  onOpenFileViewer: () => void;
  onOpenWorkflowFile?: (path: string) => void;

  // リポジトリ切り替え
  onSwitchRepository: (path: string) => void;

  // ダッシュボード切替
  onOpenDashboard: () => void;

  // Git Graph 表示
  onOpenGraphView: () => void;
}

export function ProjectView({
  isConnected,
  connectionAttempts,
  isReconnecting,
  repositories,
  currentRepo,
  repoProcessStatuses,
  aiInstances,
  aiActivitySummaries,
  activeInstance,
  primaryInstance,
  currentAiMessages,
  isLoadingRepoData,
  terminalFontSize,
  aiInstanceTabsRef,
  onActivateInstance,
  onCreateInstance,
  onCloseInstance,
  onSendCommand,
  onSendArrowKey,
  onSendAltT,
  onSendInterrupt,
  onSendEscape,
  onSendSpace,
  onSendClear,
  onSendCommit,
  onSendPreview,
  onSendResume,
  onSendUsage,
  onSendMode,
  onChangeModel,
  onChangePrimaryProvider,
  onRestartCli,
  onKeyInput,
  onResize,
  terminals,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  activeTerminalId: _activeTerminalId,
  terminalMessages,
  terminalHistories,
  isTerminalsLoaded,
  shortcuts,
  devServerPortsByRepo,
  onCreateTerminal,
  onCloseTerminal,
  onTerminalInput,
  onTerminalSignal,
  onTerminalResize,
  onActiveTerminalChange,
  onCreateShortcut,
  onDeleteShortcut,
  onExecuteShortcut,
  branches,
  currentBranch,
  worktrees,
  parentRepoPath,
  mergeError,
  worktreeCreateError,
  worktreeCreateSuccessNonce,
  onClearWorktreeCreateError,
  isDeletingWorktree,
  deletingWorktreePath,
  onSwitchBranch,
  onDeleteBranch,
  onCreateBranch,
  onRefreshBranches,
  onPullBranch,
  pullState,
  onClearPullState,
  syncStatus,
  isSyncStatusRefreshing,
  onRefreshSyncStatus,
  pushState,
  onPushBranch,
  onClearPushState,
  onCreateWorktree,
  onReorderWorktrees,
  worktreeSyncConfig,
  onRequestWorktreeSyncConfig,
  onSaveWorktreeSyncConfig,
  worktreeSyncCandidates,
  onRequestWorktreeSyncCandidates,
  onDeleteWorktree,
  onMergeWorktree,
  onSaveWorktreeMemo,
  onClearMergeError,
  promptQueue,
  isQueueProcessing,
  isQueuePaused,
  currentQueueItemId,
  onAddToQueue,
  onRemoveFromQueue,
  onUpdateQueue,
  onPauseQueue,
  onResumeQueue,
  onResetQueue,
  onCancelCurrentItem,
  onForceSend,
  onReorderQueue,
  onRequeueItem,
  onStopLoop,
  onApproveLoop,
  loopEndInfo,
  onDismissLoopEnd,
  files,
  isUploadingFile,
  uploadProgress,
  onCancelUpload,
  onRefreshFiles,
  onDeleteFile,
  onPasteFile,
  diffSummary,
  diffSummaryLoading,
  diffSummaryError,
  onRefreshDiffSummary,
  onDiffFileClick,
  npmScripts,
  onExecuteNpmScript,
  onRefreshNpmScripts,
  availableEditors,
  showEditorMenu,
  startingCodeServer,
  showPopupBlockedModal,
  blockedCodeServerUrl,
  remoteUrl,
  isLocalhost,
  editorMenuRef,
  onOpenInEditor,
  setShowEditorMenu,
  setShowPopupBlockedModal,
  onOpenBlockedUrl,
  onOpenSettings,
  sendSettings,
  onSendSettingsChange,
  showDeleteConfirm,
  setShowDeleteConfirm,
  onDeleteRepository,
  showStopProcessConfirm,
  stoppingProcesses,
  stopProcessTargetRid,
  onConfirmStopProcesses,
  onCancelStopProcesses,
  customAiButtons,
  onCreateCustomAiButton,
  onUpdateCustomAiButton,
  onDeleteCustomAiButton,
  onOpenFileViewer,
  onOpenWorkflowFile,
  onSwitchRepository,
  onOpenDashboard,
  onOpenGraphView,
}: ProjectViewProps) {
  // Refs
  const textInputRef = useRef<TextInputRef>(null);
  const aiOutputRef = useRef<AiOutputRef>(null);

  // AI CLI パネルの全画面表示状態。xterm 単体ではなく、入力欄（CommandInput）と
  // 操作ボタン（KeyboardButtons）を含む cliInnerRow ごと全画面化することで、
  // 拡大中もスマホと同じプロンプト入力・補助キー操作を維持する
  const [isCliFullscreen, setIsCliFullscreen] = useState(false);

  const handleToggleCliFullscreen = useCallback(() => {
    setIsCliFullscreen((prev) => !prev);
    // 全画面 ON/OFF で送信・受信パネル（右列）の表示が切り替わり CLI 列の幅が
    // 変わるため、レイアウト確定後に xterm を再フィットさせる
    requestAnimationFrame(() => aiOutputRef.current?.resize());
  }, []);

  // SidePanel（右列）の折りたたみ状態。リポジトリ単位で localStorage に保存し、
  // PC（lg 以上）で送信・受信エリアを畳んで CLI を横幅いっぱいに広げられるようにする。
  const [isSideColCollapsed, setIsSideColCollapsed] = useState(() =>
    getStoredSideColCollapsed(currentRepo)
  );

  // リポジトリ切り替え時に保存済みの折りたたみ状態を復元する
  useEffect(() => {
    setIsSideColCollapsed(getStoredSideColCollapsed(currentRepo));
  }, [currentRepo]);

  const handleToggleSideCol = useCallback(() => {
    setIsSideColCollapsed((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(
          getSideColCollapseKey(currentRepo),
          next ? '1' : '0'
        );
      } catch {
        // ignore
      }
      return next;
    });
    // 右列の表示切替でメイン列の横幅が変わるため xterm を再フィットさせる
    requestAnimationFrame(() => aiOutputRef.current?.resize());
  }, [currentRepo]);

  // ESC キーで全画面解除。ただし textarea / input フォーカス中の ESC は
  // CLI への ESC 送信（プロンプト中断等）に使われるため対象外にする
  // （xterm のヘルパー textarea もここで除外される）
  useEffect(() => {
    if (!isCliFullscreen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === 'TEXTAREA' || target.tagName === 'INPUT')
      ) {
        return;
      }
      setIsCliFullscreen(false);
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isCliFullscreen]);

  // ハンドラ
  const handleSendCommand = useCallback(
    (command: string) => {
      onSendCommand(command);
      aiOutputRef.current?.scrollToBottom();
    },
    [onSendCommand]
  );

  // AI ターミナル上にドロップされたファイルをテキストエリアへルーティング
  const handleAiTerminalFileDrop = useCallback((files: File[]) => {
    void textInputRef.current?.insertFiles(files);
  }, []);

  // 赤入れ対象の画像URL（null なら閉じる）
  const [annotateImageUrl, setAnnotateImageUrl] = useState<string | null>(
    null
  );

  const handleAnnotateImage = useCallback((imageUrl: string) => {
    setAnnotateImageUrl(imageUrl);
  }, []);

  // 赤入れ完了：合成PNGをアップロードしてプロンプト入力欄にパスを挿入
  const handleAnnotateComplete = useCallback((file: File) => {
    setAnnotateImageUrl(null);
    void textInputRef.current?.insertFiles([file]);
  }, []);

  const handleAddToQueue = useCallback(
    (
      command: string,
      sendClearBefore: boolean,
      sendCommitAfter: boolean,
      model?: string,
      loop?: {
        judge: 'ai' | 'user' | 'none';
        judgeEveryN: number;
        intervalSec: number;
        judgeCriteria?: string;
        planning?: { everyN: number; model: string; prompt: string };
      }
    ) => {
      onAddToQueue(command, sendClearBefore, sendCommitAfter, model, loop);
      aiOutputRef.current?.scrollToBottom();
    },
    [onAddToQueue]
  );

  const currentRid = repositoryIdMap.getRid(currentRepo);

  return (
    <div className={s.root}>
      {/* ヘッダー */}
      <RepoHeader
        isConnected={isConnected}
        isReconnecting={isReconnecting}
        connectionAttempts={connectionAttempts}
        primaryInstance={primaryInstance}
        repositories={repositories}
        currentRepo={currentRepo}
        onOpenFileViewer={onOpenFileViewer}
        onOpenGraphView={onOpenGraphView}
        onOpenSettings={onOpenSettings}
        startingCodeServer={startingCodeServer}
        isLocalhost={isLocalhost}
        availableEditors={availableEditors}
        showEditorMenu={showEditorMenu}
        setShowEditorMenu={setShowEditorMenu}
        editorMenuRef={editorMenuRef}
        onOpenInEditor={onOpenInEditor}
        remoteUrl={remoteUrl}
      />

      {/* メインコンテンツ */}
      <main className={s.main}>
        {/* 縦並びレイアウト: AI CLI & ターミナル */}
        <div className={s.topLayout}>
          {/* ブランチセレクター + ワークツリータブ（Claude CLIの上） */}
          <div className={s.branchBar}>
            {/* ブランチセレクター */}
            <div className={s.branchSelectorWrap}>
              <BranchSelector
                branches={branches}
                currentBranch={currentBranch}
                onSwitchBranch={onSwitchBranch}
                onDeleteBranch={onDeleteBranch}
                onCreateBranch={onCreateBranch}
                onRefreshBranches={onRefreshBranches}
                onPullBranch={onPullBranch}
                pullState={pullState}
                onClearPullState={onClearPullState}
                syncStatus={syncStatus}
                isSyncStatusRefreshing={isSyncStatusRefreshing}
                onRefreshSyncStatus={onRefreshSyncStatus}
                pushState={pushState}
                onPushBranch={onPushBranch}
                onClearPushState={onClearPushState}
                worktrees={worktrees}
                isConnected={isConnected}
              />
            </div>
            {/* ワークツリータブ */}
            {currentRepo && (
              <>
                <div className={s.branchDivider} />
                <WorktreeTabs
                  worktrees={worktrees}
                  currentWorktreePath={currentRepo}
                  parentRepoPath={parentRepoPath}
                  onCreateWorktree={onCreateWorktree}
                  onReorderWorktrees={onReorderWorktrees}
                  onDeleteWorktree={onDeleteWorktree}
                  onMergeWorktree={onMergeWorktree}
                  onSwitchRepository={onSwitchRepository}
                  isConnected={isConnected}
                  branches={branches}
                  onRefreshBranches={onRefreshBranches}
                  isDeletingWorktree={isDeletingWorktree}
                  compact={true}
                  syncConfig={worktreeSyncConfig}
                  onRequestSyncConfig={onRequestWorktreeSyncConfig}
                  onSaveSyncConfig={onSaveWorktreeSyncConfig}
                  syncCandidates={worktreeSyncCandidates}
                  onRequestSyncCandidates={onRequestWorktreeSyncCandidates}
                  worktreeCreateError={worktreeCreateError}
                  worktreeCreateSuccessNonce={worktreeCreateSuccessNonce}
                  onClearWorktreeCreateError={onClearWorktreeCreateError}
                />
                <button
                  type="button"
                  onClick={onOpenDashboard}
                  className={s.dashboardButton}
                  title="ワークツリーダッシュボードを開く"
                  aria-label="ワークツリーダッシュボードを開く"
                >
                  <LayoutDashboard
                    size={16}
                    className={s.dashboardButtonIcon}
                    aria-hidden
                  />
                </button>
              </>
            )}
          </div>

          {/* ワークツリー操作セクション（メモ＋全worktreeの開発サーバー一覧） */}
          {(() => {
            const normalizedCurrentRepo = currentRepo.replace(/\/+$/, '');
            const matchedWorktree = worktrees.find(
              (w) => w.path.replace(/\/+$/, '') === normalizedCurrentRepo
            );
            return (
              <WorktreeOperations
                currentWorktree={matchedWorktree}
                onSaveMemo={onSaveWorktreeMemo}
                mergeError={mergeError}
                onClearMergeError={onClearMergeError}
                devServerPortsByRepo={devServerPortsByRepo}
              />
            );
          })()}

          {/* AI CLI セクション */}
          <section className={s.cliSection}>
            <div className={s.cliTabBar}>
              <div className={s.cliTabsScroll}>
                <AiInstanceTabs
                  ref={aiInstanceTabsRef}
                  instances={aiInstances}
                  activitySummaries={aiActivitySummaries}
                  activeInstanceId={activeInstance?.instanceId ?? ''}
                  isConnected={isConnected}
                  onActivate={onActivateInstance}
                  onCreate={onCreateInstance}
                  onClose={onCloseInstance}
                  onChangePrimaryProvider={onChangePrimaryProvider}
                  onRestart={onRestartCli}
                />
              </div>
              {/* 全画面切替と右列パネルの折りたたみトグル */}
              <div className={s.cliTabActions}>
                {/* 右列（送信/受信/MD/Git）の折りたたみトグル。PC でのみ表示し、
                    畳むと CLI がその分だけ横に広がる（状態はリポジトリ単位で保存） */}
                <button
                  type="button"
                  onClick={handleToggleSideCol}
                  className={`btn-icon-xs ${s.sideColToggle}`}
                  title={
                    isSideColCollapsed
                      ? '送信・受信パネルを表示'
                      : '送信・受信パネルを畳んで CLI を広げる'
                  }
                  aria-pressed={isSideColCollapsed}
                >
                  {isSideColCollapsed ? (
                    <PanelRightOpen size={14} />
                  ) : (
                    <PanelRightClose size={14} />
                  )}
                </button>
              </div>
            </div>

            <div className={s.cliBody}>
              <div
                className={`${s.cliInnerRow} ${isCliFullscreen ? s.cliInnerRowFullscreen : ''}`}
              >
                <div className={s.cliMainCol}>
                  <div className={s.cliOutputWrapper}>
                    <AiOutput
                      ref={aiOutputRef}
                      key={activeInstance?.instanceId ?? 'no-instance'}
                      messages={currentAiMessages}
                      currentProvider={activeInstance?.provider ?? 'claude'}
                      isLoading={isLoadingRepoData}
                      onKeyInput={onKeyInput}
                      onResize={onResize}
                      fontSize={terminalFontSize}
                      onFileDrop={handleAiTerminalFileDrop}
                      isFullscreen={isCliFullscreen}
                      onToggleFullscreen={handleToggleCliFullscreen}
                    />
                  </div>

                  <div className={s.cliInputWrapper}>
                    <TextInput
                      ref={textInputRef}
                      onSendCommand={handleSendCommand}
                      onSendEscape={onSendEscape}
                      onAddToQueue={handleAddToQueue}
                      currentProvider={activeInstance?.provider ?? 'claude'}
                      currentRepository={currentRepo}
                      isPrimary={activeInstance?.isPrimary ?? false}
                      disabled={!isConnected || !currentRepo || !activeInstance}
                      inputDisabled={!currentRepo || !activeInstance}
                      autoFocus={false}
                      sendSettings={sendSettings}
                      onSendSettingsChange={onSendSettingsChange}
                      onPasteFile={onPasteFile}
                      isUploadingFile={isUploadingFile}
                      uploadProgress={uploadProgress}
                      onCancelUpload={onCancelUpload}
                      onOpenWorkflowFile={onOpenWorkflowFile}
                    />
                  </div>

                  {/* キーボードボタン（入力欄の下・メイン列内） */}
                  <div className={s.keyboardArea}>
                    <KeyboardButtons
                      disabled={!isConnected || !currentRepo || !activeInstance}
                      onSendArrowKey={onSendArrowKey}
                      onSendEnter={() => textInputRef.current?.submit()}
                      onSendInterrupt={onSendInterrupt}
                      onSendEscape={onSendEscape}
                      onSendSpace={onSendSpace}
                      onClearAi={onSendClear}
                      onSendResume={onSendResume}
                      onSendUsage={onSendUsage}
                      onSendPreview={onSendPreview}
                      onSendMode={onSendMode}
                      onSendAltT={onSendAltT}
                      onChangeModel={onChangeModel}
                      onSendCommit={onSendCommit}
                      currentProvider={activeInstance?.provider ?? 'claude'}
                      providerInfo={{
                        clearTitle: 'CLI をクリア (/clear)',
                      }}
                      currentRepositoryPath={currentRepo}
                      customButtons={customAiButtons}
                      onExecuteCustomButton={handleSendCommand}
                      onCreateCustomButton={onCreateCustomAiButton}
                      onUpdateCustomButton={onUpdateCustomAiButton}
                      onDeleteCustomButton={onDeleteCustomAiButton}
                    />
                  </div>

                  {/* キューリスト（デスクトップ: プライマリ時のみ。ループ終了バナーがある間も表示） */}
                  {activeInstance?.isPrimary &&
                    (promptQueue.length > 0 || loopEndInfo) && (
                    <div className={s.desktopQueue}>
                      <PromptQueue
                        queue={promptQueue}
                        isProcessing={isQueueProcessing}
                        isPaused={isQueuePaused}
                        currentItemId={currentQueueItemId}
                        onRemove={onRemoveFromQueue}
                        onUpdate={onUpdateQueue}
                        onReorder={onReorderQueue}
                        onPause={onPauseQueue}
                        onResume={onResumeQueue}
                        onReset={onResetQueue}
                        onCancelCurrentItem={onCancelCurrentItem}
                        onForceSend={onForceSend}
                        onRequeue={onRequeueItem}
                        onStopLoop={onStopLoop}
                        onApproveLoop={onApproveLoop}
                        loopEndInfo={loopEndInfo}
                        onDismissLoopEnd={onDismissLoopEnd}
                      />
                    </div>
                  )}

                  {/* キューリスト（モバイル: プライマリ時のみ。ループ終了バナーがある間も表示） */}
                  {activeInstance?.isPrimary &&
                    (promptQueue.length > 0 || loopEndInfo) && (
                    <div className={s.mobileQueue}>
                      <PromptQueue
                        queue={promptQueue}
                        isProcessing={isQueueProcessing}
                        isPaused={isQueuePaused}
                        currentItemId={currentQueueItemId}
                        onRemove={onRemoveFromQueue}
                        onUpdate={onUpdateQueue}
                        onReorder={onReorderQueue}
                        onPause={onPauseQueue}
                        onResume={onResumeQueue}
                        onReset={onResetQueue}
                        onCancelCurrentItem={onCancelCurrentItem}
                        onForceSend={onForceSend}
                        onRequeue={onRequeueItem}
                        onStopLoop={onStopLoop}
                        onApproveLoop={onApproveLoop}
                        loopEndInfo={loopEndInfo}
                        onDismissLoopEnd={onDismissLoopEnd}
                      />
                    </div>
                  )}
                </div>

                {/* 右列：SidePanel（lg 未満では縦積み最下部・全幅） */}
                <div
                  className={`${s.sideCol} ${isSideColCollapsed ? s.sideColCollapsed : ''}`}
                >
                  {currentRepo && currentRid && (
                    <SidePanel
                      currentRepo={currentRepo}
                      rid={currentRid}
                      files={files}
                      onRefreshFiles={onRefreshFiles}
                      onDeleteFile={onDeleteFile}
                      diffSummary={diffSummary}
                      diffSummaryLoading={diffSummaryLoading}
                      diffSummaryError={diffSummaryError}
                      onRefreshDiffSummary={onRefreshDiffSummary}
                      onDiffFileClick={onDiffFileClick}
                      onAnnotateImage={handleAnnotateImage}
                    />
                  )}
                </div>
              </div>
            </div>
          </section>

          {/* ターミナルエリア */}
          <section className={`${s.terminalSection} ${terminals.length > 0 ? s.terminalSectionExpanded : ''}`}>
            <div className={s.sectionHeader}>
              <h2 className={s.sectionTitle}>
                <svg
                  className={s.sectionTitleIconGreen}
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M8 9l3 3-3 3m5 0h3M5 20h14a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"
                  />
                </svg>
                ターミナル
              </h2>
            </div>
            <div className={s.terminalBody}>
              <TerminalManager
                terminals={terminals}
                messages={terminalMessages}
                histories={terminalHistories}
                shortcuts={shortcuts}
                currentRepo={currentRepo}
                isConnected={isConnected}
                isTerminalsLoaded={isTerminalsLoaded}
                onCreateTerminal={onCreateTerminal}
                onTerminalInput={onTerminalInput}
                onTerminalSignal={onTerminalSignal}
                onTerminalResize={onTerminalResize}
                onCloseTerminal={onCloseTerminal}
                onCreateShortcut={onCreateShortcut}
                onDeleteShortcut={onDeleteShortcut}
                onExecuteShortcut={onExecuteShortcut}
                onActiveTerminalChange={onActiveTerminalChange}
                fontSize={terminalFontSize}
              />
            </div>
          </section>
        </div>

        {/* 下部セクション */}
        <div className={s.bottomGrid}>
          <section className={s.bottomSection}>
            <NpmScripts
              repositoryPath={currentRepo}
              scripts={npmScripts}
              isConnected={isConnected}
              onExecuteScript={onExecuteNpmScript}
              onRefreshScripts={onRefreshNpmScripts}
            />
          </section>
        </div>

        <div className={s.deleteCenter}>
          <button
            onClick={() => setShowDeleteConfirm(true)}
            disabled={!isConnected}
            className={s.deleteRepoButton}
          >
            このリポジトリを削除...
          </button>
        </div>
      </main>

      {/* 削除確認ダイアログ */}
      {showDeleteConfirm && (
        <div className={s.dialogOverlay}>
          <div className={s.dialogCard}>
            <div className={s.dialogHeader}>
              <div className={s.dialogIconShrink}>
                <svg
                  className={s.dialogIconRed}
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.732-.833-2.5 0L4.268 16.5c-.77.833.192 2.5 1.732 2.5z"
                  />
                </svg>
              </div>
              <div>
                <h3 className={s.dialogTitle}>
                  リポジトリを削除しますか？
                </h3>
              </div>
            </div>
            <div className={s.dialogBody}>
              <div className={s.dangerBox}>
                <div className={s.dangerFlex}>
                  <div className={s.dangerIconShrink}>
                    <svg
                      className={s.dangerIcon}
                      fill="currentColor"
                      viewBox="0 0 20 20"
                    >
                      <path
                        fillRule="evenodd"
                        d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z"
                        clipRule="evenodd"
                      />
                    </svg>
                  </div>
                  <div className={s.dangerContent}>
                    <h4 className={s.dangerTitle}>
                      注意: この操作は元に戻せません
                    </h4>
                    <div className={s.dangerList}>
                      <ul className={s.dangerListUl}>
                        <li>リポジトリディレクトリ全体が削除されます</li>
                        <li>Claude CLIセッションが終了されます</li>
                        <li>実行中のターミナルが全て終了されます</li>
                        <li>履歴データがすべて消去されます</li>
                      </ul>
                    </div>
                  </div>
                </div>
              </div>
              <div className={s.repoInfoBox}>
                <p className={s.repoInfoName}>
                  {(() => {
                    const repoInfo = repositories.find(
                      (r) => r.path === currentRepo
                    );
                    if (
                      repoInfo?.isWorktree &&
                      repoInfo?.parentRepoName &&
                      repoInfo?.worktreeBranch
                    ) {
                      return `${repoInfo.parentRepoName} / ${repoInfo.worktreeBranch}`;
                    }
                    return currentRepo.split('/').pop();
                  })()}
                </p>
                <p className={s.repoInfoPath}>{currentRepo}</p>
              </div>
            </div>
            <div className={s.dialogActions}>
              <button
                onClick={() => setShowDeleteConfirm(false)}
                className={s.cancelButton}
              >
                キャンセル
              </button>
              <button
                onClick={() => {
                  const repoInfo = repositories.find(
                    (r) => r.path === currentRepo
                  );
                  let repoName: string;
                  if (
                    repoInfo?.isWorktree &&
                    repoInfo?.parentRepoName &&
                    repoInfo?.worktreeBranch
                  ) {
                    repoName = `${repoInfo.parentRepoName} / ${repoInfo.worktreeBranch}`;
                  } else {
                    repoName = currentRepo.split('/').pop() || '';
                  }
                  onDeleteRepository(currentRepo, repoName);
                  setShowDeleteConfirm(false);
                }}
                className={s.deleteButton}
              >
                削除する
              </button>
            </div>
          </div>
        </div>
      )}

      {/* プロセス停止確認ダイアログ */}
      {showStopProcessConfirm && stopProcessTargetRid && (
        <div className={s.dialogOverlay}>
          <div className={s.dialogCard}>
            <div className={s.dialogHeader}>
              <div className={s.dialogIconShrink}>
                <svg
                  className={s.dialogIconOrange}
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                  />
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M9 10a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1h-4a1 1 0 01-1-1v-4z"
                  />
                </svg>
              </div>
              <div>
                <h3 className={s.dialogTitle}>
                  プロセスを停止しますか？
                </h3>
              </div>
            </div>
            <div className={s.dialogBody}>
              <div className={s.warningBox}>
                <div className={s.warningFlex}>
                  <div className={s.warningIconShrink}>
                    <svg
                      className={s.warningIcon}
                      fill="currentColor"
                      viewBox="0 0 20 20"
                    >
                      <path
                        fillRule="evenodd"
                        d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z"
                        clipRule="evenodd"
                      />
                    </svg>
                  </div>
                  <div className={s.warningContent}>
                    <h4 className={s.warningTitle}>
                      以下のプロセスが停止されます
                    </h4>
                    <div className={s.warningList}>
                      <ul className={s.warningListUl}>
                        <li>AI CLI セッション</li>
                        <li>実行中のターミナル</li>
                        <li>差分チェックサーバー</li>
                        <li>プロンプトキュー（一時停止）</li>
                      </ul>
                    </div>
                    <p className={s.warningNote}>
                      ※ リポジトリとデータは保持されます
                    </p>
                  </div>
                </div>
              </div>
              <div className={s.repoInfoBox}>
                <p className={s.repoInfoName}>
                  {(() => {
                    const repoPath =
                      repositoryIdMap.getPath(stopProcessTargetRid);
                    const repoInfo = repositories.find(
                      (r) => r.path === repoPath
                    );
                    if (
                      repoInfo?.isWorktree &&
                      repoInfo?.parentRepoName &&
                      repoInfo?.worktreeBranch
                    ) {
                      return `${repoInfo.parentRepoName} / ${repoInfo.worktreeBranch}`;
                    }
                    return repoInfo?.name || repoPath?.split('/').pop() || '';
                  })()}
                </p>
                <p className={s.repoInfoPath}>
                  {repositoryIdMap.getPath(stopProcessTargetRid)}
                </p>
              </div>
            </div>
            <div className={s.dialogActions}>
              <button
                onClick={onCancelStopProcesses}
                disabled={stoppingProcesses}
                className={s.cancelButton}
              >
                キャンセル
              </button>
              <button
                onClick={onConfirmStopProcesses}
                disabled={stoppingProcesses}
                className={s.stopButton}
              >
                {stoppingProcesses ? (
                  <>
                    <svg
                      className={s.stopSpinner}
                      fill="none"
                      viewBox="0 0 24 24"
                    >
                      <circle
                        className={s.spinnerCircle}
                        cx="12"
                        cy="12"
                        r="10"
                        stroke="currentColor"
                        strokeWidth="4"
                      ></circle>
                      <path
                        className={s.spinnerPath}
                        fill="currentColor"
                        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                      ></path>
                    </svg>
                    停止中...
                  </>
                ) : (
                  '停止する'
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ポップアップブロックモーダル */}
      <PopupBlockedModal
        isOpen={showPopupBlockedModal}
        url={blockedCodeServerUrl}
        onClose={() => setShowPopupBlockedModal(false)}
        onOpenInNewTab={onOpenBlockedUrl}
      />

      {/* リポジトリ切り替えメニュー */}
      <RepositorySwitcher
        repositories={repositories}
        currentRepo={currentRepo}
        repoProcessStatuses={repoProcessStatuses}
        onSwitchRepository={onSwitchRepository}
      />

      {/* ワークツリー削除中オーバーレイ */}
      {isDeletingWorktree && (
        <div className={s.worktreeOverlay}>
          <div className={s.worktreeCard}>
            <div className={s.worktreeSpinnerWrap}>
              <svg
                className={s.worktreeSpinner}
                xmlns="http://www.w3.org/2000/svg"
                fill="none"
                viewBox="0 0 24 24"
              >
                <circle
                  className={s.spinnerCircle}
                  cx="12"
                  cy="12"
                  r="10"
                  stroke="currentColor"
                  strokeWidth="4"
                ></circle>
                <path
                  className={s.spinnerPath}
                  fill="currentColor"
                  d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                ></path>
              </svg>
            </div>
            <p className={s.worktreeTitle}>ワークツリーを削除中...</p>
            <p className={s.worktreeSubtitle}>
              関連するセッション、ターミナル、キューを終了しています
            </p>
            {deletingWorktreePath && (
              <p className={s.worktreePath}>
                {deletingWorktreePath.split('/').pop()}
              </p>
            )}
          </div>
        </div>
      )}

      {/* 赤入れキャンバス（Lightbox の赤入れボタンから開く） */}
      <DrawingCanvas
        isOpen={annotateImageUrl !== null}
        backgroundImageUrl={annotateImageUrl}
        onClose={() => setAnnotateImageUrl(null)}
        onComplete={handleAnnotateComplete}
      />
    </div>
  );
}
