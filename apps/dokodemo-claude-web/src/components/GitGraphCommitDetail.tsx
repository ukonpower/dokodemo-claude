import React, { useEffect, useRef, useState, useCallback } from 'react';
import { X, RefreshCw, WrapText } from 'lucide-react';
import type {
  GitGraphCommitDetail as CommitDetail,
  GitGraphFileChange,
  GitDiffDetail,
} from '../types';
import { formatGraphDate } from '../utils/git-graph-layout';
import DiffLines from './DiffLines';
import s from './GitGraphCommitDetail.module.scss';

interface GitGraphCommitDetailProps {
  hash: string;
  detail: CommitDetail | null;
  isLoading: boolean;
  /** 右ペインに表示する選択中ファイルの差分 */
  fileDiff: GitDiffDetail | null;
  fileDiffLoading: boolean;
  fileDiffFilename: string;
  fileDiffHash: string | null;
  onFileClick: (filename: string, oldFilename?: string) => void;
  onRefreshFileDiff: () => void;
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
 * コミット詳細（下部固定パネル、画面の約半分）。
 * 左ペインに変更ファイル一覧、右ペインに選択中ファイルの差分を並べて表示する。
 */
const GitGraphCommitDetail: React.FC<GitGraphCommitDetailProps> = ({
  hash,
  detail,
  isLoading,
  fileDiff,
  fileDiffLoading,
  fileDiffFilename,
  fileDiffHash,
  onFileClick,
  onRefreshFileDiff,
  onClose,
}) => {
  const [wordWrap, setWordWrap] = useState(false);

  // パネル高さ（ユーザーがドラッグで調整可能・localStorage に永続化）
  const panelRef = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState<number | null>(() => {
    const saved = Number(localStorage.getItem('gitGraphDetailHeight'));
    return Number.isFinite(saved) && saved > 0 ? saved : null;
  });

  const handleResizeStart = useCallback((e: React.PointerEvent) => {
    e.preventDefault();
    const startY = e.clientY;
    const startHeight = panelRef.current?.offsetHeight ?? 0;

    const onMove = (ev: PointerEvent) => {
      // 上方向ドラッグで高くする
      const dy = startY - ev.clientY;
      const max = window.innerHeight * 0.92;
      const next = Math.max(180, Math.min(startHeight + dy, max));
      setHeight(next);
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      document.body.style.userSelect = '';
      setHeight((h) => {
        if (h !== null) localStorage.setItem('gitGraphDetailHeight', String(h));
        return h;
      });
    };
    // ドラッグ中のテキスト選択を抑止
    document.body.style.userSelect = 'none';
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  }, []);

  // コミット詳細が読み込まれたら、先頭ファイルの差分を自動選択して右ペインに表示する
  useEffect(() => {
    if (!detail || detail.files.length === 0) return;
    // このコミットのファイルをまだ表示していなければ先頭を開く
    if (fileDiffHash === hash) return;
    const first = detail.files[0];
    onFileClick(first.filename, first.oldFilename);
  }, [detail, hash, fileDiffHash, onFileClick]);

  const activeMatchesHash = fileDiffHash === hash;

  return (
    <div
      className={s.panel}
      ref={panelRef}
      style={height !== null ? { height: `${height}px` } : undefined}
    >
      {/* 上辺のリサイズハンドル（ドラッグで高さ変更） */}
      <div
        className={s.resizer}
        onPointerDown={handleResizeStart}
        title="ドラッグで高さを変更"
      />
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
            {/* 左ペイン: メタ情報 + メッセージ + ファイル一覧 */}
            <div className={s.leftPane}>
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
                  const isActive =
                    activeMatchesHash && fileDiffFilename === f.filename;
                  return (
                    <button
                      key={f.filename}
                      className={`${s.fileButton} ${isActive ? s.fileButtonActive : ''}`}
                      onClick={() => onFileClick(f.filename, f.oldFilename)}
                    >
                      <span
                        className={s.statusBadge}
                        style={{ color: st.color, backgroundColor: st.bg }}
                      >
                        {st.label}
                      </span>
                      <span className={s.filePath}>
                        {f.oldFilename
                          ? `${f.oldFilename} → ${f.filename}`
                          : f.filename}
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
            </div>

            {/* 右ペイン: 選択中ファイルの差分 */}
            <div className={s.rightPane}>
              {detail.files.length === 0 ? (
                <div className={s.diffPlaceholder}>変更はありません</div>
              ) : (
                <>
                  <div className={s.diffHeader}>
                    <span className={s.diffFilename}>
                      {activeMatchesHash && fileDiffFilename
                        ? fileDiffFilename
                        : 'ファイルを選択'}
                    </span>
                    <button
                      className={`${s.diffIconButton} ${wordWrap ? s.diffIconButtonActive : ''}`}
                      onClick={() => setWordWrap((v) => !v)}
                      title={wordWrap ? '折り返しOFF' : '折り返しON'}
                      aria-label="折り返し切り替え"
                    >
                      <WrapText size={14} />
                    </button>
                    <button
                      className={`${s.diffIconButton} ${fileDiffLoading ? s.spinning : ''}`}
                      onClick={onRefreshFileDiff}
                      disabled={fileDiffLoading}
                      title="更新"
                      aria-label="更新"
                    >
                      <RefreshCw size={14} />
                    </button>
                  </div>
                  <div className={s.diffScroll}>
                    {fileDiffLoading && !fileDiff && (
                      <div className={s.diffPlaceholder}>読み込み中...</div>
                    )}
                    {!fileDiffLoading && activeMatchesHash && fileDiff && !fileDiff.diff && (
                      <div className={s.diffPlaceholder}>
                        このファイルに差分はありません
                      </div>
                    )}
                    {activeMatchesHash && fileDiff && fileDiff.diff && (
                      <DiffLines diff={fileDiff.diff} wordWrap={wordWrap} />
                    )}
                  </div>
                </>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
};

export default GitGraphCommitDetail;
