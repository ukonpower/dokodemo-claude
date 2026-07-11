import { useState, type RefObject } from 'react';
import {
  ChevronDown,
  ExternalLink,
  FolderOpen,
  GitFork,
} from 'lucide-react';
import type { AiInstance, EditorInfo, EditorType, GitRepository } from '../types';
import s from './RepoHeader.module.scss';

interface RepoHeaderProps {
  // 接続状態
  isConnected: boolean;
  isReconnecting: boolean;
  connectionAttempts: number;
  primaryInstance?: AiInstance;

  // リポジトリ
  repositories: GitRepository[];
  currentRepo: string;

  // ツールボタン
  onOpenFileViewer: () => void;
  onOpenGraphView: () => void;
  onOpenSettings: () => void;
  startingCodeServer: boolean;

  // エディタ起動
  isLocalhost: boolean;
  availableEditors: EditorInfo[];
  showEditorMenu: boolean;
  setShowEditorMenu: (show: boolean) => void;
  editorMenuRef: RefObject<HTMLDivElement | null>;
  onOpenInEditor: (id: EditorType) => void;

  // GitHub
  remoteUrl: string | null;
}

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
export function RepoHeader({
  isConnected,
  isReconnecting,
  connectionAttempts,
  primaryInstance,
  repositories,
  currentRepo,
  onOpenFileViewer,
  onOpenGraphView,
  onOpenSettings,
  startingCodeServer,
  isLocalhost,
  availableEditors,
  showEditorMenu,
  setShowEditorMenu,
  editorMenuRef,
  onOpenInEditor,
  remoteUrl,
}: RepoHeaderProps) {
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
              <svg fill="none" stroke="currentColor" viewBox="0 0 24 24">
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
                  <button
                    onClick={() => window.open(remoteUrl, '_blank')}
                    className={`btn-icon-xs ${s.githubButton}`}
                    title="GitHubで開く"
                  >
                    <svg fill="currentColor" viewBox="0 0 24 24">
                      <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z" />
                    </svg>
                  </button>
                )}
              </div>
              <p className={s.repoPath}>{currentRepo}</p>
            </div>
          </div>

          <div className={s.headerRight}>
            <div className={s.toolButtons}>
              <button
                onClick={onOpenFileViewer}
                disabled={!isConnected}
                className="btn-icon"
                title="ファイルを開く"
              >
                <FolderOpen size={16} />
              </button>

              <button
                onClick={onOpenGraphView}
                disabled={!isConnected}
                className="btn-icon"
                title="Git Graphを開く"
              >
                <GitFork size={16} />
              </button>

              {hasEditorButton && primaryEditor && (
                <div className={s.editorDropdownWrapper} ref={editorMenuRef}>
                  <div className={s.editorSplitButton}>
                    <button
                      onClick={handleEditorButtonClick}
                      disabled={!isConnected || startingCodeServer}
                      className={`btn-icon ${s.editorMainButton} ${
                        dropdownEditors.length > 0 ? s.editorMainButtonHasDropdown : ''
                      }`}
                      title={`${primaryEditor.name}で開く`}
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
                        <ExternalLink size={16} />
                      )}
                    </button>

                    {dropdownEditors.length > 0 && (
                      <button
                        onClick={handleDropdownToggle}
                        disabled={!isConnected}
                        className={`btn-icon ${s.editorDropdownToggle}`}
                        title="別のエディタで開く"
                        aria-haspopup="menu"
                        aria-expanded={showEditorMenu}
                      >
                        <ChevronDown size={12} />
                      </button>
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

            <button onClick={onOpenSettings} className="btn-icon" title="設定">
              <svg fill="none" stroke="currentColor" viewBox="0 0 24 24">
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
