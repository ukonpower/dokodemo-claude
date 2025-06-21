import React, { useState } from 'react';
import type { GitRepository } from '../types';

interface RepositoryManagerProps {
  repositories: GitRepository[];
  currentRepo: string;
  onCloneRepository: (url: string, name: string) => void;
  onSwitchRepository: (path: string) => void;
  onDeleteRepository: (path: string, name: string) => void;
  isConnected: boolean;
}

const RepositoryManager: React.FC<RepositoryManagerProps> = ({
  repositories,
  currentRepo,
  onCloneRepository,
  onSwitchRepository,
  onDeleteRepository,
  isConnected
}) => {
  const [repoUrl, setRepoUrl] = useState('');
  const [repoName, setRepoName] = useState('');
  const [isCloning, setIsCloning] = useState(false);
  const [deleteConfirmRepo, setDeleteConfirmRepo] = useState<{path: string, name: string} | null>(null);

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


  const getStatusText = (status: GitRepository['status']) => {
    switch (status) {
      case 'ready': return '準備完了';
      case 'cloning': return 'クローン中...';
      case 'error': return 'エラー';
      default: return '不明';
    }
  };

  return (
    <div className="space-y-6 sm:space-y-8">
      {/* 既存プロジェクト一覧 */}
      <div>
        <h2 className="text-lg sm:text-xl font-bold text-gray-900 mb-4 sm:mb-6">
          Projects
        </h2>
        {repositories.length === 0 ? (
          <div className="text-center py-8 sm:py-12">
            <svg className="mx-auto h-12 w-12 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2H5a2 2 0 00-2-2z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="m8 10 4 4 4-4" />
            </svg>
            <h3 className="mt-2 text-sm font-medium text-gray-900">プロジェクトがありません</h3>
            <p className="mt-1 text-sm text-gray-500">
              下のフォームから新しいリポジトリをクローンしてください
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-4">
            {repositories.map((repo) => (
              <div
                key={repo.path}
                className={`relative group cursor-pointer bg-white border rounded-lg p-4 transition-all duration-200 hover:shadow-md hover:-translate-y-0.5 overflow-hidden ${
                  currentRepo === repo.path 
                    ? 'border-blue-400 bg-blue-50 shadow-sm' 
                    : 'border-gray-200 hover:border-gray-300'
                }`}
                onClick={() => onSwitchRepository(repo.path)}
              >
                <div className="flex flex-col space-y-2">
                  <div className="flex items-center space-x-2">
                    <svg className="h-4 w-4 text-gray-500 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2H5a2 2 0 00-2-2z" />
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="m8 10 4 4 4-4" />
                    </svg>
                    <h3 className="text-base font-medium text-gray-900 truncate">
                      {repo.name}
                    </h3>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setDeleteConfirmRepo({path: repo.path, name: repo.name});
                      }}
                      className="opacity-0 group-hover:opacity-100 ml-auto p-1 text-red-500 hover:text-red-700 hover:bg-red-50 rounded transition-all duration-200"
                      title="削除"
                    >
                      <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                      </svg>
                    </button>
                  </div>
                  <div className="space-y-1">
                    {repo.url && (
                      <p className="text-xs text-gray-500 truncate">
                        {repo.url}
                      </p>
                    )}
                    <p className="text-xs text-gray-400 truncate">
                      {repo.path}
                    </p>
                  </div>
                </div>
                
                {/* ステータスラベル（右上貼り付け） */}
                <span className={`absolute top-0 right-0 inline-block px-1.5 py-0.5 text-xs font-light rounded-bl ${
                  repo.status === 'ready' 
                    ? 'bg-green-100 text-green-700' 
                    : repo.status === 'cloning'
                    ? 'bg-yellow-100 text-yellow-700'
                    : 'bg-red-100 text-red-700'
                }`}>
                  {getStatusText(repo.status)}
                </span>
                
                {/* 選択インジケーター */}
                {currentRepo === repo.path && (
                  <div className="absolute top-1.5 left-1.5">
                    <div className="h-2 w-2 bg-blue-500 rounded-full"></div>
                  </div>
                )}
                
                {/* ホバー時のオーバーレイ */}
                <div className="absolute inset-0 bg-blue-500 bg-opacity-5 rounded-lg opacity-0 group-hover:opacity-100 transition-opacity duration-200 pointer-events-none"></div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* リポジトリ追加セクション */}
      <div className="border-t border-gray-200 pt-6 sm:pt-8">
        <div className="bg-gray-50 rounded-xl p-6 sm:p-8">
          <h3 className="text-lg font-semibold text-gray-900 mb-4 flex items-center">
            <svg className="h-5 w-5 mr-2 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
            </svg>
            新しいリポジトリを追加
          </h3>
          <p className="text-sm text-gray-600 mb-6">
            GitHubやその他のGitリポジトリをクローンして新しいプロジェクトを開始します
          </p>
          
          <form onSubmit={handleClone} className="space-y-4">
            <div className="space-y-4">
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
                  className="w-full px-4 py-3 border border-gray-300 rounded-lg shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-sm transition-colors"
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
                  className="w-full px-4 py-3 border border-gray-300 rounded-lg shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-sm transition-colors"
                  disabled={!isConnected || isCloning}
                />
              </div>
              <button
                type="submit"
                disabled={!isConnected || isCloning || !repoUrl.trim() || !repoName.trim()}
                className="w-full bg-blue-600 text-white py-3 px-6 rounded-lg hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed font-medium text-sm transition-colors flex items-center justify-center"
              >
                {isCloning ? (
                  <>
                    <svg className="animate-spin -ml-1 mr-3 h-4 w-4 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                    </svg>
                    クローン中...
                  </>
                ) : (
                  <>
                    <svg className="h-4 w-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
                    </svg>
                    リポジトリをクローン
                  </>
                )}
              </button>
            </div>
          </form>
        </div>
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

      {/* 削除確認ダイアログ */}
      {deleteConfirmRepo && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg shadow-xl max-w-md w-full p-6">
            <div className="flex items-center space-x-3 mb-4">
              <div className="flex-shrink-0">
                <svg className="h-6 w-6 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.732-.833-2.5 0L4.268 16.5c-.77.833.192 2.5 1.732 2.5z" />
                </svg>
              </div>
              <div>
                <h3 className="text-lg font-medium text-gray-900">
                  リポジトリを削除
                </h3>
              </div>
            </div>
            <div className="mb-6">
              <p className="text-sm text-gray-500 mb-2">
                以下のリポジトリを削除しますか？この操作は元に戻せません。
              </p>
              <div className="bg-gray-50 rounded-md p-3">
                <p className="text-sm font-medium text-gray-900">{deleteConfirmRepo.name}</p>
                <p className="text-xs text-gray-500">{deleteConfirmRepo.path}</p>
              </div>
            </div>
            <div className="flex space-x-3">
              <button
                onClick={() => setDeleteConfirmRepo(null)}
                className="flex-1 bg-white text-gray-700 border border-gray-300 py-2 px-4 rounded-md hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 transition-colors"
              >
                キャンセル
              </button>
              <button
                onClick={() => {
                  onDeleteRepository(deleteConfirmRepo.path, deleteConfirmRepo.name);
                  setDeleteConfirmRepo(null);
                }}
                className="flex-1 bg-red-600 text-white py-2 px-4 rounded-md hover:bg-red-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-red-500 transition-colors"
              >
                削除する
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default RepositoryManager;