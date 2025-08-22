import React, { useState, useEffect } from 'react';
import type { GitRepository, ReviewServer, ServerToClientEvents, ClientToServerEvents } from '../types';
import type { Socket } from 'socket.io-client';

interface RepositoryManagerProps {
  repositories: GitRepository[];
  currentRepo: string;
  onCloneRepository: (url: string, name: string) => void;
  onCreateRepository: (name: string) => void;
  onSwitchRepository: (path: string) => void;
  isConnected: boolean;
  socket?: Socket<ServerToClientEvents, ClientToServerEvents> | null;
}

const RepositoryManager: React.FC<RepositoryManagerProps> = ({
  repositories,
  currentRepo,
  onCloneRepository,
  onCreateRepository,
  onSwitchRepository,
  isConnected,
  socket,
}) => {
  const [repoUrl, setRepoUrl] = useState('');
  const [repoName, setRepoName] = useState('');
  const [isCloning, setIsCloning] = useState(false);
  const [isCreateMode, setIsCreateMode] = useState(false);
  const [reviewServers, setReviewServers] = useState<ReviewServer[]>([]);
  const [startingServers, setStartingServers] = useState<Set<string>>(new Set());

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

  // 差分チェックサーバー関連の関数
  const handleStartReviewServer = (repositoryPath: string) => {
    if (!socket) return;

    setStartingServers(prev => new Set(prev).add(repositoryPath));
    socket.emit('start-review-server', { repositoryPath });
  };

  const getReviewServerForRepo = (repositoryPath: string): ReviewServer | undefined => {
    return reviewServers.find(server => server.repositoryPath === repositoryPath);
  };

  const isServerStarting = (repositoryPath: string): boolean => {
    return startingServers.has(repositoryPath);
  };

  // Socket.IOイベントリスナーの設定
  useEffect(() => {
    if (!socket) return;

    const handleReviewServerStarted = (data: {
      success: boolean;
      message: string;
      server?: ReviewServer;
    }) => {
      if (data.success && data.server) {
        setReviewServers(prev => {
          const filtered = prev.filter(s => s.repositoryPath !== data.server!.repositoryPath);
          return [...filtered, data.server!];
        });
        setStartingServers(prev => {
          const newSet = new Set(prev);
          newSet.delete(data.server!.repositoryPath);
          return newSet;
        });
        
        // 新しいタブでページを開く
        window.open(data.server.url, '_blank');
      } else {
        // エラー時は starting 状態を解除
        setStartingServers(prev => {
          const newSet = new Set(prev);
          // エラーメッセージから repositoryPath を推測するのは難しいので、全てクリア
          newSet.clear();
          return newSet;
        });
        console.error('Failed to start review server:', data.message);
      }
    };

    const handleReviewServerStopped = (data: {
      success: boolean;
      repositoryPath: string;
    }) => {
      if (data.success) {
        setReviewServers(prev => 
          prev.filter(server => server.repositoryPath !== data.repositoryPath)
        );
      }
    };

    const handleReviewServersList = (data: { servers: ReviewServer[] }) => {
      setReviewServers(data.servers);
    };

    socket.on('review-server-started', handleReviewServerStarted);
    socket.on('review-server-stopped', handleReviewServerStopped);
    socket.on('review-servers-list', handleReviewServersList);

    // 初期データを取得
    socket.emit('get-review-servers');

    return () => {
      socket.off('review-server-started', handleReviewServerStarted);
      socket.off('review-server-stopped', handleReviewServerStopped);
      socket.off('review-servers-list', handleReviewServersList);
    };
  }, [socket]);

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
                className={`relative group cursor-pointer bg-gray-700 border rounded-lg p-4 transition-all duration-200 hover:shadow-md hover:-translate-y-0.5 overflow-hidden ${
                  currentRepo === repo.path
                    ? 'border-blue-500 bg-gray-600 shadow-sm'
                    : 'border-gray-600 hover:border-gray-500'
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
                  
                  {/* 差分チェックボタン */}
                  {repo.status === 'ready' && (
                    <div className="pt-2 border-t border-gray-600">
                      <button
                        onClick={(e) => {
                          e.stopPropagation(); // 親のonClickを防ぐ
                          const server = getReviewServerForRepo(repo.path);
                          if (server && server.status === 'running') {
                            // 既にサーバーが動いている場合は直接ページを開く
                            window.open(server.url, '_blank');
                          } else {
                            // サーバーを起動
                            handleStartReviewServer(repo.path);
                          }
                        }}
                        disabled={isServerStarting(repo.path)}
                        className={`w-full text-xs py-1.5 px-2 rounded transition-colors ${
                          isServerStarting(repo.path)
                            ? 'bg-gray-600 text-gray-400 cursor-not-allowed'
                            : getReviewServerForRepo(repo.path)?.status === 'running'
                              ? 'bg-green-600 hover:bg-green-700 text-white'
                              : 'bg-blue-600 hover:bg-blue-700 text-white'
                        }`}
                      >
                        {isServerStarting(repo.path)
                          ? '起動中...'
                          : getReviewServerForRepo(repo.path)?.status === 'running'
                            ? '差分チェック（実行中）'
                            : '差分チェック'
                        }
                      </button>
                    </div>
                  )}
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
                    <div className="h-2 w-2 bg-blue-500 rounded-full"></div>
                  </div>
                )}

                {/* ホバー時のオーバーレイ */}
                <div className="absolute inset-0 bg-gray-600 bg-opacity-30 rounded-lg opacity-0 group-hover:opacity-100 transition-opacity duration-200 pointer-events-none"></div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* リポジトリ追加セクション */}
      <div className="border-t border-gray-600 pt-6 sm:pt-8">
        <div className="bg-gray-700 rounded-xl p-6 sm:p-8 border border-gray-600">
          <h3 className="text-lg font-semibold text-white mb-4 flex items-center">
            <svg
              className="h-5 w-5 mr-2 text-blue-400"
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
          <div className="flex mb-6 bg-gray-800 rounded-lg p-1">
            <button
              type="button"
              onClick={() => setIsCreateMode(false)}
              className={`flex-1 py-2 px-4 rounded-md text-sm font-medium transition-colors ${
                !isCreateMode
                  ? 'bg-gray-700 text-white shadow-sm'
                  : 'text-gray-400 hover:text-white'
              }`}
            >
              既存リポジトリをクローン
            </button>
            <button
              type="button"
              onClick={() => setIsCreateMode(true)}
              className={`flex-1 py-2 px-4 rounded-md text-sm font-medium transition-colors ${
                isCreateMode
                  ? 'bg-gray-700 text-white shadow-sm'
                  : 'text-gray-400 hover:text-white'
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
                    className="w-full px-4 py-3 border border-gray-600 bg-gray-800 text-white rounded-lg shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-sm transition-colors"
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
                  className="w-full px-4 py-3 border border-gray-600 bg-gray-800 text-white rounded-lg shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-sm transition-colors"
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
                className="w-full bg-blue-600 text-white py-3 px-6 rounded-lg hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed font-medium text-sm transition-colors flex items-center justify-center"
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
        <div className="pt-4 border-t border-gray-600">
          <p className="text-xs text-gray-400 mb-1">現在のプロジェクト:</p>
          <p className="text-sm font-medium text-white truncate">
            {currentRepo.split('/').pop()}
          </p>
        </div>
      )}
    </div>
  );
};

export default RepositoryManager;
