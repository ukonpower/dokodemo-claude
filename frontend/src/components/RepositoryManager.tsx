import React, { useState } from 'react';
import type { GitRepository } from '../types';

interface RepositoryManagerProps {
  repositories: GitRepository[];
  currentRepo: string;
  onCloneRepository: (url: string, name: string) => void;
  onSwitchRepository: (path: string) => void;
  isConnected: boolean;
}

const RepositoryManager: React.FC<RepositoryManagerProps> = ({
  repositories,
  currentRepo,
  onCloneRepository,
  onSwitchRepository,
  isConnected
}) => {
  const [repoUrl, setRepoUrl] = useState('');
  const [repoName, setRepoName] = useState('');
  const [isCloning, setIsCloning] = useState(false);

  const handleClone = (e: React.FormEvent) => {
    e.preventDefault();
    if (!repoUrl.trim() || !repoName.trim()) return;

    setIsCloning(true);
    onCloneRepository(repoUrl, repoName);
    
    // クローン完了を想定してフォームをリセット（実際はサーバーからの応答で管理）
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
        const match = url.match(/:([^\/]+\/)?([^\/]+?)(?:\.git)?$/);
        return match ? match[2] : '';
      }
      // HTTPS形式の場合
      const match = url.match(/\/([^\/]+?)(?:\.git)?$/);
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

  const getStatusColor = (status: GitRepository['status']) => {
    switch (status) {
      case 'ready': return 'text-green-600';
      case 'cloning': return 'text-yellow-600';
      case 'error': return 'text-red-600';
      default: return 'text-gray-600';
    }
  };

  const getStatusText = (status: GitRepository['status']) => {
    switch (status) {
      case 'ready': return '準備完了';
      case 'cloning': return 'クローン中...';
      case 'error': return 'エラー';
      default: return '不明';
    }
  };

  return (
    <div className="space-y-4 sm:space-y-6">
      <div>
        <h2 className="text-base sm:text-lg font-semibold text-gray-900 mb-3 sm:mb-4">
          リポジトリ管理
        </h2>
      </div>

      {/* リポジトリクローンフォーム */}
      <form onSubmit={handleClone} className="space-y-4">
        <div className="space-y-3 sm:space-y-4">
          <div>
            <label htmlFor="repo-url" className="block text-sm font-medium text-gray-700 mb-2">
              GitリポジトリURL
            </label>
            <input
              id="repo-url"
              type="text"
              value={repoUrl}
              onChange={(e) => handleUrlChange(e.target.value)}
              placeholder="https://github.com/user/repo.git または git@github.com:user/repo.git"
              className="w-full px-3 py-2.5 sm:py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500 text-sm sm:text-base"
              disabled={!isConnected || isCloning}
            />
          </div>
          <div>
            <label htmlFor="repo-name" className="block text-sm font-medium text-gray-700 mb-2">
              プロジェクト名
            </label>
            <input
              id="repo-name"
              type="text"
              value={repoName}
              onChange={(e) => setRepoName(e.target.value)}
              placeholder="プロジェクト名"
              className="w-full px-3 py-2.5 sm:py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500 text-sm sm:text-base"
              disabled={!isConnected || isCloning}
            />
          </div>
          <button
            type="submit"
            disabled={!isConnected || isCloning || !repoUrl.trim() || !repoName.trim()}
            className="w-full bg-blue-600 text-white py-3 sm:py-2 px-4 rounded-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed font-medium text-sm sm:text-base"
          >
            {isCloning ? 'クローン中...' : 'クローン'}
          </button>
        </div>
      </form>

      {/* 既存リポジトリ一覧 */}
      <div>
        <h3 className="text-sm font-medium text-gray-700 mb-3">
          既存プロジェクト
        </h3>
        {repositories.length === 0 ? (
          <div className="text-center py-6">
            <p className="text-sm text-gray-500">
              プロジェクトがありません
            </p>
          </div>
        ) : (
          <div className="space-y-2 sm:space-y-3">
            {repositories.map((repo) => (
              <div
                key={repo.path}
                className={`repository-item ${
                  currentRepo === repo.path ? 'repository-item-selected' : ''
                } p-3 sm:p-4`}
                onClick={() => onSwitchRepository(repo.path)}
              >
                <div className="flex items-start sm:items-center justify-between space-x-3">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm sm:text-base font-medium text-gray-900 truncate">
                      {repo.name}
                    </p>
                    {repo.url && (
                      <p className="text-xs sm:text-sm text-gray-500 truncate mt-1">
                        {repo.url}
                      </p>
                    )}
                  </div>
                  <div className="flex-shrink-0">
                    <span className={`text-xs ${getStatusColor(repo.status)} font-medium`}>
                      {getStatusText(repo.status)}
                    </span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 現在のプロジェクト表示 */}
      {currentRepo && (
        <div className="pt-4 border-t border-gray-200">
          <p className="text-xs text-gray-500 mb-1">現在のプロジェクト:</p>
          <p className="text-sm font-medium text-gray-900 truncate">
            {currentRepo.split('/').pop()}
          </p>
        </div>
      )}
    </div>
  );
};

export default RepositoryManager;