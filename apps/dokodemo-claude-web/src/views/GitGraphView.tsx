import { ArrowLeft, RefreshCw } from 'lucide-react';
import type { UseGitGraphReturn } from '../hooks';
import GitGraphTable from '../components/GitGraphTable';
import s from './GitGraphView.module.scss';

interface GitGraphViewProps {
  gitGraph: UseGitGraphReturn;
  repoName: string;
}

/**
 * Git Graph 全画面ビュー（閲覧専用）
 * ステップ 3 時点ではグラフ SVG 無しのテーブル骨格。
 */
export function GitGraphView({ gitGraph, repoName }: GitGraphViewProps) {
  const { graph, loading, error } = gitGraph;

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

      {/* コンテンツ */}
      <div className={s.content}>
        {error && <div className={s.errorBox}>{error}</div>}

        {!graph && loading && (
          <div className={s.centerMessage}>読み込み中...</div>
        )}

        {graph && graph.commits.length === 0 && !loading && (
          <div className={s.centerMessage}>コミットがありません</div>
        )}

        {graph && graph.commits.length > 0 && <GitGraphTable graph={graph} />}

        {graph && graph.moreAvailable && (
          <div className={s.loadMoreWrap}>
            <button
              className={s.loadMoreButton}
              onClick={gitGraph.loadMore}
              disabled={loading}
            >
              {loading ? '読み込み中...' : 'さらに読み込む'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

export default GitGraphView;
