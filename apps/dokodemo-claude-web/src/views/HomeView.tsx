import { RefreshCw, Settings, CircleStop, AlertTriangle, Loader2 } from 'lucide-react';
import Button from '@/shared/components/Button';
import IconButton from '@/shared/components/IconButton';
import { repositoryIdMap } from '@/shared/utils/repository-id-map';
import { useSocketContext } from '@/app/providers/SocketProvider';
import { useRepositoryContext } from '@/features/repo/providers/RepositoryProvider';
import { useNavigationContext } from '@/app/providers/NavigationProvider';

import RepositoryManager from '@/features/repo/components/RepositoryManager';
import RepositorySwitcher from '@/features/repo/components/RepositorySwitcher';
import s from './HomeView.module.scss';

export function HomeView() {
  // 接続状態
  const { isConnected, connectionAttempts, isReconnecting } =
    useSocketContext();

  // リポジトリ関連（repositories はサーバー側でソート済み）
  const { repository } = useRepositoryContext();
  const {
    repositories,
    // リポジトリアクション
    pullSelf: onPullSelf,
    selfUpdateAvailable,
    // ローディング状態
    isSwitchingRepo,
    // プロセス停止確認ダイアログ
    showStopProcessConfirm,
    stoppingProcesses,
    stopProcessTargetRid,
    confirmStopProcesses: onConfirmStopProcesses,
    cancelStopProcesses: onCancelStopProcesses,
  } = repository;

  // 設定ページへの遷移
  const { openSettings: onOpenSettings } = useNavigationContext();

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
                  <RefreshCw className={s.updateIcon} />
                  <span>更新</span>
                  {selfUpdateAvailable && <span className={s.updateBadge} />}
                </button>
              </div>
              <div className={s.headerRight}>
                {/* 設定ボタン */}
                <IconButton label="設定" onClick={onOpenSettings}>
                  <Settings />
                </IconButton>
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
                <RepositoryManager />
              </div>
            </div>
          </div>
        </main>

        {/* リポジトリ切り替え中のローディングオーバーレイ */}
        {isSwitchingRepo && (
          <div className={s.loadingOverlay}>
            <div className={s.loadingCard}>
              <div className={s.loadingContent}>
                <Loader2 className={s.spinner} />
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
        <RepositorySwitcher />
      </div>

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

    </div>
  );
}
