import { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import { ArrowLeft, RefreshCw, Search } from 'lucide-react';
import type { UseGitGraphReturn } from '../hooks';
import type { GitGraphRef } from '../types';
import GitGraphTable from '../components/GitGraphTable';
import GitGraphCommitDetail from '../components/GitGraphCommitDetail';
import GitGraphBranchDropdown from '../components/GitGraphBranchDropdown';
import GitGraphFindWidget from '../components/GitGraphFindWidget';
import GitGraphContextMenu, {
  type GitGraphMenuItem,
} from '../components/GitGraphContextMenu';
import GitGraphActionDialog from '../components/GitGraphActionDialog';
import DiffViewer from '../components/DiffViewer';
import s from './GitGraphView.module.scss';

/** checkout / merge 確認ダイアログの内容（種別ごとの discriminated union） */
type ActionDialogConfig =
  | { type: 'checkout-remote'; remoteName: string }
  | { type: 'checkout-commit'; hash: string }
  | { type: 'merge'; target: string; targetLabel: string };

interface GitGraphViewProps {
  gitGraph: UseGitGraphReturn;
  repoName: string;
  rid: string;
}

/**
 * Git Graph 全画面ビュー（閲覧専用）
 * コミット詳細は下部固定パネル（Docked to Bottom）方式で表示する。
 */
export function GitGraphView({ gitGraph, repoName, rid }: GitGraphViewProps) {
  const { graph, loading, error } = gitGraph;
  const [selectedHash, setSelectedHash] = useState<string | null>(null);

  // Load More 押下時のスクロール位置を保持し、再描画後に復元する
  const contentRef = useRef<HTMLDivElement>(null);
  const restoreScrollRef = useRef<number | null>(null);

  const handleLoadMore = useCallback(() => {
    restoreScrollRef.current = contentRef.current?.scrollTop ?? null;
    gitGraph.loadMore();
  }, [gitGraph]);

  useEffect(() => {
    if (restoreScrollRef.current !== null && contentRef.current) {
      contentRef.current.scrollTop = restoreScrollRef.current;
      restoreScrollRef.current = null;
    }
  }, [graph]);

  // 検索（クライアント内、ロード済み範囲のみ対象）
  const [findOpen, setFindOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [matchIndex, setMatchIndex] = useState(0); // 0 始まり

  const matchedHashes = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q || !graph) return [];
    return graph.commits
      .filter(
        (c) =>
          c.message.toLowerCase().includes(q) ||
          c.author.toLowerCase().includes(q) ||
          c.hash.toLowerCase().startsWith(q)
      )
      .map((c) => c.hash);
  }, [query, graph]);

  const matchedSet = useMemo(() => new Set(matchedHashes), [matchedHashes]);
  const currentMatchHash =
    matchedHashes.length > 0 ? matchedHashes[matchIndex] ?? null : null;

  const scrollToHash = useCallback((hash: string) => {
    const el = contentRef.current?.querySelector(
      `[data-hash="${hash}"]`
    ) as HTMLElement | null;
    el?.scrollIntoView({ block: 'center' });
  }, []);

  // クエリ変更でマッチ先頭へリセットしジャンプ
  useEffect(() => {
    setMatchIndex(0);
    if (matchedHashes.length > 0) scrollToHash(matchedHashes[0]);
  }, [query, matchedHashes, scrollToHash]);

  const goToMatch = useCallback(
    (delta: number) => {
      if (matchedHashes.length === 0) return;
      setMatchIndex((prev) => {
        const next =
          (prev + delta + matchedHashes.length) % matchedHashes.length;
        scrollToHash(matchedHashes[next]);
        return next;
      });
    },
    [matchedHashes, scrollToHash]
  );

  const closeFind = useCallback(() => {
    setFindOpen(false);
    setQuery('');
    setMatchIndex(0);
  }, []);

  const handleSelectRow = useCallback(
    (hash: string) => {
      setSelectedHash((prev) => {
        if (prev === hash) return null; // 再クリックで閉じる
        gitGraph.requestCommitDetail(hash);
        return hash;
      });
    },
    [gitGraph]
  );

  // checkout / merge のコンテキストメニューとダイアログ
  const [menu, setMenu] = useState<{
    x: number;
    y: number;
    items: GitGraphMenuItem[];
  } | null>(null);
  const [actionDialog, setActionDialog] = useState<ActionDialogConfig | null>(
    null
  );

  const currentBranch = graph?.currentBranch ?? null;
  const currentBranchLabel = currentBranch
    ? `ブランチ「${currentBranch}」`
    : '現在のブランチ';

  /** target を現在ブランチへマージするメニュー項目（マージ不能な状況では null） */
  const buildMergeItem = useCallback(
    (target: string, targetLabel: string): GitGraphMenuItem | null => {
      if (!currentBranch || target === currentBranch) return null;
      return {
        label: `${currentBranchLabel}にマージ...`,
        onClick: () => setActionDialog({ type: 'merge', target, targetLabel }),
      };
    },
    [currentBranch, currentBranchLabel]
  );

  const handleRefContextMenu = useCallback(
    (e: React.MouseEvent, ref: GitGraphRef) => {
      const items: GitGraphMenuItem[] = [];
      if (ref.type === 'branch') {
        items.push({
          label: `ブランチ「${ref.name}」をチェックアウト`,
          onClick: () => gitGraph.checkout('branch', ref.name),
        });
        const mergeItem = buildMergeItem(ref.name, `ブランチ「${ref.name}」`);
        if (mergeItem) items.push(mergeItem);
      } else if (ref.type === 'remote') {
        items.push({
          label: `リモートブランチ「${ref.name}」をチェックアウト...`,
          onClick: () =>
            setActionDialog({ type: 'checkout-remote', remoteName: ref.name }),
        });
        const mergeItem = buildMergeItem(
          ref.name,
          `リモートブランチ「${ref.name}」`
        );
        if (mergeItem) items.push(mergeItem);
      } else if (ref.type === 'tag') {
        const mergeItem = buildMergeItem(ref.name, `タグ「${ref.name}」`);
        if (mergeItem) items.push(mergeItem);
      }
      // head chip（現在ブランチ）には項目なし
      if (items.length > 0) {
        setMenu({ x: e.clientX, y: e.clientY, items });
      }
    },
    [gitGraph, buildMergeItem]
  );

  const handleRefDoubleClick = useCallback(
    (ref: GitGraphRef) => {
      // vscode-git-graph 同様、ダブルクリックでチェックアウト
      if (ref.type === 'branch') {
        gitGraph.checkout('branch', ref.name);
      } else if (ref.type === 'remote') {
        setActionDialog({ type: 'checkout-remote', remoteName: ref.name });
      }
    },
    [gitGraph]
  );

  const handleRowContextMenu = useCallback(
    (e: React.MouseEvent, hash: string) => {
      const short = hash.slice(0, 8);
      const items: GitGraphMenuItem[] = [
        {
          label: `コミット ${short} をチェックアウト...`,
          onClick: () => setActionDialog({ type: 'checkout-commit', hash }),
        },
      ];
      const mergeItem = buildMergeItem(hash, `コミット ${short}`);
      if (mergeItem) items.push(mergeItem);
      setMenu({ x: e.clientX, y: e.clientY, items });
    },
    [buildMergeItem]
  );

  const fileDiffOpen = gitGraph.fileDiffHash !== null;

  return (
    <div className={s.container}>
      {/* ヘッダ（1 行） */}
      <div className={s.header}>
        <button
          className={s.iconButton}
          onClick={gitGraph.handleBack}
          title="戻る"
          aria-label="戻る"
        >
          <ArrowLeft size={16} />
        </button>
        <span className={s.title}>Git Graph</span>
        <span className={s.repoName}>{repoName}</span>
        {graph && (
          <GitGraphBranchDropdown
            branchOptions={graph.branchOptions}
            selected={gitGraph.selectedBranch}
            onSelect={gitGraph.setBranch}
          />
        )}
        <span className={s.spacer} />
        {findOpen ? (
          <GitGraphFindWidget
            query={query}
            onQueryChange={setQuery}
            matchCount={matchedHashes.length}
            currentIndex={matchedHashes.length > 0 ? matchIndex + 1 : 0}
            onPrev={() => goToMatch(-1)}
            onNext={() => goToMatch(1)}
            onClose={closeFind}
          />
        ) : (
          <button
            className={s.iconButton}
            onClick={() => setFindOpen(true)}
            title="検索"
            aria-label="検索"
          >
            <Search size={16} />
          </button>
        )}
        <button
          className={`${s.iconButton} ${loading || gitGraph.actionInProgress ? s.spinning : ''}`}
          onClick={gitGraph.refresh}
          disabled={loading || gitGraph.actionInProgress}
          title="更新"
          aria-label="更新"
        >
          <RefreshCw size={16} />
        </button>
      </div>

      {/* コンテンツ（テーブル） */}
      <div className={s.content} ref={contentRef}>
        {error && <div className={s.errorBox}>{error}</div>}

        {!graph && loading && (
          <div className={s.centerMessage}>読み込み中...</div>
        )}

        {graph && graph.commits.length === 0 && !loading && (
          <div className={s.centerMessage}>コミットがありません</div>
        )}

        {graph && graph.commits.length > 0 && (
          <GitGraphTable
            graph={graph}
            selectedHash={selectedHash}
            onSelectRow={handleSelectRow}
            matchedHashes={matchedSet}
            currentMatchHash={currentMatchHash}
            onRefContextMenu={handleRefContextMenu}
            onRefDoubleClick={handleRefDoubleClick}
            onRowContextMenu={handleRowContextMenu}
          />
        )}

        {graph && graph.moreAvailable && (
          <div className={s.loadMoreWrap}>
            <button
              className={s.loadMoreButton}
              onClick={handleLoadMore}
              disabled={loading}
            >
              {loading && (
                <RefreshCw size={13} className={s.loadMoreSpinner} />
              )}
              {loading ? '読み込み中...' : 'さらに読み込む'}
            </button>
          </div>
        )}
      </div>

      {/* コミット詳細（下部固定パネル） */}
      {selectedHash && (
        <GitGraphCommitDetail
          hash={selectedHash}
          detail={gitGraph.detailByHash[selectedHash] ?? null}
          isLoading={gitGraph.detailLoadingHash === selectedHash}
          onFileClick={(filename, oldFilename) =>
            gitGraph.requestFileDiff(selectedHash, filename, oldFilename)
          }
          onClose={() => setSelectedHash(null)}
        />
      )}

      {/* checkout / merge コンテキストメニュー */}
      {menu && (
        <GitGraphContextMenu
          x={menu.x}
          y={menu.y}
          items={menu.items}
          onClose={() => setMenu(null)}
        />
      )}

      {/* checkout / merge 確認ダイアログ */}
      {actionDialog?.type === 'checkout-remote' && (
        <GitGraphActionDialog
          message={`リモートブランチ「${actionDialog.remoteName}」をチェックアウトしますか？`}
          input={{
            label: '作成するローカルブランチ名',
            defaultValue: actionDialog.remoteName
              .split('/')
              .slice(1)
              .join('/'),
          }}
          confirmLabel="チェックアウト"
          onConfirm={({ inputValue }) => {
            setActionDialog(null);
            gitGraph.checkout('remote', actionDialog.remoteName, inputValue);
          }}
          onCancel={() => setActionDialog(null)}
        />
      )}
      {actionDialog?.type === 'checkout-commit' && (
        <GitGraphActionDialog
          message={`コミット ${actionDialog.hash.slice(0, 8)} をチェックアウトしますか？（detached HEAD 状態になります）`}
          confirmLabel="チェックアウト"
          onConfirm={() => {
            setActionDialog(null);
            gitGraph.checkout('commit', actionDialog.hash);
          }}
          onCancel={() => setActionDialog(null)}
        />
      )}
      {actionDialog?.type === 'merge' && (
        <GitGraphActionDialog
          message={`${actionDialog.targetLabel}を${currentBranchLabel}にマージしますか？`}
          checkboxes={[
            {
              key: 'noFF',
              label: 'fast-forward 可能でも新しいコミットを作成する (--no-ff)',
              defaultChecked: true,
            },
            {
              key: 'squash',
              label: 'コミットを 1 つにまとめる (--squash)',
              defaultChecked: false,
            },
            {
              key: 'noCommit',
              label: 'コミットしない (--no-commit)',
              defaultChecked: false,
            },
          ]}
          confirmLabel="マージ"
          onConfirm={({ checks }) => {
            setActionDialog(null);
            gitGraph.merge(actionDialog.target, {
              noFF: checks.noFF ?? false,
              squash: checks.squash ?? false,
              noCommit: checks.noCommit ?? false,
            });
          }}
          onCancel={() => setActionDialog(null)}
        />
      )}

      {/* ファイル diff（全画面オーバーレイ） */}
      {fileDiffOpen && (
        <div className={s.diffOverlay}>
          <DiffViewer
            rid={rid}
            filename={gitGraph.fileDiffFilename}
            detail={gitGraph.fileDiff}
            isLoading={gitGraph.fileDiffLoading}
            error={null}
            onRefresh={gitGraph.refreshFileDiff}
            onBack={gitGraph.closeFileDiff}
          />
        </div>
      )}
    </div>
  );
}

export default GitGraphView;
