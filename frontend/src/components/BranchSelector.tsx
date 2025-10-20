import { useState, useEffect, useRef } from 'react';
import type { GitBranch } from '../types';

interface BranchSelectorProps {
  branches: GitBranch[];
  currentBranch: string;
  onSwitchBranch: (branchName: string) => void;
  isConnected: boolean;
}

function BranchSelector({
  branches,
  currentBranch,
  onSwitchBranch,
  isConnected,
}: BranchSelectorProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(event.target as Node)
      ) {
        setIsOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, []);

  const handleBranchSwitch = async (branchName: string) => {
    if (branchName === currentBranch) {
      setIsOpen(false);
      return;
    }

    setIsLoading(true);
    onSwitchBranch(branchName);
    setIsOpen(false);

    // ローディング状態は親コンポーネントからの更新で解除される
    setTimeout(() => {
      setIsLoading(false);
    }, 3000); // タイムアウトとして3秒後に自動解除
  };

  const localBranches = branches.filter((b) => !b.remote);
  const remoteBranches = branches.filter((b) => b.remote);

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        disabled={!isConnected || isLoading}
        className="inline-flex items-center px-3 py-1.5 text-sm font-medium text-gray-200 bg-gray-800 border border-dark-border-light rounded-md hover:bg-gray-700 hover:text-white focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-dark-border-focus transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
      >
        <svg
          className="w-4 h-4 mr-2"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M13 7l5 5m0 0l-5 5m5-5H6"
          />
        </svg>
        <span className="truncate max-w-32">
          {isLoading ? '切り替え中...' : currentBranch || 'ブランチ選択'}
        </span>
        <svg
          className={`w-4 h-4 ml-2 transition-transform ${isOpen ? 'rotate-180' : ''}`}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M19 9l-7 7-7-7"
          />
        </svg>
      </button>

      {isOpen && (
        <div className="absolute left-0 mt-1 w-64 bg-gray-800 border border-dark-border-DEFAULT rounded-md shadow-lg z-20">
          <div className="py-1 max-h-96 overflow-y-auto">
            {branches.length === 0 ? (
              <div className="px-4 py-2 text-sm text-gray-400">
                ブランチが見つかりません
              </div>
            ) : (
              <>
                {localBranches.length > 0 && (
                  <>
                    <div className="px-4 py-2 text-xs font-semibold text-gray-400 uppercase tracking-wider">
                      ローカルブランチ
                    </div>
                    {localBranches.map((branch) => (
                      <button
                        key={branch.name}
                        onClick={() => handleBranchSwitch(branch.name)}
                        className={`w-full text-left px-4 py-2 text-sm hover:bg-gray-700 transition-colors flex items-center justify-between ${
                          branch.current
                            ? 'text-gray-100 bg-gray-750'
                            : 'text-gray-200'
                        }`}
                      >
                        <span className="truncate">{branch.name}</span>
                        {branch.current && (
                          <svg
                            className="w-4 h-4 ml-2 flex-shrink-0"
                            fill="currentColor"
                            viewBox="0 0 20 20"
                          >
                            <path
                              fillRule="evenodd"
                              d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                              clipRule="evenodd"
                            />
                          </svg>
                        )}
                      </button>
                    ))}
                  </>
                )}

                {remoteBranches.length > 0 && (
                  <>
                    <div className="px-4 py-2 text-xs font-semibold text-gray-400 uppercase tracking-wider border-t border-dark-border-DEFAULT mt-1 pt-2">
                      リモートブランチ
                    </div>
                    {remoteBranches.map((branch) => (
                      <button
                        key={`${branch.remote}/${branch.name}`}
                        onClick={() => handleBranchSwitch(branch.name)}
                        className="w-full text-left px-4 py-2 text-sm text-gray-300 hover:bg-gray-700 transition-colors flex items-center"
                      >
                        <svg
                          className="w-3 h-3 mr-2 text-gray-500"
                          fill="currentColor"
                          viewBox="0 0 20 20"
                        >
                          <path
                            fillRule="evenodd"
                            d="M12.586 4.586a2 2 0 112.828 2.828l-3 3a2 2 0 01-2.828 0 1 1 0 00-1.414 1.414 4 4 0 005.656 0l3-3a4 4 0 00-5.656-5.656l-1.5 1.5a1 1 0 101.414 1.414l1.5-1.5zm-5 5a2 2 0 012.828 0 1 1 0 101.414-1.414 4 4 0 00-5.656 0l-3 3a4 4 0 105.656 5.656l1.5-1.5a1 1 0 10-1.414-1.414l-1.5 1.5a2 2 0 11-2.828-2.828l3-3z"
                            clipRule="evenodd"
                          />
                        </svg>
                        <span className="truncate">{branch.name}</span>
                      </button>
                    ))}
                  </>
                )}
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default BranchSelector;
