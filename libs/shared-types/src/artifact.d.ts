// claude.ai Artifact 一覧の型定義

/**
 * リポジトリ / ワークツリーで publish された claude.ai Artifact 1 件。
 * claude.ai に一覧 API が無いため、Claude Code の transcript に残る publish 結果から組み立てる。
 */
export interface ArtifactInfo {
  /** claude.ai の Artifact URL（同じ url は 1 件にまとめる） */
  url: string;
  /** 最新の publish 時点のタイトル */
  title: string;
  /** 最新の publish 時刻（epoch ミリ秒） */
  updatedAt: number;
}
