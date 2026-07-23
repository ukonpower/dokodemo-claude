import type { GitRepository, RepoProcessStatus } from '@/types';
import { repositoryIdMap } from '@/utils/repository-id-map';

import RepositoryManager from '@/components/repo/RepositoryManager';
import RepositorySwitcher from '@/components/repo/RepositorySwitcher';
import s from './HomeView.module.scss';

interface HomeViewProps {
  // 接続状態
  isConnected: boolean;
  connectionAttempts: number;
  isReconnecting: boolean;

  // リポジトリ関連（repositories はサーバー側でソート済み）
  repositories: GitRepository[];
  currentRepo: string;
  repoProcessStatuses: RepoProcessStatus[];

  // リポジトリアクション
  onCloneRepository: (url: string, name: string) => void;
  onCreateRepository: (name: string) => void;
  onStopProcesses: (rid: string) => void;
  onSwitchRepository: (path: string) => void;
  onPullSelf: () => void;
  selfUpdateAvailable: boolean;

  // 設定ページへの遷移
  onOpenSettings: () => void;

  // ローディング状態
  isSwitchingRepo: boolean;

  // プロセス停止確認ダイアログ
  showStopProcessConfirm: boolean;
  stoppingProcesses: boolean;
  stopProcessTargetRid: string | null;
  onConfirmStopProcesses: () => void;
  onCancelStopProcesses: () => void;

}

export function HomeView({
  isConnected,
  connectionAttempts,
  isReconnecting,
  repositories,
  currentRepo,
  repoProcessStatuses,
  onCloneRepository,
  onCreateRepository,
  onStopProcesses,
  onSwitchRepository,
  onPullSelf,
  selfUpdateAvailable,
  onOpenSettings,
  isSwitchingRepo,
  showStopProcessConfirm,
  stoppingProcesses,
  stopProcessTargetRid,
  onConfirmStopProcesses,
  onCancelStopProcesses,
}: HomeViewProps) {
  const useHttps = import.meta.env.DC_USE_HTTPS !== 'false';
  // 同一オリジン (dev: Vite proxy / prod: Express 統合配信) で配信
  const certDownloadUrl = '/api/cert';

  return (
    <div className={`${s.root} ${repositories.length > 0 ? s.hasSwitcher : ''}`}>
      <div className={s.wrapper}>
        {/* ヘッダー */}
        <header className={s.header}>
          <div className={s.headerInner}>
            <div className={s.headerContent}>
              <div className={s.headerLeft}>
                <div>
                  <h1 className={s.headerTitle}>
                    dokodemo-claude
                  </h1>
                  <p className={s.headerSubtitle}>
                    Claude Code CLI Web Interface
                  </p>
                </div>
                {/* dokodemo-claude自身を更新ボタン */}
                <button
                  onClick={onPullSelf}
                  className={s.updateButton}
                  title={
                    selfUpdateAvailable
                      ? '新しいリリースがあります。クリックで最新版に更新 (git pull)'
                      : 'dokodemo-claude自身を最新版に更新 (git pull)'
                  }
                >
                  <svg
                    className={s.updateIcon}
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
                  <span>更新</span>
                  {selfUpdateAvailable && <span className={s.updateBadge} />}
                </button>
              </div>
              <div className={s.headerRight}>
                {/* 設定ボタン */}
                <button
                  onClick={onOpenSettings}
                  className={s.iconButton}
                  title="設定"
                >
                  <svg
                    className={s.iconSettings}
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
                <div className={s.connectionStatus}>
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
                </div>
              </div>
            </div>
          </div>
        </header>

        {/* メインコンテンツ */}
        <main className={s.main}>
          <div className={s.mainInner}>
            {/* サーバー情報セクション */}
            <div className={s.serverInfo}>
              {/* 上段: 接続状態・ポート情報 */}
              <div className={s.serverInfoRow}>
                {/* 接続状態 */}
                <div className={s.serverInfoItem}>
                  <div
                    className={`${s.statusDot} ${isConnected ? s.statusConnected : s.statusDisconnected}`}
                  />
                  <span className={s.serverLabel}>
                    {isConnected ? '接続中' : '未接続'}
                  </span>
                </div>

                <div className={s.serverInfoItem}>
                  <span className={s.serverLabel}>Host:</span>
                  <span className={s.serverValue}>
                    {window.location.hostname}
                  </span>
                </div>

                <div className={s.serverInfoItem}>
                  <span className={s.serverLabel}>Port:</span>
                  <span className={s.serverValue}>
                    {window.location.port ||
                      (window.location.protocol === 'https:' ? '443' : '80')}
                  </span>
                </div>

                {useHttps && (
                  <div className={s.serverInfoItem}>
                    <a
                      href={certDownloadUrl}
                      className={s.certLink}
                      title="証明書をダウンロード"
                    >
                      証明書ダウンロード
                    </a>
                  </div>
                )}
              </div>
            </div>

            <div className={s.repoManagerCard}>
              <div className={s.repoManagerInner}>
                <RepositoryManager
                  repositories={repositories}
                  currentRepo={currentRepo}
                  repoProcessStatuses={repoProcessStatuses}
                  onCloneRepository={onCloneRepository}
                  onCreateRepository={onCreateRepository}
                  onStopProcesses={onStopProcesses}
                  onSwitchRepository={onSwitchRepository}
                  isConnected={isConnected}
                />
              </div>
            </div>
          </div>
        </main>

        {/* リポジトリ切り替え中のローディングオーバーレイ */}
        {isSwitchingRepo && (
          <div className={s.loadingOverlay}>
            <div className={s.loadingCard}>
              <div className={s.loadingContent}>
                <svg
                  className={s.spinner}
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
                <div className={s.loadingTextCenter}>
                  <h3 className={s.loadingTitle}>
                    リポジトリを切り替えています
                  </h3>
                  <p className={s.loadingSubtitle}>
                    Claude CLIセッションを準備中です...
                  </p>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* リポジトリ切り替えメニュー（画面下部固定） */}
        <RepositorySwitcher
          repositories={repositories}
          currentRepo={currentRepo}
          repoProcessStatuses={repoProcessStatuses}
          onSwitchRepository={onSwitchRepository}
        />
      </div>

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

    </div>
  );
}
