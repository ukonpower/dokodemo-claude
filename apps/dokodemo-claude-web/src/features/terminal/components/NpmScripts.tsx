import React, { useEffect } from 'react';
import { Zap, RefreshCw, Play } from 'lucide-react';
import { useSocketContext } from '@/app/providers/SocketProvider';
import { useRepositoryContext } from '@/features/repo/providers/RepositoryProvider';
import { useTerminalContext } from '@/features/terminal/providers/TerminalProvider';
import s from './NpmScripts.module.scss';

const NpmScripts: React.FC = () => {
  // 接続状態
  const { isConnected } = useSocketContext();

  // リポジトリ関連
  const { repository } = useRepositoryContext();
  const { currentRepo: repositoryPath } = repository;

  // npmスクリプト関連
  const { npm } = useTerminalContext();
  const {
    npmScripts: scripts,
    executeNpmScript: onExecuteScript,
    refreshNpmScripts: onRefreshScripts,
  } = npm;

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
            <Zap size={16} className={s.titleIcon} />
            npm scripts
          </h3>
          <button
            onClick={onRefreshScripts}
            disabled={!isConnected}
            className={s.refreshButton}
          >
            <RefreshCw size={12} className={s.refreshIcon} />
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
          <Zap size={16} className={s.titleIcon} />
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
          <RefreshCw size={12} className={s.refreshIcon} />
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
                <Play size={12} className={s.runIconSvg} />
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
