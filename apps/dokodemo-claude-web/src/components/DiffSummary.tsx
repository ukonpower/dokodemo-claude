import React, { useEffect, useCallback } from 'react';
import { RefreshCw } from 'lucide-react';
import type { GitDiffFile, GitDiffSummary } from '../types';
import s from './DiffSummary.module.scss';

interface DiffSummaryProps {
  rid: string;
  summary: GitDiffSummary | null;
  isLoading: boolean;
  error: string | null;
  onRefresh: () => void;
  onFileClick: (filename: string) => void;
}

function getStatusDisplay(status: GitDiffFile['status']): {
  icon: string;
  textColor: string;
  bgColor: string;
} {
  switch (status) {
    case 'A':
      return { icon: '+', textColor: '#4ade80', bgColor: '#14532d' };
    case 'D':
      return { icon: '-', textColor: '#f87171', bgColor: '#7f1d1d' };
    case 'R':
      return { icon: 'R', textColor: '#60a5fa', bgColor: '#1e3a5f' };
    case 'U':
      return { icon: '?', textColor: '#a78bfa', bgColor: '#4c1d95' };
    case 'M':
    default:
      return { icon: 'M', textColor: '#fbbf24', bgColor: '#854d0e' };
  }
}

const DiffSummary: React.FC<DiffSummaryProps> = ({
  summary,
  isLoading,
  error,
  onRefresh,
  onFileClick,
}) => {
  useEffect(() => {
    onRefresh();
  }, [onRefresh]);

  const handleFileClick = useCallback(
    (filename: string) => { onFileClick(filename); },
    [onFileClick]
  );

  return (
    <div className={s.container}>
      {/* ヘッダー行 */}
      <div className={s.headerRow}>
        <div className={s.headerLeft}>
          <span className={s.headerTitle}>
            Git Diff
          </span>
          {summary && summary.files.length > 0 && (
            <span className={s.headerCount}>
              {summary.files.length}ファイル
            </span>
          )}
        </div>
        <button
          onClick={onRefresh}
          disabled={isLoading}
          className={s.refreshButton}
          title="更新"
        >
          <RefreshCw
            size={10}
            className={`${s.refreshIcon} ${isLoading ? s.spinning : ''}`}
          />
        </button>
      </div>

      {/* エラー表示 */}
      {error && (
        <div className={s.errorBox}>
          {error}
        </div>
      )}

      {/* ローディング */}
      {isLoading && !summary && (
        <div className={s.loadingCenter}>
          <svg className={s.loadingSpinner} fill="none" viewBox="0 0 24 24">
            <circle className={s.spinnerCircle} cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className={s.spinnerPath} fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
          </svg>
        </div>
      )}

      {/* 差分なし */}
      {!isLoading && !error && summary && summary.files.length === 0 && (
        <div className={s.emptyCenter}>
          <span className={s.emptyText}>
            変更されたファイルはありません
          </span>
        </div>
      )}

      {/* ファイル一覧 */}
      {!error && summary && summary.files.length > 0 && (
        <div className={s.fileList}>
          {summary.files.map((file) => {
            const statusDisplay = getStatusDisplay(file.status);
            return (
              <button
                key={file.filename}
                onClick={() => handleFileClick(file.filename)}
                className={s.fileButton}
              >
                {/* ステータスバッジ */}
                <span
                  className={s.statusBadge}
                  style={{
                    backgroundColor: statusDisplay.bgColor,
                    color: statusDisplay.textColor,
                  }}
                >
                  {statusDisplay.icon}
                </span>

                {/* ファイルパス */}
                <span className={s.filePath}>
                  {file.oldFilename ? (
                    <>
                      <span className={s.filePathDir}>
                        {file.oldFilename}
                      </span>
                      <span className={s.filePathArrow}>→</span>
                      <span className={s.filePathName}>
                        {file.filename}
                      </span>
                    </>
                  ) : (
                    (() => {
                      const lastSlash = file.filename.lastIndexOf('/');
                      if (lastSlash === -1) {
                        return (
                          <span className={s.filePathName}>
                            {file.filename}
                          </span>
                        );
                      }
                      const dir = file.filename.substring(0, lastSlash + 1);
                      const name = file.filename.substring(lastSlash + 1);
                      return (
                        <>
                          <span className={s.filePathDir}>
                            {dir}
                          </span>
                          <span className={s.filePathName}>
                            {name}
                          </span>
                        </>
                      );
                    })()
                  )}
                </span>

                {/* 追加・削除行数 */}
                <span className={s.statGroup}>
                  {file.additions > 0 && (
                    <span className={s.statAddition}>
                      +{file.additions}
                    </span>
                  )}
                  {file.deletions > 0 && (
                    <span className={s.statDeletion}>
                      -{file.deletions}
                    </span>
                  )}
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default DiffSummary;
