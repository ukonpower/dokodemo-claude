import { useRef, useCallback, useState, useEffect } from 'react';
import {
  LayoutDashboard,
  PanelRightClose,
  PanelRightOpen,
} from 'lucide-react';
import { repositoryIdMap } from '@/shared/utils/repository-id-map';
import { useSocketContext } from '@/app/providers/SocketProvider';
import { useRepositoryContext } from '@/features/repo/providers/RepositoryProvider';
import { useAppSettingsContext } from '@/app/providers/AppSettingsProvider';
import { useAiContext } from '@/features/ai/providers/AiProvider';
import { useTerminalContext } from '@/features/terminal/providers/TerminalProvider';
import { useWorktreeContext } from '@/features/worktree/providers/WorktreeProvider';
import { useQueueContext } from '@/features/ai/providers/QueueProvider';
import { useFileManagerContext } from '@/features/files/providers/FilesProvider';
import { useEditorLauncherContext } from '@/features/repo/providers/EditorLauncherProvider';
import { useNavigationContext } from '@/app/providers/NavigationProvider';
import { openWorkflowFileTab } from '@/app/utils/open-views';

import AiOutput, { AiOutputRef } from '@/features/ai/components/AiOutput';
import TextInput, { TextInputRef } from '@/features/ai/components/CommandInput';
import { KeyboardButtons } from '@/features/ai/components/KeyboardButtons';
import TerminalManager from '@/features/terminal/components/TerminalManager';
import BranchSelector from '@/features/git/components/BranchSelector';
import NpmScripts from '@/features/terminal/components/NpmScripts';
import { PopupBlockedModal } from '@/shared/components/PopupBlockedModal';
import RepoHeader from '@/features/repo/components/RepoHeader';
import RepositorySwitcher from '@/features/repo/components/RepositorySwitcher';
import WorktreeTabs from '@/features/worktree/components/WorktreeTabs';
import WorktreeOperations from '@/features/worktree/components/WorktreeOperations';
import PromptQueue from '@/features/ai/components/PromptQueue';
import SidePanel from '@/features/files/components/SidePanel';
import AiInstanceTabs from '@/features/ai/components/AiInstanceTabs';
import DrawingCanvas from '@/features/ai/components/DrawingCanvas';
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

export function ProjectView() {
  // 接続状態
  const { isConnected } = useSocketContext();

  // リポジトリ関連（repositories はサーバー側でソート済み）
  const { repository } = useRepositoryContext();
  const {
    repositories,
    currentRepo,
    // リポジトリ操作
    showDeleteConfirm,
    setShowDeleteConfirm,
    deleteRepository: onDeleteRepository,
    // プロセス停止
    showStopProcessConfirm,
    stoppingProcesses,
    stopProcessTargetRid,
    confirmStopProcesses: onConfirmStopProcesses,
    cancelStopProcesses: onCancelStopProcesses,
  } = repository;

  // 設定関連
  const { sendSettings, setSendSettings: onSendSettingsChange } =
    useAppSettingsContext();

  // AI CLI関連
  const { aiCli, aiInstanceTabsRef } = useAiContext();
  const {
    activeInstance,
    // AIアクション（active instance に対する操作）
    sendCommand: onSendCommand,
    sendEscape: onSendEscape,
  } = aiCli;

  // ターミナル関連（ターミナル数はセクションの高さ切替に使用）
  const { terminal } = useTerminalContext();
  const { terminals } = terminal;

  // ブランチ・ワークツリー関連（削除中オーバーレイ表示用）
  const { isDeletingWorktree, deletingWorktreePath } = useWorktreeContext();

  // プロンプトキュー関連（キューの有無はキューリストの表示切替に使用）
  const {
    promptQueue,
    addToQueue: onAddToQueue,
    loopEndInfo,
  } = useQueueContext();

  // ファイル管理関連
  const {
    isUploadingFile,
    uploadProgress,
    cancelUpload: onCancelUpload,
    uploadFile: onPasteFile,
  } = useFileManagerContext();

  // エディタ関連（ポップアップブロックモーダル用）
  const {
    showPopupBlockedModal,
    blockedCodeServerUrl,
    setShowPopupBlockedModal,
    openBlockedUrl: onOpenBlockedUrl,
  } = useEditorLauncherContext();

  // ダッシュボード切替
  const { setDashboardModeAndPersist } = useNavigationContext();
  const onOpenDashboard = () => setDashboardModeAndPersist(true);

  // ワークフローファイルを別タブで開く
  const onOpenWorkflowFile = openWorkflowFileTab;
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
      <RepoHeader />

      {/* メインコンテンツ */}
      <main className={s.main}>
        {/* 縦並びレイアウト: AI CLI & ターミナル */}
        <div className={s.topLayout}>
          {/* ブランチセレクター + ワークツリータブ（Claude CLIの上） */}
          <div className={s.branchBar}>
            {/* ブランチセレクター */}
            <div className={s.branchSelectorWrap}>
              <BranchSelector />
            </div>
            {/* ワークツリータブ */}
            {currentRepo && (
              <>
                <div className={s.branchDivider} />
                <WorktreeTabs compact={true} />
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
          <WorktreeOperations />

          {/* AI CLI セクション */}
          <section className={s.cliSection}>
            <div className={s.cliTabBar}>
              <div className={s.cliTabsScroll}>
                <AiInstanceTabs ref={aiInstanceTabsRef} />
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
                      onSendEnter={() => textInputRef.current?.submit()}
                      onExecuteCustomButton={handleSendCommand}
                    />
                  </div>

                  {/* キューリスト（デスクトップ: プライマリ時のみ。ループ終了バナーがある間も表示） */}
                  {activeInstance?.isPrimary &&
                    (promptQueue.length > 0 || loopEndInfo) && (
                    <div className={s.desktopQueue}>
                      <PromptQueue />
                    </div>
                  )}

                  {/* キューリスト（モバイル: プライマリ時のみ。ループ終了バナーがある間も表示） */}
                  {activeInstance?.isPrimary &&
                    (promptQueue.length > 0 || loopEndInfo) && (
                    <div className={s.mobileQueue}>
                      <PromptQueue />
                    </div>
                  )}
                </div>

                {/* 右列：SidePanel（lg 未満では縦積み最下部・全幅） */}
                <div
                  className={`${s.sideCol} ${isSideColCollapsed ? s.sideColCollapsed : ''}`}
                >
                  {currentRepo && currentRid && (
                    <SidePanel onAnnotateImage={handleAnnotateImage} />
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
              <TerminalManager />
            </div>
          </section>
        </div>

        {/* 下部セクション */}
        <div className={s.bottomGrid}>
          <section className={s.bottomSection}>
            <NpmScripts />
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
      <RepositorySwitcher />

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
