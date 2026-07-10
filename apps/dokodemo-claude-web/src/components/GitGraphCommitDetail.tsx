import React from 'react';
import { X } from 'lucide-react';
import type { GitGraphCommitDetail as CommitDetail, GitGraphFileChange } from '../types';
import { formatGraphDate } from '../utils/git-graph-layout';
import s from './GitGraphCommitDetail.module.scss';

interface GitGraphCommitDetailProps {
  hash: string;
  detail: CommitDetail | null;
  isLoading: boolean;
  onFileClick: (filename: string, oldFilename?: string) => void;
  onClose: () => void;
}

function statusStyle(status: GitGraphFileChange['status']): {
  label: string;
  color: string;
  bg: string;
} {
  switch (status) {
    case 'A':
      return { label: 'A', color: '#4ade80', bg: '#14532d' };
    case 'D':
      return { label: 'D', color: '#f87171', bg: '#7f1d1d' };
    case 'R':
      return { label: 'R', color: '#60a5fa', bg: '#1e3a5f' };
    case 'M':
    default:
      return { label: 'M', color: '#fbbf24', bg: '#854d0e' };
  }
}

/**
 * コミット詳細（下部固定パネル）。
 * ファイルクリックで DiffViewer オーバーレイを開く。
 */
const GitGraphCommitDetail: React.FC<GitGraphCommitDetailProps> = ({
  hash,
  detail,
  isLoading,
  onFileClick,
  onClose,
}) => {
  return (
    <div className={s.panel}>
      <div className={s.header}>
        <span className={s.headerHash}>{hash.slice(0, 8)}</span>
        <span className={s.headerTitle}>
          {detail ? detail.body.split('\n')[0] : ''}
        </span>
        <span className={s.spacer} />
        <button
          className={s.closeButton}
          onClick={onClose}
          title="閉じる"
          aria-label="閉じる"
        >
          <X size={16} />
        </button>
      </div>

      <div className={s.body}>
        {isLoading && !detail && (
          <div className={s.loading}>読み込み中...</div>
        )}

        {detail && (
          <>
            <div className={s.meta}>
              <div className={s.metaRow}>
                <span className={s.metaLabel}>Author</span>
                <span className={s.metaValue}>
                  {detail.author} &lt;{detail.email}&gt; ·{' '}
                  {formatGraphDate(detail.authorDate)}
                </span>
              </div>
              <div className={s.metaRow}>
                <span className={s.metaLabel}>Committer</span>
                <span className={s.metaValue}>
                  {detail.committer} · {formatGraphDate(detail.commitDate)}
                </span>
              </div>
              <div className={s.metaRow}>
                <span className={s.metaLabel}>Parents</span>
                <span className={s.metaValue}>
                  {detail.parents.length > 0
                    ? detail.parents.map((p) => p.slice(0, 8)).join(', ')
                    : '(なし)'}
                </span>
              </div>
            </div>

            {detail.body.trim() && (
              <pre className={s.message}>{detail.body.trim()}</pre>
            )}

            <div className={s.fileList}>
              {detail.files.map((f) => {
                const st = statusStyle(f.status);
                return (
                  <button
                    key={f.filename}
                    className={s.fileButton}
                    onClick={() => onFileClick(f.filename, f.oldFilename)}
                  >
                    <span
                      className={s.statusBadge}
                      style={{ color: st.color, backgroundColor: st.bg }}
                    >
                      {st.label}
                    </span>
                    <span className={s.filePath}>
                      {f.oldFilename ? `${f.oldFilename} → ${f.filename}` : f.filename}
                    </span>
                    <span className={s.stats}>
                      {f.additions > 0 && (
                        <span className={s.add}>+{f.additions}</span>
                      )}
                      {f.deletions > 0 && (
                        <span className={s.del}>-{f.deletions}</span>
                      )}
                    </span>
                  </button>
                );
              })}
              {detail.files.length === 0 && (
                <div className={s.noFiles}>変更ファイルはありません</div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
};

export default GitGraphCommitDetail;
