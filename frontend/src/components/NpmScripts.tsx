import React, { useEffect } from 'react';

interface NpmScriptsProps {
  repositoryPath: string;
  scripts: Record<string, string>;
  isConnected: boolean;
  onExecuteScript: (scriptName: string) => void;
  onRefreshScripts: () => void;
}

const NpmScripts: React.FC<NpmScriptsProps> = ({
  repositoryPath,
  scripts,
  isConnected,
  onExecuteScript,
  onRefreshScripts,
}) => {
  useEffect(() => {
    // リポジトリが変更されたときにスクリプトを取得
    if (repositoryPath && isConnected) {
      onRefreshScripts();
    }
  }, [repositoryPath, isConnected, onRefreshScripts]);

  const scriptEntries = Object.entries(scripts);
  const hasScripts = scriptEntries.length > 0;

  if (!hasScripts) {
    return (
      <div className="bg-dark-bg-tertiary rounded-lg border border-dark-border-light p-4">
        <div className="flex items-center justify-between">
          <h3 className="text-base font-semibold text-white flex items-center">
            <svg
              className="w-4 h-4 mr-2 text-dark-accent-orange"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M10 20l4-16m-4 4l4 4-4 4"
              />
            </svg>
            npm scripts
          </h3>
          <button
            onClick={onRefreshScripts}
            disabled={!isConnected}
            className="inline-flex items-center px-2 py-1 text-xs font-medium text-dark-text-primary bg-dark-bg-secondary border border-dark-border-light rounded-lg hover:bg-dark-bg-hover hover:border-dark-border-focus disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-150 shadow-sm"
          >
            <svg
              className="w-3 h-3 mr-1"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
              />
            </svg>
            更新
          </button>
        </div>
        <p className="text-gray-400 text-sm mt-2">
          package.jsonにnpm scriptsが見つかりません
        </p>
      </div>
    );
  }

  return (
    <div className="bg-dark-bg-tertiary rounded-lg border border-dark-border-light p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-base font-semibold text-white flex items-center">
          <svg
            className="w-4 h-4 mr-2 text-dark-accent-orange"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M10 20l4-16m-4 4l4 4-4 4"
            />
          </svg>
          npm scripts
          <span className="ml-2 text-xs text-dark-text-secondary bg-dark-bg-secondary px-2 py-0.5 rounded">
            {scriptEntries.length}
          </span>
        </h3>
        <button
          onClick={onRefreshScripts}
          disabled={!isConnected}
          className="inline-flex items-center px-2 py-1 text-xs font-medium text-dark-text-primary bg-dark-bg-secondary border border-dark-border-light rounded-lg hover:bg-dark-bg-hover hover:border-dark-border-focus disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-150 shadow-sm"
        >
          <svg
            className="w-3 h-3 mr-1"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
            />
          </svg>
          更新
        </button>
      </div>

      {/* スクリプトボタンのスクロール可能なグリッド */}
      <div className="max-h-32 overflow-y-auto scrollbar-thin scrollbar-thumb-gray-600 scrollbar-track-gray-800">
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-2 pr-2">
          {scriptEntries.map(([scriptName, command]) => (
            <button
              key={scriptName}
              onClick={() => onExecuteScript(scriptName)}
              disabled={!isConnected}
              className="group relative bg-dark-bg-secondary hover:bg-dark-bg-hover border border-dark-border-light hover:border-dark-accent-orange rounded-lg p-2 text-left transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed shadow-sm"
              title={`npm run ${scriptName}\n${command}`}
            >
              <div className="text-xs font-medium text-white truncate">
                {scriptName}
              </div>
              <div className="text-xs text-gray-400 group-hover:text-orange-200 mt-0.5 truncate">
                npm run
              </div>
              {/* 実行アイコン */}
              <div className="absolute top-1 right-1 opacity-0 group-hover:opacity-100 transition-opacity">
                <svg
                  className="w-3 h-3 text-orange-300"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M14.828 14.828a4 4 0 01-5.656 0M9 10h1m4 0h1m-6 4h8m-5-14S5 5 5 8s5 7 5 7 5-4 5-7-5-8-5-8z"
                  />
                </svg>
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* 説明文 */}
      <p className="text-xs text-gray-500 mt-3">
        現在選択されているターミナルでnpm
        runコマンドを実行します。ボタンにマウスを重ねると詳細が表示されます。
      </p>
    </div>
  );
};

export default NpmScripts;
