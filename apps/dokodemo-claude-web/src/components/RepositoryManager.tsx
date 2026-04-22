import React, { useState, useEffect } from 'react';
import { Plus } from 'lucide-react';
import type { GitRepository, RepoProcessStatus } from '../types';
import { repositoryIdMap } from '../utils/repository-id-map';
import AddRepositoryModal from './AddRepositoryModal';
import ProjectAiStatusBadge from './ProjectAiStatusBadge';
import s from './RepositoryManager.module.scss';

/**
 * リポジトリの表示名を取得
 * ワークツリーの場合は「親リポジトリ名 / ブランチ名」形式
 */
function getDisplayName(repo: GitRepository): string {
  if (repo.isWorktree && repo.parentRepoName && repo.worktreeBranch) {
    return `${repo.parentRepoName} / ${repo.worktreeBranch}`;
  }
  return repo.name;
}

interface RepositoryManagerProps {
  repositories: GitRepository[];
  currentRepo: string;
  repoProcessStatuses: RepoProcessStatus[];
  lastAccessTimes: Record<string, number>;
  onCloneRepository: (url: string, name: string) => void;
  onCreateRepository: (name: string) => void;
  onStopProcesses: (rid: string) => void;
  onSwitchRepository: (path: string) => void;
  isConnected: boolean;
}

const RepositoryManager: React.FC<RepositoryManagerProps> = ({
  repositories,
  currentRepo,
  repoProcessStatuses,
  lastAccessTimes,
  onCloneRepository,
  onCreateRepository,
  onStopProcesses,
  onSwitchRepository,
  isConnected,
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [openMenuPath, setOpenMenuPath] = useState<string | null>(null);
  const [showAddModal, setShowAddModal] = useState(false);
  const processStatusByPath = new Map(
    repoProcessStatuses.map((status) => [status.repositoryPath, status])
  );

  // メニュー外側クリックで閉じる
  useEffect(() => {
    if (!openMenuPath) return;

    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as HTMLElement;
      if (!target.closest('[data-repo-menu]')) {
        setOpenMenuPath(null);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [openMenuPath]);

  const getStatusText = (status: GitRepository['status']) => {
    switch (status) {
      case 'ready':
        return null;
      case 'cloning':
        return 'クローン中...';
      case 'creating':
        return '作成中...';
      case 'error':
        return 'エラー';
      default:
        return '不明';
    }
  };

  // 検索クエリに基づいてリポジトリをフィルタリングし、最終アクセス順にソート
  const filteredRepositories = repositories
    .filter((repo) => {
      if (!searchQuery.trim()) return true;

      const query = searchQuery.toLowerCase();
      const name = repo.name.toLowerCase();
      const path = repo.path.toLowerCase();
      const url = repo.url?.toLowerCase() || '';

      return (
        name.includes(query) || path.includes(query) || url.includes(query)
      );
    })
    .sort((a, b) => {
      const timeA = lastAccessTimes[a.path] || 0;
      const timeB = lastAccessTimes[b.path] || 0;

      return timeB - timeA;
    });

  return (
    <div className={s.container}>
      {/* ヘッダー: タイトル + 検索 + 追加ボタン */}
      <div className={s.headerSection}>
        <div className={s.headerRow}>
          <h2 className={s.title}>Projects</h2>
          <div className={s.headerActions}>
            {/* 検索入力 */}
            {repositories.length > 0 && (
              <div className={s.searchWrapper}>
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="プロジェクトを検索..."
                  className={s.searchInput}
                />
                <svg
                  className={s.searchIcon}
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
                  />
                </svg>
                {searchQuery && (
                  <button
                    onClick={() => setSearchQuery('')}
                    className={s.clearButton}
                    title="検索をクリア"
                  >
                    <svg
                      className={s.clearIcon}
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M6 18L18 6M6 6l12 12"
                      />
                    </svg>
                  </button>
                )}
              </div>
            )}
            {/* 追加ボタン */}
            <button
              onClick={() => setShowAddModal(true)}
              className={s.addButton}
              title="リポジトリを追加"
            >
              <Plus className={s.addButtonIcon} />
              <span className={s.addButtonText}>追加</span>
            </button>
          </div>
        </div>

        {/* プロジェクト一覧 */}
        {repositories.length === 0 ? (
          <div className={s.emptyState}>
            <svg
              className={s.emptyIcon}
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={1.5}
                d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2H5a2 2 0 00-2-2z"
              />
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={1.5}
                d="m8 10 4 4 4-4"
              />
            </svg>
            <h3 className={s.emptyTitle}>
              プロジェクトがありません
            </h3>
            <p className={s.emptyDescription}>
              はじめてのリポジトリを追加しましょう
            </p>
            <button
              onClick={() => setShowAddModal(true)}
              className={s.emptyButton}
            >
              <Plus className={s.emptyButtonIcon} />
              リポジトリを追加
            </button>
          </div>
        ) : filteredRepositories.length === 0 ? (
          <div className={s.searchEmpty}>
            <svg
              className={s.searchEmptyIcon}
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={1.5}
                d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
              />
            </svg>
            <h3 className={s.searchEmptyTitle}>
              検索結果なし
            </h3>
            <p className={s.searchEmptyDescription}>
              「{searchQuery}」に一致するプロジェクトが見つかりませんでした
            </p>
            <button
              onClick={() => setSearchQuery('')}
              className={s.searchEmptyButton}
            >
              検索をクリア
            </button>
          </div>
        ) : (
          <div className={s.projectList}>
            {filteredRepositories.map((repo) => (
              (() => {
                const status = processStatusByPath.get(repo.path);
                const isActive = currentRepo === repo.path;
                const statusText = getStatusText(repo.status);
                const hasActiveProcesses =
                  !!status &&
                  (status.aiSessions > 0 || status.terminals > 0);
                const isMenuOpen = openMenuPath === repo.path;

                return (
                  <a
                    key={repo.path}
                    href={`?repo=${encodeURIComponent(repo.path)}`}
                    onClick={(e) => {
                      if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) {
                        return;
                      }
                      e.preventDefault();
                      onSwitchRepository(repo.path);
                    }}
                    className={`${s.projectRow} ${isActive ? s.projectRowActive : ''}`}
                  >
                    <div className={s.projectRowMain}>
                      <div className={s.projectRowHeader}>
                        <div className={s.projectText}>
                          <div className={s.projectNameRow}>
                            <h3 className={s.cardName}>{getDisplayName(repo)}</h3>
                            <div className={s.aiStatus}>
                              <ProjectAiStatusBadge
                                displayProvider={status?.displayProvider ?? 'claude'}
                                displayAiStatus={status?.displayAiStatus ?? 'ready'}
                                selectedProvider={status?.selectedProvider ?? 'claude'}
                              />
                            </div>
                            {statusText && (
                              <span
                                className={`${s.repoStatusInline} ${
                                  repo.status === 'error'
                                    ? s.repoStatusError
                                    : s.repoStatusProgress
                                }`}
                              >
                                {statusText}
                              </span>
                            )}
                          </div>
                          <p className={s.cardPath}>{repo.path}</p>
                        </div>
                      </div>

                      {hasActiveProcesses && (
                        <div className={s.menuWrapper} data-repo-menu>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              e.preventDefault();
                              setOpenMenuPath(isMenuOpen ? null : repo.path);
                            }}
                            className={s.menuButton}
                            title="メニュー"
                          >
                            <svg
                              className={s.menuIcon}
                              fill="currentColor"
                              viewBox="0 0 24 24"
                            >
                              <circle cx="12" cy="5" r="2" />
                              <circle cx="12" cy="12" r="2" />
                              <circle cx="12" cy="19" r="2" />
                            </svg>
                          </button>

                          {isMenuOpen && (
                            <div
                              className={s.menuDropdown}
                              onClick={(e) => {
                                e.stopPropagation();
                                e.preventDefault();
                              }}
                            >
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  e.preventDefault();
                                  const rid = repositoryIdMap.getRid(repo.path);
                                  if (rid) {
                                    onStopProcesses(rid);
                                  }
                                  setOpenMenuPath(null);
                                }}
                                className={s.menuItem}
                              >
                                <svg
                                  className={s.menuItemIcon}
                                  fill="none"
                                  stroke="currentColor"
                                  viewBox="0 0 24 24"
                                >
                                  <rect
                                    x="6"
                                    y="6"
                                    width="12"
                                    height="12"
                                    rx="1"
                                    strokeWidth="2"
                                  />
                                </svg>
                                プロセス停止
                              </button>
                            </div>
                          )}
                        </div>
                      )}
                    </div>

                  </a>
                );
              })()
            ))}
          </div>
        )}
      </div>

      {/* リポジトリ追加モーダル */}
      <AddRepositoryModal
        isOpen={showAddModal}
        onClose={() => setShowAddModal(false)}
        onCloneRepository={onCloneRepository}
        onCreateRepository={onCreateRepository}
        isConnected={isConnected}
      />
    </div>
  );
};

export default RepositoryManager;
