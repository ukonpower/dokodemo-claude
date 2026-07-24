import React, { useEffect, useCallback } from 'react';
import { GitBranch, Loader2 } from 'lucide-react';
import type { GitDiffFile, GitDiffSummary } from '@/types';
import EmptyState from '@/shared/components/EmptyState';
import { FileIcon, splitFilePath } from '@/shared/utils/file-icon';
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
  // 色はデザイントークンのプリミティブ値と一致させている
  // （SCSS 変数は TSX から参照できないため、同値の hex を直書き）:
  // A=$color-success, D=$color-error, R=$color-info, U(untracked)=$purple-400, M=$color-warning
  switch (status) {
    case 'A':
      return { icon: '+', textColor: '#10b981', bgColor: '#064e3b' }; // emerald-500 / emerald-900
    case 'D':
      return { icon: '-', textColor: '#ef4444', bgColor: '#7f1d1d' }; // red-500 / red-900
    case 'R':
      return { icon: 'R', textColor: '#3b82f6', bgColor: '#1e3a8a' }; // blue-500 / blue-900
    case 'U':
      return { icon: '?', textColor: '#c084fc', bgColor: '#581c87' }; // purple-400 / purple-900
    case 'M':
    default:
      return { icon: 'M', textColor: '#f59e0b', bgColor: '#78350f' }; // amber-500 / amber-900
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
          <Loader2 className={s.loadingSpinner} size={16} />
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
