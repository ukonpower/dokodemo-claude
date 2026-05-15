import { useState, useRef, useCallback } from 'react';
import { FolderOpen } from 'lucide-react';
import { Socket } from 'socket.io-client';
import type {
  GitRepository,
  GitBranch,
  GitWorktree,
  Terminal,
  TerminalMessage,
  TerminalOutputLine,
  AiOutputLine,
  CommandShortcut,
  AiProvider,
  EditorInfo,
  EditorType,
  PromptQueueItem,
  UploadedFileInfo,
  GitDiffSummary,
  ServerToClientEvents,
  ClientToServerEvents,
  RepoProcessStatus,
  CustomAiButton,
  CustomAiButtonScope,
} from '../types';
import { repositoryIdMap } from '../utils/repository-id-map';
import type { CommandSendSettings } from '../hooks/useAppSettings';

import AiOutput, { AiOutputRef } from '../components/AiOutput';
import TextInput, { TextInputRef } from '../components/CommandInput';
import { KeyboardButtons } from '../components/KeyboardButtons';
import TerminalManager from '../components/TerminalManager';
import BranchSelector from '../components/BranchSelector';
import NpmScripts from '../components/NpmScripts';
import { PopupBlockedModal } from '../components/PopupBlockedModal';
import RepositorySwitcher from '../components/RepositorySwitcher';
import WorktreeTabs from '../components/WorktreeTabs';
import WorktreeOperations from '../components/WorktreeOperations';
import SettingsModal, { AppSettings } from '../components/SettingsModal';
import PromptQueue from '../components/PromptQueue';
import TabbedPanel from '../components/TabbedPanel';
import s from './ProjectView.module.scss';

interface ProjectViewProps {
  // Socket
  socket: Socket<ServerToClientEvents, ClientToServerEvents> | null;

  // 接続状態
  isConnected: boolean;
  connectionAttempts: number;
  isReconnecting: boolean;

  // リポジトリ関連
  repositories: GitRepository[];
  currentRepo: string;
  lastAccessTimes: Record<string, number>;
  repoProcessStatuses: RepoProcessStatus[];
  currentSessionId: string;

  // AI CLI関連
  currentAiMessages: AiOutputLine[];
  currentProvider: AiProvider;
  isLoadingRepoData: boolean;
  terminalFontSize: number;

  // AIアクション
  onSendCommand: (command: string) => void;
  onSendArrowKey: (direction: 'up' | 'down' | 'left' | 'right') => void;
  onSendAltT: () => void;
  onSendInterrupt: () => void;
  onSendEscape: () => void;
  onSendClear: () => void;
  onSendCommit: () => void;
  onSendPreview: () => void;
  onSendResume: () => void;
  onSendUsage: () => void;
  onSendMode: () => void;
  onChangeModel: (model: 'default' | 'Opus' | 'Sonnet' | 'OpusPlan') => void;
  onChangeProvider: (provider: AiProvider) => void;
  onRestartCli: () => void;
  onClearHistory: () => void;
  onKeyInput: (key: string) => void;
  onResize: (cols: number, rows: number) => void;
  onReload: (cols: number, rows: number) => void;

  // ターミナル関連
  terminals: Terminal[];
  activeTerminalId: string;
  terminalMessages: TerminalMessage[];
  terminalHistories: Map<string, TerminalOutputLine[]>;
  isTerminalsLoaded: boolean;
  shortcuts: CommandShortcut[];
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
  isDeletingWorktree: boolean;
  deletingWorktreePath: string | null;
  onSwitchBranch: (branchName: string) => void;
  onDeleteBranch: (branchName: string, deleteRemote?: boolean) => void;
  onCreateBranch: (branchName: string, baseBranch?: string) => void;
  onRefreshBranches: () => void;
  onPullBranch: () => void;
  isPulling: boolean;
  pullError: { message: string; output?: string } | null;
  onClearPullError: () => void;
  onCreateWorktree: (
    branchName: string,
    baseBranch?: string,
    useExisting?: boolean
  ) => void;
  onDeleteWorktree: (worktreePath: string, deleteBranch?: boolean) => void;
  onMergeWorktree: (worktreePath: string) => void;
  onClearMergeError: () => void;

  // プロンプトキュー関連
  promptQueue: PromptQueueItem[];
  isQueueProcessing: boolean;
  isQueuePaused: boolean;
  onAddToQueue: (
    command: string,
    sendClearBefore: boolean,
    sendCommitAfter: boolean,
    model?: string
  ) => void;
  onRemoveFromQueue: (itemId: string) => void;
  onUpdateQueue: (
    itemId: string,
    prompt: string,
    sendClearBefore: boolean,
    isAutoCommit: boolean,
    model?: string
  ) => void;
  onPauseQueue: () => void;
  onResumeQueue: () => void;
  onResetQueue: () => void;
  onCancelCurrentItem: () => void;
  onForceSend: (itemId: string) => void;
  onReorderQueue: (reorderedQueue: PromptQueueItem[]) => void;
  onRequeueItem: (itemId: string) => void;

  // ファイル管理関連
  files: UploadedFileInfo[];
  isUploadingFile: boolean;
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
  onStartCodeServer: () => void;
  setShowEditorMenu: (show: boolean) => void;
  setShowPopupBlockedModal: (show: boolean) => void;
  onOpenBlockedUrl: () => void;

  // 設定関連
  appSettings: AppSettings;
  showSettingsModal: boolean;
  setShowSettingsModal: (show: boolean) => void;
  onSettingsChange: (settings: AppSettings) => void;
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
}

export function ProjectView({
  socket,
  isConnected,
  connectionAttempts,
  isReconnecting,
  repositories,
  currentRepo,
  lastAccessTimes,
  repoProcessStatuses,
  currentSessionId,
  currentAiMessages,
  currentProvider,
  isLoadingRepoData,
  terminalFontSize,
  onSendCommand,
  onSendArrowKey,
  onSendAltT,
  onSendInterrupt,
  onSendEscape,
  onSendClear,
  onSendCommit,
  onSendPreview,
  onSendResume,
  onSendUsage,
  onSendMode,
  onChangeModel,
  onChangeProvider,
  onRestartCli,
  onClearHistory,
  onKeyInput,
  onResize,
  onReload,
  terminals,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  activeTerminalId: _activeTerminalId,
  terminalMessages,
  terminalHistories,
  isTerminalsLoaded,
  shortcuts,
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
  isDeletingWorktree,
  deletingWorktreePath,
  onSwitchBranch,
  onDeleteBranch,
  onCreateBranch,
  onRefreshBranches,
  onPullBranch,
  isPulling,
  pullError,
  onClearPullError,
  onCreateWorktree,
  onDeleteWorktree,
  onMergeWorktree,
  onClearMergeError,
  promptQueue,
  isQueueProcessing,
  isQueuePaused,
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
  files,
  isUploadingFile,
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
  onStartCodeServer,
  setShowEditorMenu,
  setShowPopupBlockedModal,
  onOpenBlockedUrl,
  appSettings,
  showSettingsModal,
  setShowSettingsModal,
  onSettingsChange,
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
}: ProjectViewProps) {
  // Refs
  const textInputRef = useRef<TextInputRef>(null);
  const aiOutputRef = useRef<AiOutputRef>(null);

  // クリップボードコピー状態
  const [copiedPath, setCopiedPath] = useState(false);

  // ハンドラ
  const handleSendCommand = useCallback(
    (command: string) => {
      onSendCommand(command);
      aiOutputRef.current?.scrollToBottom();
    },
    [onSendCommand]
  );

  const handleAddToQueue = useCallback(
    (
      command: string,
      sendClearBefore: boolean,
      sendCommitAfter: boolean,
      model?: string
    ) => {
      onAddToQueue(command, sendClearBefore, sendCommitAfter, model);
      aiOutputRef.current?.scrollToBottom();
    },
    [onAddToQueue]
  );

  const currentRid = repositoryIdMap.getRid(currentRepo);

  return (
    <div className={s.root}>
      {/* ヘッダー */}
      <header className={s.header}>
        <div className={s.headerInner}>
          <div className={s.headerRow}>
            {/* 左グループ: 戻るボタン + リポジトリ名 */}
            <div className={s.headerLeft}>
              <a
                href={window.location.pathname}
                className={`btn-icon ${s.backLink}`}
                title="リポジトリ選択へ戻る"
              >
                <svg
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M15 19l-7-7 7-7"
                  />
                </svg>
              </a>
              <div className={s.repoInfo}>
                <div className={s.repoTitleRow}>
                  <h1
                    className={s.repoTitle}
                    title={copiedPath ? 'コピーしました!' : `クリックしてパスをコピー: ${currentRepo}`}
                    onClick={() => {
                      navigator.clipboard.writeText(currentRepo).then(() => {
                        setCopiedPath(true);
                        setTimeout(() => setCopiedPath(false), 2000);
                      });
                    }}
                  >
                    {copiedPath ? (
                      <span className={s.copiedText}>コピーしました!</span>
                    ) : (() => {
                      const matchedWorktree = worktrees.find(
                        (wt: GitWorktree) =>
                          wt.path === currentRepo && wt.path !== parentRepoPath
                      );

                      if (matchedWorktree) {
                        const parentName =
                          parentRepoPath.split('/').filter(Boolean).pop() ||
                          'Repository';
                        return `${parentName} - ${matchedWorktree.branch}`;
                      } else {
                        return currentRepo.split('/').pop() || 'プロジェクト';
                      }
                    })()}
                  </h1>
                  {remoteUrl && (
                    <button
                      onClick={() => window.open(remoteUrl, '_blank')}
                      className={`btn-icon-xs ${s.githubButton}`}
                      title="GitHubで開く"
                    >
                      <svg
                        fill="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z" />
                      </svg>
                    </button>
                  )}
                </div>
                <p className={s.repoPath}>
                  {currentRepo}
                </p>
              </div>
            </div>

            {/* 右グループ: ツールバー + 設定 + 接続状態 */}
            <div className={s.headerRight}>
              {/* ツールボタン */}
              <div className={s.toolButtons}>
                {/* ファイルビュワー */}
                <button
                  onClick={onOpenFileViewer}
                  disabled={!isConnected}
                  className={`btn-icon ${s.fileViewerButton}`}
                  title="ファイルを開く"
                >
                  <FolderOpen size={16} />
                </button>

                {/* エディタ起動ドロップダウン (localhostアクセス時のみ表示) */}
                {isLocalhost && (
                  <div className={s.editorDropdownWrapper} ref={editorMenuRef}>
                    <button
                      onClick={() => setShowEditorMenu(!showEditorMenu)}
                      disabled={!isConnected}
                      className={`btn-icon ${s.editorButton}`}
                      title="エディタで開く"
                    >
                      <svg
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2}
                          d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4"
                        />
                      </svg>
                    </button>

                    {showEditorMenu && availableEditors.length > 0 && (
                      <div className={s.editorDropdown}>
                        <div className={s.editorDropdownList}>
                          {availableEditors.map((editor) => (
                            <button
                              key={editor.id}
                              onClick={() => onOpenInEditor(editor.id)}
                              className={`${s.editorItem} ${
                                editor.id === 'vscode'
                                  ? s.editorItemVscode
                                  : s.editorItemCursor
                              }`}
                            >
                              {editor.id === 'vscode' ? (
                                <svg
                                  className={`${s.editorItemIcon} ${s.editorIconVscode}`}
                                  fill="currentColor"
                                  viewBox="0 0 24 24"
                                >
                                  <path d="M23.15 2.587L18.21.21a1.494 1.494 0 0 0-1.705.29l-9.46 8.63-4.12-3.128a.999.999 0 0 0-1.276.057L.327 7.261A1 1 0 0 0 .326 8.74L3.899 12 .326 15.26a1 1 0 0 0 .001 1.479L1.65 17.94a.999.999 0 0 0 1.276.057l4.12-3.128 9.46 8.63a1.492 1.492 0 0 0 1.704.29l4.942-2.377A1.5 1.5 0 0 0 24 20.06V3.939a1.5 1.5 0 0 0-.85-1.352zm-5.146 14.861L10.826 12l7.178-5.448v10.896z" />
                                </svg>
                              ) : (
                                <svg
                                  className={`${s.editorItemIcon} ${s.editorIconCursor}`}
                                  fill="currentColor"
                                  viewBox="0 0 24 24"
                                >
                                  <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 17.93c-3.95-.49-7-3.85-7-7.93 0-.62.08-1.21.21-1.79L9 15v1c0 1.1.9 2 2 2v1.93zm6.9-2.54c-.26-.81-1-1.39-1.9-1.39h-1v-3c0-.55-.45-1-1-1H8v-2h2c.55 0 1-.45 1-1V7h2c1.1 0 2-.9 2-2v-.41c2.93 1.19 5 4.06 5 7.41 0 2.08-.8 3.97-2.1 5.39z" />
                                </svg>
                              )}
                              {editor.name}
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {/* code-serverボタン */}
                <button
                  onClick={onStartCodeServer}
                  disabled={!isConnected || startingCodeServer}
                  className={`btn-icon ${s.codeServerButton}`}
                  title="code-server（ブラウザでVS Code起動）"
                >
                  {startingCodeServer ? (
                    <svg
                      className={s.spinnerAnimation}
                      fill="none"
                      viewBox="0 0 24 24"
                    >
                      <circle
                        className={s.opacity25}
                        cx="12"
                        cy="12"
                        r="10"
                        stroke="currentColor"
                        strokeWidth="4"
                      />
                      <path
                        className={s.opacity75}
                        fill="currentColor"
                        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                      />
                    </svg>
                  ) : (
                    <svg
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"
                      />
                    </svg>
                  )}
                </button>

              </div>

              <button
                onClick={() => setShowSettingsModal(true)}
                className="btn-icon"
                title="設定"
              >
                <svg
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
              </button>
              <div className={s.connectionInfo}>
                <div
                  className={`${s.statusDot} ${
                    isConnected
                      ? s.statusConnected
                      : isReconnecting
                        ? s.statusReconnecting
                        : s.statusDisconnected
                  }`}
                ></div>
                <span className={s.statusText}>
                  {isConnected
                    ? '接続中'
                    : isReconnecting
                      ? `再接続中 (${connectionAttempts})`
                      : '未接続'}
                </span>
                {currentSessionId && (
                  <span className={s.sessionId}>
                    #{currentSessionId.split('-')[1]}
                  </span>
                )}
              </div>
            </div>
          </div>
        </div>
      </header>

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
                isPulling={isPulling}
                pullError={pullError}
                onClearPullError={onClearPullError}
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
                  onDeleteWorktree={onDeleteWorktree}
                  onMergeWorktree={onMergeWorktree}
                  onSwitchRepository={onSwitchRepository}
                  isConnected={isConnected}
                  branches={branches}
                  isDeletingWorktree={isDeletingWorktree}
                  compact={true}
                />
              </>
            )}
          </div>

          {/* Claude CLI セクション */}
          <section className={s.cliSection}>
            <div className={s.sectionHeader}>
              <h2 className={s.sectionTitle}>
                <svg
                  className={s.sectionTitleIcon}
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
                Claude CLI
              </h2>
              <button
                onClick={onRestartCli}
                disabled={!currentRepo || !isConnected}
                className={`btn-icon-xs ${s.restartCliButton}`}
                title="AI CLIセッションを再起動"
              >
                <svg
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
                  />
                </svg>
              </button>
            </div>

            <div className={s.cliBody}>
              <div className={s.cliInnerRow}>
                <div className={s.cliMainCol}>
                  <div className={s.cliOutputWrapper}>
                    <AiOutput
                      ref={aiOutputRef}
                      key={`${currentRepo}:${currentProvider}`}
                      messages={currentAiMessages}
                      currentProvider={currentProvider}
                      isLoading={isLoadingRepoData}
                      onKeyInput={onKeyInput}
                      onResize={onResize}
                      onReload={onReload}
                      onClearHistory={onClearHistory}
                      onProviderChange={onChangeProvider}
                      fontSize={terminalFontSize}
                    />
                  </div>

                  <div className={s.cliInputWrapper}>
                    <TextInput
                      ref={textInputRef}
                      onSendCommand={handleSendCommand}
                      onSendEscape={onSendEscape}
                      onAddToQueue={handleAddToQueue}
                      currentProvider={currentProvider}
                      currentRepository={currentRepo}
                      disabled={!isConnected || !currentRepo}
                      autoFocus={false}
                      sendSettings={sendSettings}
                      onSendSettingsChange={onSendSettingsChange}
                      onPasteFile={onPasteFile}
                      isUploadingFile={isUploadingFile}
                      onOpenWorkflowFile={onOpenWorkflowFile}
                    />
                  </div>
                  {/* キューリスト（デスクトップ: テキスト入力の下に表示） */}
                  {promptQueue.length > 0 && (
                    <div className={s.desktopQueue}>
                      <PromptQueue
                        queue={promptQueue}
                        isProcessing={isQueueProcessing}
                        isPaused={isQueuePaused}
                        onRemove={onRemoveFromQueue}
                        onUpdate={onUpdateQueue}
                        onReorder={onReorderQueue}
                        onPause={onPauseQueue}
                        onResume={onResumeQueue}
                        onReset={onResetQueue}
                        onCancelCurrentItem={onCancelCurrentItem}
                        onForceSend={onForceSend}
                        onRequeue={onRequeueItem}
                      />
                    </div>
                  )}
                </div>

                <div className={s.sideCol}>
                  <KeyboardButtons
                    disabled={!isConnected || !currentRepo}
                    onSendArrowKey={onSendArrowKey}
                    onSendEnter={() => textInputRef.current?.submit()}
                    onSendInterrupt={onSendInterrupt}
                    onSendEscape={onSendEscape}
                    onClearAi={onSendClear}
                    onSendResume={onSendResume}
                    onSendUsage={onSendUsage}
                    onSendPreview={onSendPreview}
                    onSendMode={onSendMode}
                    onSendAltT={onSendAltT}
                    onChangeModel={onChangeModel}
                    onSendCommit={onSendCommit}
                    currentProvider={currentProvider}
                    providerInfo={{
                      clearTitle: 'Claude CLIをクリア (/clear)',
                    }}
                    currentRepositoryPath={currentRepo}
                    customButtons={customAiButtons}
                    onExecuteCustomButton={handleSendCommand}
                    onCreateCustomButton={onCreateCustomAiButton}
                    onUpdateCustomButton={onUpdateCustomAiButton}
                    onDeleteCustomButton={onDeleteCustomAiButton}
                  />
                </div>

                {/* キューリスト（モバイル: 操作ボタンの下に表示） */}
                {promptQueue.length > 0 && (
                  <div className={s.mobileQueue}>
                    <PromptQueue
                      queue={promptQueue}
                      isProcessing={isQueueProcessing}
                      isPaused={isQueuePaused}
                      onRemove={onRemoveFromQueue}
                      onUpdate={onUpdateQueue}
                      onReorder={onReorderQueue}
                      onPause={onPauseQueue}
                      onResume={onResumeQueue}
                      onReset={onResetQueue}
                      onCancelCurrentItem={onCancelCurrentItem}
                      onForceSend={onForceSend}
                      onRequeue={onRequeueItem}
                    />
                  </div>
                )}
              </div>


              {currentRepo && currentRid && (
                <div className={s.panelArea}>
                  <TabbedPanel
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
                  />
                </div>
              )}
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

      {/* 設定モーダル */}
      <SettingsModal
        isOpen={showSettingsModal}
        settings={appSettings}
        onClose={() => setShowSettingsModal(false)}
        onSettingsChange={onSettingsChange}
        socket={socket}
        currentRepo={currentRepo}
      />

      {/* ワークツリー操作セクション */}
      {(() => {
        const normalizedCurrentRepo = currentRepo.replace(/\/+$/, '');
        const matchedWorktree = worktrees.find(
          (w) => w.path.replace(/\/+$/, '') === normalizedCurrentRepo
        );
        return (
          <WorktreeOperations
            currentWorktree={matchedWorktree}
            onDeleteWorktree={onDeleteWorktree}
            onMergeWorktree={onMergeWorktree}
            isConnected={isConnected}
            mergeError={mergeError}
            onClearMergeError={onClearMergeError}
            isDeletingWorktree={isDeletingWorktree}
          />
        );
      })()}

      {/* リポジトリ切り替えメニュー */}
      <RepositorySwitcher
        repositories={repositories}
        currentRepo={currentRepo}
        lastAccessTimes={lastAccessTimes}
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
    </div>
  );
}
