import React, { useEffect } from 'react';
import s from './NpmScripts.module.scss';

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
      <div className={s.root}>
        <div className={s.header}>
          <h3 className={s.title}>
            <svg
              className={s.titleIcon}
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
            className={s.refreshButton}
          >
            <svg
              className={s.refreshIcon}
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
        <p className={s.emptyText}>
          package.jsonにnpm scriptsが見つかりません
        </p>
      </div>
    );
  }

  return (
    <div className={s.root}>
      <div className={s.headerWithMargin}>
        <h3 className={s.title}>
          <svg
            className={s.titleIcon}
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
          <span className={s.countBadge}>
            {scriptEntries.length}
          </span>
        </h3>
        <button
          onClick={onRefreshScripts}
          disabled={!isConnected}
          className={s.refreshButton}
        >
          <svg
            className={s.refreshIcon}
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
      <div className={s.scrollArea}>
        <div className={s.grid}>
          {scriptEntries.map(([scriptName, command]) => (
            <button
              key={scriptName}
              onClick={() => onExecuteScript(scriptName)}
              disabled={!isConnected}
              className={s.scriptButton}
              title={`npm run ${scriptName}\n${command}`}
            >
              <div className={s.scriptName}>
                {scriptName}
              </div>
              <div className={s.scriptCommand}>
                npm run
              </div>
              {/* 実行アイコン */}
              <div className={s.runIcon}>
                <svg
                  className={s.runIconSvg}
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
      <p className={s.helpText}>
        現在選択されているターミナルでnpm
        runコマンドを実行します。ボタンにマウスを重ねると詳細が表示されます。
      </p>
    </div>
  );
};

export default NpmScripts;
