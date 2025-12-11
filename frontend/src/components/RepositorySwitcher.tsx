import React from 'react';
import type { GitRepository } from '../types';

interface RepositorySwitcherProps {
  repositories: GitRepository[];
  currentRepo: string;
  onSwitchRepository: (path: string) => void;
}

const RepositorySwitcher: React.FC<RepositorySwitcherProps> = ({
  repositories,
  currentRepo,
  onSwitchRepository,
}) => {
  // 最近開いた順にソート（RepositoryManagerと同じ処理）
  const sortedRepositories = [...repositories].sort((a, b) => {
    const lastAccessTimes = JSON.parse(
      localStorage.getItem('repo-last-access') || '{}'
    );
    const timeA = lastAccessTimes[a.path] || 0;
    const timeB = lastAccessTimes[b.path] || 0;
    return timeB - timeA;
  });

  // リポジトリがない場合は表示しない
  if (repositories.length === 0) {
    return null;
  }

  return (
    <div className="fixed bottom-0 left-0 right-0 bg-dark-bg-secondary border-t border-dark-border-light shadow-lg z-50">
      <div className="flex overflow-x-auto scrollbar-thin scrollbar-thumb-dark-border-light scrollbar-track-transparent hover:scrollbar-thumb-dark-border-focus">
        <div className="flex space-x-2 px-4 py-3 min-w-full">
          {sortedRepositories.map((repo, index) => {
            const isActive = currentRepo === repo.path;
            const isVisible = index < 3; // 最初の3つは常に表示

            return (
              <button
                key={repo.path}
                onClick={() => onSwitchRepository(repo.path)}
                className={`
                  flex-shrink-0 px-4 py-2 rounded-lg text-sm font-medium transition-all duration-200
                  flex items-center space-x-2 min-w-[150px] max-w-[200px]
                  ${
                    isActive
                      ? 'bg-dark-accent-blue text-white shadow-md border border-dark-accent-blue'
                      : 'bg-dark-bg-tertiary text-dark-text-secondary border border-dark-border-light hover:bg-dark-bg-hover hover:text-white hover:border-dark-border-focus'
                  }
                  ${!isVisible && 'opacity-75'}
                `}
                title={repo.path}
              >
                {/* リポジトリアイコン */}
                <svg
                  className="h-4 w-4 flex-shrink-0"
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

                {/* リポジトリ名 */}
                <span className="truncate">{repo.name}</span>

                {/* アクティブインジケーター */}
                {isActive && (
                  <div className="h-2 w-2 bg-white rounded-full flex-shrink-0"></div>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* スクロールヒント */}
      {sortedRepositories.length > 3 && (
        <div className="absolute right-2 top-1/2 transform -translate-y-1/2 pointer-events-none">
          <svg
            className="h-5 w-5 text-dark-text-muted opacity-50"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M9 5l7 7-7 7"
            />
          </svg>
        </div>
      )}
    </div>
  );
};

export default RepositorySwitcher;
