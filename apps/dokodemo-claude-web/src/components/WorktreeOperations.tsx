import { useState, useRef } from 'react';
import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { GitWorktree } from '../types';
import s from './WorktreeOperations.module.scss';

interface WorktreeOperationsProps {
  currentWorktree: GitWorktree | undefined;
  onSaveMemo: (worktreePath: string, memo: string) => void;
  mergeError: {
    message: string;
    conflictFiles?: string[];
    errorDetails?: string;
  } | null;
  onClearMergeError: () => void;
}

// メモ用 Markdown コンポーネント。
// リンクは別タブで開き、クリックしても編集モードに入らないよう伝播を止める。
const memoMarkdownComponents: Components = {
  a({ href, children }) {
    return (
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        onClick={(e) => e.stopPropagation()}
      >
        {children}
      </a>
    );
  },
};

/**
 * ワークツリーメモの表示・編集。
 * 表示モードでは Markdown としてレンダリング、編集モードでは textarea を表示する。
 * draft の初期値は memo。ワークツリー切替時のリセットは親側の key で行う。
 */
function WorktreeMemoEditor({
  memo,
  onSave,
}: {
  memo: string;
  onSave: (memo: string) => void;
}) {
  const [isEditing, setIsEditing] = useState(false);
  const [draft, setDraft] = useState(memo);
  // blur 時に保存をスキップするフラグ（Esc・キャンセル経由の脱出で使用）
  const skipBlurSaveRef = useRef(false);

  const saveEdit = () => {
    onSave(draft);
    setIsEditing(false);
  };

  const cancelEdit = () => {
    skipBlurSaveRef.current = true;
    setDraft(memo);
    setIsEditing(false);
  };

  if (isEditing) {
    return (
      <div className={s.memoEditor}>
        <textarea
          className={s.memoTextarea}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              e.preventDefault();
              cancelEdit();
            }
          }}
          onBlur={() => {
            // テキストエリア外をクリックしたら保存（Esc・キャンセル時は除く）
            if (skipBlurSaveRef.current) {
              skipBlurSaveRef.current = false;
              return;
            }
            saveEdit();
          }}
          placeholder="このワークツリーのメモ...（Markdown 記法が使えます）"
          autoFocus
        />
        <div className={s.memoEditorButtons}>
          <button className={s.memoSaveButton} onClick={saveEdit}>
            保存
          </button>
          <button
            className={s.memoCancelButton}
            onMouseDown={() => {
              // blur より先に発火させ、blur 保存を抑止する
              skipBlurSaveRef.current = true;
            }}
            onClick={cancelEdit}
          >
            キャンセル
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className={s.memoDisplay}>
      <button
        className={s.memoEditButton}
        onClick={() => setIsEditing(true)}
        title="メモを編集"
      >
        <svg
          className={s.memoEditIcon}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"
          />
        </svg>
      </button>
      {memo ? (
        <div className={s.memoMarkdown}>
          <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            components={memoMarkdownComponents}
          >
            {memo}
          </ReactMarkdown>
        </div>
      ) : (
        <span className={s.memoPlaceholder}>メモを追加</span>
      )}
    </div>
  );
}

function WorktreeOperations({
  currentWorktree,
  onSaveMemo,
  mergeError,
  onClearMergeError,
}: WorktreeOperationsProps) {
  // メインワークツリーの場合は表示しない
  if (!currentWorktree || currentWorktree.isMain) {
    return null;
  }

  return (
    <div className={s.container}>
      <WorktreeMemoEditor
        key={currentWorktree.path}
        memo={currentWorktree.memo ?? ''}
        onSave={(memo) => onSaveMemo(currentWorktree.path, memo)}
      />

      {/* マージエラーモーダル（タブからのマージ失敗時に表示） */}
      {mergeError && (
        <div className={s.modalOverlay}>
          <div className={s.modalContent}>
            <div className={s.modalHeader}>
              <div className={`${s.modalIconCircle} ${s.modalIconCircleRed}`}>
                <svg
                  className={`${s.modalIcon} ${s.modalIconRed}`}
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                  />
                </svg>
              </div>
              <h3 className={s.modalTitle}>マージエラー</h3>
            </div>

            <p className={s.modalText}>{mergeError.message}</p>

            {mergeError.conflictFiles &&
              mergeError.conflictFiles.length > 0 && (
                <div className={s.errorBox}>
                  <p className={s.errorTitle}>
                    コンフリクトが発生したファイル:
                  </p>
                  <ul className={s.errorFileList}>
                    {mergeError.conflictFiles.map((file, index) => (
                      <li key={index} className={s.errorFileMono}>
                        {file}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

            {mergeError.errorDetails && (
              <div className={s.detailBox}>
                <p className={s.detailTitle}>エラー詳細:</p>
                <pre className={s.detailPre}>{mergeError.errorDetails}</pre>
              </div>
            )}

            <div className={s.modalFooterEnd}>
              <button onClick={onClearMergeError} className={s.closeButton}>
                閉じる
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default WorktreeOperations;
