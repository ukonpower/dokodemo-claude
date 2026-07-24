import { useRef, useCallback, useState, useEffect } from 'react';
import {
  LayoutDashboard,
  PanelRightClose,
  PanelRightOpen,
  Terminal,
  AlertTriangle,
  CircleStop,
  Loader2,
} from 'lucide-react';
import Button from '@/shared/components/Button';
import IconButton from '@/shared/components/IconButton';
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

  // ワークツリー関連（削除中オーバーレイ表示・BranchSelector への受け渡し用）
  const { isDeletingWorktree, deletingWorktreePath, worktrees } =
    useWorktreeContext();

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
              <BranchSelector worktrees={worktrees} />
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
                <IconButton
                  size="xs"
                  className={s.sideColToggle}
                  onClick={handleToggleSideCol}
                  label={
                    isSideColCollapsed
                      ? '送信・受信パネルを表示'
                      : '送信・受信パネルを畳んで CLI を広げる'
                  }
                  aria-pressed={isSideColCollapsed}
                >
                  {isSideColCollapsed ? (
                    <PanelRightOpen />
                  ) : (
                    <PanelRightClose />
                  )}
                </IconButton>
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
                <Terminal className={s.sectionTitleIcon} />
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
                <AlertTriangle className={s.dialogIconRed} />
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
                    <AlertTriangle className={s.dangerIcon} />
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
              <Button
                variant="ghost"
                className={s.dialogActionButton}
                onClick={() => setShowDeleteConfirm(false)}
              >
                キャンセル
              </Button>
              <Button
                variant="danger"
                className={s.dialogActionButton}
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
              >
                削除する
              </Button>
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
                <CircleStop className={s.dialogIconOrange} />
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
                    <AlertTriangle className={s.warningIcon} />
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
              <Button
                variant="ghost"
                className={s.dialogActionButton}
                onClick={onCancelStopProcesses}
                disabled={stoppingProcesses}
              >
                キャンセル
              </Button>
              <Button
                variant="primary"
                className={s.dialogActionButton}
                onClick={onConfirmStopProcesses}
                disabled={stoppingProcesses}
              >
                {stoppingProcesses ? (
                  <>
                    <Loader2 className={s.stopSpinner} />
                    停止中...
                  </>
                ) : (
                  '停止する'
                )}
              </Button>
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
              <Loader2 className={s.worktreeSpinner} />
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
