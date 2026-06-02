import { useState, useRef } from 'react';
import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { DetectedPortInfo, GitWorktree } from '../types';
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
  // 全worktreeと、repositoryPath ごとの開発サーバーポート（一覧表示用）
  worktrees: GitWorktree[];
  devServerPortsByRepo: Map<string, DetectedPortInfo[]>;
}

/**
 * 全worktreeで検出された開発サーバーを「ports」見出し付きで横並び表示する。
 * worktree 名は出さず、プロセス名＋ポート（node :3001）のリンクを横に並べる。
 */
function DevServerList({
  worktrees,
  devServerPortsByRepo,
}: {
  worktrees: GitWorktree[];
  devServerPortsByRepo: Map<string, DetectedPortInfo[]>;
}) {
  const hostname = window.location.hostname;
  // 全worktreeのポートをフラットに集約
  const ports = worktrees.flatMap(
    (wt) => devServerPortsByRepo.get(wt.path.replace(/\/+$/, '')) ?? []
  );

  if (ports.length === 0) return null;

  return (
    <div className={s.devServers}>
      <span className={s.sectionLabel}>ports</span>
      {ports.map((p) => {
        const url = `http://${hostname}:${p.port}`;
        return (
          <a
            key={`${p.terminalId}-${p.port}`}
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            className={s.devServerLink}
            title={`${url}\n${p.command} (pid: ${p.pid})`}
          >
            <span className={s.devServerCommand}>{p.command}</span>
            <span className={s.devServerPort}>:{p.port}</span>
          </a>
        );
      })}
    </div>
  );
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
    <div
      className={`${s.memoDisplay} ${memo ? '' : s.memoDisplayEmpty}`}
      onClick={() => setIsEditing(true)}
      title="クリックして編集"
    >
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
        <span className={s.memoPlaceholder}>メモを追加 ＋</span>
      )}
    </div>
  );
}

function WorktreeOperations({
  currentWorktree,
  onSaveMemo,
  mergeError,
  onClearMergeError,
  worktrees,
  devServerPortsByRepo,
}: WorktreeOperationsProps) {
  // メモは worktree（非メイン）でのみ編集可能
  const showMemo = !!currentWorktree && !currentWorktree.isMain;
  // 開発サーバーが1つでも検出されていれば一覧を出す（メインを開いていても表示）
  const hasServers = worktrees.some(
    (wt) => (devServerPortsByRepo.get(wt.path.replace(/\/+$/, '')) ?? []).length > 0
  );

  // 表示するものが何も無ければセクションごと出さない
  if (!showMemo && !hasServers) {
    return null;
  }

  return (
    <div className={s.container}>
      {showMemo && currentWorktree && (
        <div className={s.section}>
          <span className={s.sectionLabel}>note</span>
          <WorktreeMemoEditor
            key={currentWorktree.path}
            memo={currentWorktree.memo ?? ''}
            onSave={(memo) => onSaveMemo(currentWorktree.path, memo)}
          />
        </div>
      )}

      <DevServerList
        worktrees={worktrees}
        devServerPortsByRepo={devServerPortsByRepo}
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
