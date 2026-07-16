import React, { useEffect, useCallback } from 'react';
import { GitBranch } from 'lucide-react';
import type { GitDiffFile, GitDiffSummary } from '../types';
import EmptyState from './EmptyState';
import { FileIcon, splitFilePath } from '../utils/file-icon';
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
        <EmptyState
          icon={<GitBranch size={20} strokeWidth={1.75} />}
          message="変更されたファイルはありません"
        />
      )}

      {/* ファイル一覧 */}
      {!error && summary && summary.files.length > 0 && (
        <div className={s.fileList}>
          {summary.files.map((file) => {
            const statusDisplay = getStatusDisplay(file.status);
            const { name, dir } = splitFilePath(file.filename);
            return (
              <button
                key={file.filename}
                onClick={() => handleFileClick(file.filename)}
                className={s.fileButton}
              >
                {/* ファイル種別アイコン */}
                <span className={s.fileIcon}>
                  <FileIcon filename={file.filename} />
                </span>

                {/* ファイル名 + ディレクトリパス */}
                <span className={s.filePath}>
                  <span className={s.filePathName}>{name}</span>
                  {dir && <span className={s.filePathDir}>{dir}</span>}
                  {file.oldFilename && (
                    <span className={s.filePathDir}>
                      ← {file.oldFilename}
                    </span>
                  )}
                </span>

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
