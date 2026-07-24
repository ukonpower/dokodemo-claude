import React, { useCallback, useState } from 'react';
import { Plus, Search, X, FolderOpen, MoreVertical, Square } from 'lucide-react';
import type { GitRepository } from '@/types';
import { repositoryIdMap } from '@/shared/utils/repository-id-map';
import { useSocketContext } from '@/app/providers/SocketProvider';
import { useRepositoryContext } from '@/features/repo/providers/RepositoryProvider';
import { useOutsideClose } from '@/shared/hooks/useOutsideClose';
import AddRepositoryModal from './AddRepositoryModal';
import ProjectAiStatusBadge from '@/features/ai/components/ProjectAiStatusBadge';
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

const RepositoryManager: React.FC = () => {
  // 接続状態
  const { isConnected } = useSocketContext();

  // リポジトリ関連（repositories はサーバー側で「最近開いた順」にソート済み）
  const { repository, switchRepositoryFromList: onSwitchRepository } =
    useRepositoryContext();
  const {
    repositories,
    currentRepo,
    repoProcessStatuses,
    cloneRepository: onCloneRepository,
    createRepository: onCreateRepository,
    showStopProcessConfirmDialog: onStopProcesses,
  } = repository;

  const [searchQuery, setSearchQuery] = useState('');
  const [openMenuPath, setOpenMenuPath] = useState<string | null>(null);
  const [showAddModal, setShowAddModal] = useState(false);
  const processStatusByPath = new Map(
    repoProcessStatuses.map((status) => [status.repositoryPath, status])
  );

  // メニュー外側クリック / Escape で閉じる
  const closeMenu = useCallback(() => setOpenMenuPath(null), []);
  useOutsideClose(!!openMenuPath, closeMenu, {
    ignoreClosest: '[data-repo-menu]',
  });

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

  // 検索クエリに基づいてリポジトリをフィルタリング（並び順はサーバー側で確定済み）
  const filteredRepositories = repositories.filter((repo) => {
    if (!searchQuery.trim()) return true;

    const query = searchQuery.toLowerCase();
    const name = repo.name.toLowerCase();
    const path = repo.path.toLowerCase();
    const url = repo.url?.toLowerCase() || '';

    return name.includes(query) || path.includes(query) || url.includes(query);
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
                <Search className={s.searchIcon} />
                {searchQuery && (
                  <button
                    onClick={() => setSearchQuery('')}
                    className={s.clearButton}
                    title="検索をクリア"
                  >
                    <X className={s.clearIcon} />
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
            <FolderOpen className={s.emptyIcon} strokeWidth={1.5} />
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
            <Search className={s.searchEmptyIcon} strokeWidth={1.5} />
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
                  (status.aiInstancesTotal > 0 || status.terminals > 0);
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
                            <MoreVertical className={s.menuIcon} />
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
                                <Square className={s.menuItemIcon} />
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
