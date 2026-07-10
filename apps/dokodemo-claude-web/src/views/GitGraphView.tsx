import { useState, useCallback, useRef, useEffect } from 'react';
import { ArrowLeft, RefreshCw } from 'lucide-react';
import type { UseGitGraphReturn } from '../hooks';
import GitGraphTable from '../components/GitGraphTable';
import GitGraphCommitDetail from '../components/GitGraphCommitDetail';
import GitGraphBranchDropdown from '../components/GitGraphBranchDropdown';
import DiffViewer from '../components/DiffViewer';
import s from './GitGraphView.module.scss';

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
        <button
          className={`${s.iconButton} ${loading ? s.spinning : ''}`}
          onClick={gitGraph.refresh}
          disabled={loading}
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
