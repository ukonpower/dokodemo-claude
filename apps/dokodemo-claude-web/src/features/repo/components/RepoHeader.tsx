import { useState } from 'react';
import {
  ArrowLeft,
  ChevronDown,
  ExternalLink,
  FolderOpen,
  Github,
  GitFork,
  Loader2,
  Settings,
} from 'lucide-react';
import type { EditorInfo, GitRepository } from '@/types';
import IconButton from '@/shared/components/IconButton';
import { useSocketContext } from '@/app/providers/SocketProvider';
import { useRepositoryContext } from '@/features/repo/providers/RepositoryProvider';
import { useAiContext } from '@/features/ai/providers/AiProvider';
import { useGitGraphContext } from '@/features/git/providers/GitProvider';
import { useEditorLauncherContext } from '@/features/repo/providers/EditorLauncherProvider';
import { useNavigationContext } from '@/app/providers/NavigationProvider';
import { openFileViewerTab } from '@/app/utils/open-views';
import s from './RepoHeader.module.scss';

function getRepoTitle(
  repositories: GitRepository[],
  currentRepo: string
): string {
  const repoInfo = repositories.find((r) => r.path === currentRepo);
  if (
    repoInfo?.isWorktree &&
    repoInfo.parentRepoName &&
    repoInfo.worktreeBranch
  ) {
    return `${repoInfo.parentRepoName} - ${repoInfo.worktreeBranch}`;
  }
  if (repoInfo?.name) {
    return repoInfo.name;
  }
  return currentRepo.split('/').pop() || 'プロジェクト';
}

/**
 * ProjectView / DashboardView 共通のヘッダー。
 * 戻る・リポジトリ名（パスコピー）・GitHub・ツールボタン群・設定・接続状態を表示する。
 */
export function RepoHeader() {
  // 接続状態
  const { isConnected, isReconnecting, connectionAttempts } =
    useSocketContext();

  // リポジトリ
  const { repository } = useRepositoryContext();
  const { repositories, currentRepo } = repository;

  // AI CLI（セッション ID 表示用）
  const { aiCli } = useAiContext();
  const { primaryInstance } = aiCli;

  // ツールボタン
  const onOpenFileViewer = openFileViewerTab;
  const { openGraphView: onOpenGraphView } = useGitGraphContext();
  const { openSettings: onOpenSettings } = useNavigationContext();

  // エディタ起動
  const {
    startingCodeServer,
    isLocalhost,
    availableEditors,
    showEditorMenu,
    setShowEditorMenu,
    editorMenuRef,
    openInEditor: onOpenInEditor,
    remoteUrl,
  } = useEditorLauncherContext();

  const [copiedPath, setCopiedPath] = useState(false);

  // メインボタンは code-server を直接起動する。
  // localhost からのアクセス時のみ、右側のドロップダウンに vscode / cursor を出す
  const codeServerEditor = availableEditors.find((e) => e.id === 'code-server');
  const localEditors = isLocalhost
    ? availableEditors.filter((e) => e.id !== 'code-server')
    : [];
  const hasEditorButton = !!codeServerEditor || localEditors.length > 0;
  // メインボタンが押すべきエディタ（基本は code-server だが、無ければ最初のローカルエディタ）
  const primaryEditor: EditorInfo | undefined = codeServerEditor ?? localEditors[0];
  const dropdownEditors = codeServerEditor ? localEditors : localEditors.slice(1);

  const handleEditorButtonClick = () => {
    if (primaryEditor) {
      onOpenInEditor(primaryEditor.id);
    }
  };

  const handleDropdownToggle = () => {
    setShowEditorMenu(!showEditorMenu);
  };

  return (
    <header className={s.header}>
      <div className={s.headerInner}>
        <div className={s.headerRow}>
          <div className={s.headerLeft}>
            <a
              href={window.location.pathname}
              className={`btn-icon ${s.backLink}`}
              title="リポジトリ選択へ戻る"
            >
              <ArrowLeft size={16} />
            </a>
            <div className={s.repoInfo}>
              <div className={s.repoTitleRow}>
                <h1
                  className={s.repoTitle}
                  title={
                    copiedPath
                      ? 'コピーしました!'
                      : `クリックしてパスをコピー: ${currentRepo}`
                  }
                  onClick={() => {
                    navigator.clipboard.writeText(currentRepo).then(() => {
                      setCopiedPath(true);
                      setTimeout(() => setCopiedPath(false), 2000);
                    });
                  }}
                >
                  {copiedPath ? (
                    <span className={s.copiedText}>コピーしました!</span>
                  ) : (
                    getRepoTitle(repositories, currentRepo)
                  )}
                </h1>
                {remoteUrl && (
                  <IconButton
                    size="xs"
                    label="GitHubで開く"
                    onClick={() => window.open(remoteUrl, '_blank')}
                    className={s.githubButton}
                  >
                    <Github />
                  </IconButton>
                )}
              </div>
              <p className={s.repoPath}>{currentRepo}</p>
            </div>
          </div>

          <div className={s.headerRight}>
            <div className={s.toolButtons}>
              <IconButton
                label="ファイルを開く"
                onClick={onOpenFileViewer}
                disabled={!isConnected}
              >
                <FolderOpen />
              </IconButton>

              <IconButton
                label="Git Graphを開く"
                onClick={onOpenGraphView}
                disabled={!isConnected}
              >
                <GitFork />
              </IconButton>

              {hasEditorButton && primaryEditor && (
                <div className={s.editorDropdownWrapper} ref={editorMenuRef}>
                  <div className={s.editorSplitButton}>
                    <IconButton
                      label={`${primaryEditor.name}で開く`}
                      onClick={handleEditorButtonClick}
                      disabled={!isConnected || startingCodeServer}
                      className={`${s.editorMainButton} ${
                        dropdownEditors.length > 0 ? s.editorMainButtonHasDropdown : ''
                      }`}
                    >
                      {startingCodeServer ? (
                        <Loader2 className={s.spinnerAnimation} />
                      ) : (
                        <ExternalLink />
                      )}
                    </IconButton>

                    {dropdownEditors.length > 0 && (
                      <IconButton
                        label="別のエディタで開く"
                        onClick={handleDropdownToggle}
                        disabled={!isConnected}
                        className={s.editorDropdownToggle}
                        aria-haspopup="menu"
                        aria-expanded={showEditorMenu}
                      >
                        <ChevronDown />
                      </IconButton>
                    )}
                  </div>

                  {showEditorMenu && dropdownEditors.length > 0 && (
                    <div className={s.editorDropdown}>
                      <div className={s.editorDropdownList}>
                        {dropdownEditors.map((editor) => (
                          <button
                            key={editor.id}
                            onClick={() => onOpenInEditor(editor.id)}
                            className={`${s.editorItem} ${
                              editor.id === 'vscode'
                                ? s.editorItemVscode
                                : editor.id === 'cursor'
                                  ? s.editorItemCursor
                                  : s.editorItemCodeServer
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
                            ) : editor.id === 'cursor' ? (
                              <svg
                                className={`${s.editorItemIcon} ${s.editorIconCursor}`}
                                fill="currentColor"
                                viewBox="0 0 24 24"
                              >
                                <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 17.93c-3.95-.49-7-3.85-7-7.93 0-.62.08-1.21.21-1.79L9 15v1c0 1.1.9 2 2 2v1.93zm6.9-2.54c-.26-.81-1-1.39-1.9-1.39h-1v-3c0-.55-.45-1-1-1H8v-2h2c.55 0 1-.45 1-1V7h2c1.1 0 2-.9 2-2v-.41c2.93 1.19 5 4.06 5 7.41 0 2.08-.8 3.97-2.1 5.39z" />
                              </svg>
                            ) : (
                              <svg
                                className={`${s.editorItemIcon} ${s.editorIconCodeServer}`}
                                fill="none"
                                stroke="currentColor"
                                strokeWidth="2"
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                viewBox="0 0 24 24"
                              >
                                <polyline points="16 18 22 12 16 6" />
                                <polyline points="8 6 2 12 8 18" />
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
            </div>

            <IconButton label="設定" onClick={onOpenSettings}>
              <Settings />
            </IconButton>

            <div className={s.connectionInfo}>
              <div
                className={`${s.statusDot} ${
                  isConnected
                    ? s.statusConnected
                    : isReconnecting
                      ? s.statusReconnecting
                      : s.statusDisconnected
                }`}
              />
              <span className={s.statusText}>
                {isConnected
                  ? '接続中'
                  : isReconnecting
                    ? `再接続中 (${connectionAttempts})`
                    : '未接続'}
              </span>
              {primaryInstance?.sessionId && (
                <span className={s.sessionId}>
                  #{primaryInstance.sessionId.split('-')[1]}
                </span>
              )}
            </div>
          </div>
        </div>
      </div>
    </header>
  );
}

export default RepoHeader;
