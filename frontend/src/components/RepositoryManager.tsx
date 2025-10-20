import React, { useState } from 'react';
import type { GitRepository } from '../types';

interface RepositoryManagerProps {
  repositories: GitRepository[];
  currentRepo: string;
  onCloneRepository: (url: string, name: string) => void;
  onCreateRepository: (name: string) => void;
  onSwitchRepository: (path: string) => void;
  isConnected: boolean;
}

const RepositoryManager: React.FC<RepositoryManagerProps> = ({
  repositories,
  currentRepo,
  onCloneRepository,
  onCreateRepository,
  onSwitchRepository,
  isConnected,
}) => {
  const [repoUrl, setRepoUrl] = useState('');
  const [repoName, setRepoName] = useState('');
  const [isCloning, setIsCloning] = useState(false);
  const [isCreateMode, setIsCreateMode] = useState(false);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    if (isCreateMode) {
      if (!repoName.trim()) return;
      setIsCloning(true);
      onCreateRepository(repoName);
    } else {
      if (!repoUrl.trim() || !repoName.trim()) return;
      setIsCloning(true);
      onCloneRepository(repoUrl, repoName);
    }

    // 完了を想定してフォームをリセット（実際はサーバーからの応答で管理）
    setTimeout(() => {
      setIsCloning(false);
      setRepoUrl('');
      setRepoName('');
    }, 3000);
  };

  const extractRepoName = (url: string): string => {
    try {
      // SSH形式 (git@github.com:user/repo.git) の場合
      if (url.includes('@') && url.includes(':')) {
        const match = url.match(/:([^/]+\/)?([^/]+?)(?:\.git)?$/);
        return match ? match[2] : '';
      }
      // HTTPS形式の場合
      const match = url.match(/\/([^/]+?)(?:\.git)?$/);
      return match ? match[1] : '';
    } catch {
      return '';
    }
  };

  const handleUrlChange = (url: string) => {
    setRepoUrl(url);
    if (url && !repoName) {
      setRepoName(extractRepoName(url));
    }
  };

  const getStatusText = (status: GitRepository['status']) => {
    switch (status) {
      case 'ready':
        return '準備完了';
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

  return (
    <div className="space-y-6 sm:space-y-8">
      {/* 既存プロジェクト一覧 */}
      <div>
        <h2 className="text-lg sm:text-xl font-bold text-white mb-4 sm:mb-6">
          Projects
        </h2>
        {repositories.length === 0 ? (
          <div className="text-center py-8 sm:py-12">
            <svg
              className="mx-auto h-12 w-12 text-gray-400"
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
            <h3 className="mt-2 text-sm font-medium text-white">
              プロジェクトがありません
            </h3>
            <p className="mt-1 text-sm text-gray-300">
              下のフォームから新しいリポジトリをクローンしてください
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-4">
            {repositories.map((repo) => (
              <div
                key={repo.path}
                className={`relative group cursor-pointer bg-dark-bg-secondary border-2 rounded-lg p-4 transition-all duration-200 hover:shadow-xl hover:-translate-y-0.5 overflow-hidden ${
                  currentRepo === repo.path
                    ? 'border-dark-border-focus bg-dark-bg-tertiary shadow-lg'
                    : 'border-dark-border-light hover:border-dark-border-focus'
                }`}
                onClick={() => onSwitchRepository(repo.path)}
              >
                <div className="flex flex-col space-y-2">
                  <div className="flex items-center space-x-2">
                    <svg
                      className="h-4 w-4 text-gray-400 flex-shrink-0"
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
                    <h3 className="text-base font-medium text-white truncate">
                      {repo.name}
                    </h3>
                  </div>
                  <div className="space-y-1">
                    {repo.url && (
                      <p className="text-xs text-gray-400 truncate">
                        {repo.url}
                      </p>
                    )}
                    <p className="text-xs text-gray-500 truncate">
                      {repo.path}
                    </p>
                  </div>
                </div>

                {/* ステータスラベル（右上貼り付け） */}
                <span
                  className={`absolute top-0 right-0 inline-block px-1.5 py-0.5 text-xs font-light rounded-bl ${
                    repo.status === 'ready'
                      ? 'bg-green-900 text-green-300'
                      : repo.status === 'cloning' || repo.status === 'creating'
                        ? 'bg-yellow-900 text-yellow-300'
                        : 'bg-red-900 text-red-300'
                  }`}
                >
                  {getStatusText(repo.status)}
                </span>

                {/* 選択インジケーター */}
                {currentRepo === repo.path && (
                  <div className="absolute top-1.5 left-1.5">
                    <div className="h-2 w-2 bg-dark-accent-green rounded-full"></div>
                  </div>
                )}

                {/* ホバー時のオーバーレイ */}
                <div className="absolute inset-0 bg-dark-bg-hover bg-opacity-50 rounded-lg opacity-0 group-hover:opacity-100 transition-opacity duration-200 pointer-events-none"></div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* リポジトリ追加セクション */}
      <div className="border-t border-dark-border-DEFAULT pt-6 sm:pt-8">
        <div className="bg-dark-bg-secondary rounded-xl p-6 sm:p-8 border-2 border-dark-border-light shadow-xl">
          <h3 className="text-lg font-semibold text-white mb-4 flex items-center">
            <svg
              className="h-5 w-5 mr-2 text-dark-accent-green"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M12 6v6m0 0v6m0-6h6m-6 0H6"
              />
            </svg>
            新しいリポジトリを追加
          </h3>

          {/* モード切り替えタブ */}
          <div className="flex mb-6 bg-dark-bg-primary rounded-lg p-1 border border-dark-border-light">
            <button
              type="button"
              onClick={() => setIsCreateMode(false)}
              className={`flex-1 py-2 px-4 rounded-lg text-sm font-medium transition-all duration-150 ${
                !isCreateMode
                  ? 'bg-dark-bg-tertiary text-white shadow-md border border-dark-border-light'
                  : 'text-dark-text-secondary hover:text-white hover:bg-dark-bg-hover'
              }`}
            >
              既存リポジトリをクローン
            </button>
            <button
              type="button"
              onClick={() => setIsCreateMode(true)}
              className={`flex-1 py-2 px-4 rounded-lg text-sm font-medium transition-all duration-150 ${
                isCreateMode
                  ? 'bg-dark-bg-tertiary text-white shadow-md border border-dark-border-light'
                  : 'text-dark-text-secondary hover:text-white hover:bg-dark-bg-hover'
              }`}
            >
              新規リポジトリを作成
            </button>
          </div>

          <p className="text-sm text-gray-300 mb-6">
            {isCreateMode
              ? '新しいGitリポジトリを作成して、プロジェクトを開始します'
              : 'GitHubやその他のGitリポジトリをクローンして新しいプロジェクトを開始します'}
          </p>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-4">
              {!isCreateMode && (
                <div>
                  <label
                    htmlFor="repo-url"
                    className="block text-sm font-medium text-gray-200 mb-2"
                  >
                    GitリポジトリURL
                  </label>
                  <input
                    id="repo-url"
                    type="text"
                    value={repoUrl}
                    onChange={(e) => handleUrlChange(e.target.value)}
                    placeholder="https://github.com/user/repo.git または git@github.com:user/repo.git"
                    className="w-full px-4 py-3 border border-dark-border-light bg-dark-bg-tertiary text-white rounded-lg shadow-md focus:outline-none focus:ring-2 focus:ring-dark-accent-blue focus:border-dark-accent-blue hover:border-dark-border-focus text-sm transition-all duration-150 placeholder-dark-text-muted"
                    disabled={!isConnected || isCloning}
                  />
                </div>
              )}
              <div>
                <label
                  htmlFor="repo-name"
                  className="block text-sm font-medium text-gray-200 mb-2"
                >
                  プロジェクト名
                </label>
                <input
                  id="repo-name"
                  type="text"
                  value={repoName}
                  onChange={(e) => setRepoName(e.target.value)}
                  placeholder="プロジェクト名"
                  className="w-full px-4 py-3 border-2 border-dark-border-light bg-dark-bg-tertiary text-white rounded-lg shadow-md focus:outline-none focus:ring-2 focus:ring-dark-accent-blue focus:border-dark-accent-blue hover:border-dark-border-focus text-sm transition-all duration-150 placeholder-dark-text-muted"
                  disabled={!isConnected || isCloning}
                />
              </div>
              <button
                type="submit"
                disabled={
                  !isConnected ||
                  isCloning ||
                  (isCreateMode
                    ? !repoName.trim()
                    : !repoUrl.trim() || !repoName.trim())
                }
                className="w-full bg-dark-accent-green text-white py-3 px-6 rounded-lg hover:bg-dark-accent-green-hover focus:outline-none focus:ring-2 focus:ring-dark-accent-green focus:ring-offset-2 focus:ring-offset-dark-bg-secondary disabled:opacity-50 disabled:cursor-not-allowed font-medium text-sm transition-all duration-150 flex items-center justify-center shadow-md"
              >
                {isCloning ? (
                  <>
                    <svg
                      className="animate-spin -ml-1 mr-3 h-4 w-4 text-white"
                      xmlns="http://www.w3.org/2000/svg"
                      fill="none"
                      viewBox="0 0 24 24"
                    >
                      <circle
                        className="opacity-25"
                        cx="12"
                        cy="12"
                        r="10"
                        stroke="currentColor"
                        strokeWidth="4"
                      ></circle>
                      <path
                        className="opacity-75"
                        fill="currentColor"
                        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                      ></path>
                    </svg>
                    {isCreateMode ? '作成中...' : 'クローン中...'}
                  </>
                ) : (
                  <>
                    <svg
                      className="h-4 w-4 mr-2"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M12 6v6m0 0v6m0-6h6m-6 0H6"
                      />
                    </svg>
                    {isCreateMode ? 'リポジトリを作成' : 'リポジトリをクローン'}
                  </>
                )}
              </button>
            </div>
          </form>
        </div>
      </div>

      {/* 現在のプロジェクト表示 */}
      {currentRepo && (
        <div className="pt-4 border-t border-dark-border-DEFAULT">
          <p className="text-xs text-dark-text-secondary mb-1">現在のプロジェクト:</p>
          <p className="text-sm font-medium text-white truncate">
            {currentRepo.split('/').pop()}
          </p>
        </div>
      )}
    </div>
  );
};

export default RepositoryManager;
