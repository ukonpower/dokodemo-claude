import { useState, useRef } from 'react';
import { Pencil, ChevronDown, AlertTriangle } from 'lucide-react';
import type { DetectedPortInfo } from '@/types';
import { useRepositoryContext } from '@/features/repo/providers/RepositoryProvider';
import { useTerminalContext } from '@/features/terminal/providers/TerminalProvider';
import { useWorktreeContext } from '@/features/worktree/providers/WorktreeProvider';
import MarkdownViewer from '@/shared/components/MarkdownViewer';
import Button from '@/shared/components/Button';
import s from './WorktreeOperations.module.scss';

/**
 * 今開いているワークツリーで検出された開発サーバーを「ports」見出し付きで横並び表示する。
 * プロセス名＋ポート（node :3001）のリンクを横に並べる。
 */
function DevServerList({ ports }: { ports: DetectedPortInfo[] }) {
  const hostname = window.location.hostname;

  if (ports.length === 0) return null;

  return (
    <div className={s.devServers}>
      <span className={s.sectionLabel}>ports</span>
      {ports.map((p) => {
        const url = `${p.protocol}://${hostname}:${p.port}`;
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
            } else if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
              // Cmd/Ctrl+Enter で保存して編集終了
              e.preventDefault();
              // blur 経由の二重保存を防ぐ
              skipBlurSaveRef.current = true;
              saveEdit();
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
          <Button variant="primary" size="sm" onClick={saveEdit}>
            保存
          </Button>
          <Button
            size="sm"
            onMouseDown={() => {
              // blur より先に発火させ、blur 保存を抑止する
              skipBlurSaveRef.current = true;
            }}
            onClick={cancelEdit}
          >
            キャンセル
          </Button>
        </div>
      </div>
    );
  }

  // 空メモ時はボックスを出さずインラインのプレースホルダだけ表示（クリックで編集）
  if (!memo) {
    return (
      <span
        className={s.memoPlaceholder}
        onClick={() => setIsEditing(true)}
        title="クリックして編集"
      >
        メモを追加 ＋
      </span>
    );
  }

  return (
    <div className={s.memoDisplay}>
      <button
        className={s.memoEditButton}
        onClick={() => setIsEditing(true)}
        title="メモを編集"
      >
        <Pencil size={16} className={s.memoEditIcon} />
      </button>
      <MarkdownViewer content={memo} stopLinkPropagation />
    </div>
  );
}

function WorktreeOperations() {
  // リポジトリ関連
  const { repository } = useRepositoryContext();
  const { currentRepo } = repository;

  // ブランチ・ワークツリー関連
  const branchWorktree = useWorktreeContext();
  const {
    worktrees,
    mergeError,
    saveWorktreeMemo: onSaveMemo,
  } = branchWorktree;
  const onClearMergeError = () => branchWorktree.setMergeError(null);

  // repositoryPath ごとの開発サーバーポート（今開いているワークツリーの分を表示する）
  const { terminal } = useTerminalContext();
  const { devServerPortsByRepo } = terminal;

  // 今開いているワークツリー
  const normalizedCurrentRepo = currentRepo.replace(/\/+$/, '');
  const currentWorktree = worktrees.find(
    (w) => w.path.replace(/\/+$/, '') === normalizedCurrentRepo
  );

  // メモは worktree（非メイン）でのみ編集可能
  const showMemo = !!currentWorktree && !currentWorktree.isMain;
  // メモの折りたたみ状態（note ラベルのクリックで切替。ワークツリーを跨いでも維持）
  const [isMemoCollapsed, setIsMemoCollapsed] = useState(false);
  // 今開いているワークツリーで検出された開発サーバーポート
  const currentPorts = currentWorktree
    ? (devServerPortsByRepo.get(currentWorktree.path.replace(/\/+$/, '')) ?? [])
    : [];
  const hasServers = currentPorts.length > 0;

  // 表示するものが何も無ければセクションごと出さない
  if (!showMemo && !hasServers) {
    return null;
  }

  return (
    <div className={s.container}>
      {showMemo && currentWorktree && (
        <div className={s.section}>
          <button
            className={s.sectionToggle}
            onClick={() => setIsMemoCollapsed((prev) => !prev)}
            title={isMemoCollapsed ? 'メモを展開' : 'メモを折りたたむ'}
          >
            <ChevronDown
              className={`${s.sectionChevron} ${
                isMemoCollapsed ? s.sectionChevronCollapsed : ''
              }`}
            />
            <span className={s.sectionLabel}>note</span>
          </button>
          {!isMemoCollapsed && (
            <WorktreeMemoEditor
              key={currentWorktree.path}
              memo={currentWorktree.memo ?? ''}
              onSave={(memo) => onSaveMemo(currentWorktree.path, memo)}
            />
          )}
        </div>
      )}

      <DevServerList ports={currentPorts} />

      {/* マージエラーモーダル（タブからのマージ失敗時に表示） */}
      {mergeError && (
        <div className={s.modalOverlay}>
          <div className={s.modalContent}>
            <div className={s.modalHeader}>
              <div className={`${s.modalIconCircle} ${s.modalIconCircleRed}`}>
                <AlertTriangle className={`${s.modalIcon} ${s.modalIconRed}`} />
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
              <Button onClick={onClearMergeError}>閉じる</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default WorktreeOperations;
