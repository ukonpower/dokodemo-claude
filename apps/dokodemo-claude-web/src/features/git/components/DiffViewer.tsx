import React, { useEffect, useState } from 'react';
import { ArrowLeft, WrapText, RefreshCw, Loader2 } from 'lucide-react';
import type { GitDiffDetail } from '@/types';
import DiffLines from './DiffLines';
import s from './DiffViewer.module.scss';

interface DiffViewerProps {
  /** リポジトリID */
  rid: string;
  /** ファイル名 */
  filename: string;
  /** 差分詳細 */
  detail: GitDiffDetail | null;
  /** ローディング状態 */
  isLoading: boolean;
  /** エラーメッセージ */
  error: string | null;
  /** 差分詳細を取得するハンドラ */
  onRefresh: () => void;
  /** 戻るボタンのハンドラ */
  onBack: () => void;
}

/**
 * 差分表示コンポーネント
 */
const DiffViewer: React.FC<DiffViewerProps> = ({
  filename,
  detail,
  isLoading,
  error,
  onRefresh,
  onBack,
}) => {
  const [wordWrap, setWordWrap] = useState(false);

  // コンポーネントマウント時に差分を取得
  useEffect(() => {
    onRefresh();
  }, [onRefresh]);

  return (
    <div className={s.container}>
      {/* ヘッダー */}
      <div className={s.header}>
        {/* 戻るボタン */}
        <button
          onClick={onBack}
          className={s.backButton}
        >
          <ArrowLeft size={16} />
          戻る
        </button>

        {/* ファイル名 */}
        <h1 className={s.filename}>
          {filename}
        </h1>

        {/* 折り返しトグル */}
        <button
          onClick={() => setWordWrap(!wordWrap)}
          className={`${s.wrapButton} ${
            wordWrap ? s.wrapButtonActive : s.wrapButtonInactive
          }`}
          title={wordWrap ? '折り返しOFF' : '折り返しON'}
        >
          <WrapText size={16} />
        </button>

        {/* リフレッシュボタン */}
        <button
          onClick={onRefresh}
          disabled={isLoading}
          className={`${s.refreshButton} ${isLoading ? s.spinning : ''}`}
          title="更新"
        >
          <RefreshCw size={16} />
        </button>
      </div>

      {/* コンテンツ */}
      <div className={s.contentArea}>
        {/* エラー表示 */}
        {error && (
          <div className={s.errorBox}>
            {error}
          </div>
        )}

        {/* ローディング表示 */}
        {isLoading && !detail && (
          <div className={s.loadingCenter}>
            <Loader2 className={s.loadingSpinner} size={32} />
          </div>
        )}

        {/* 差分なし表示 */}
        {!isLoading && !error && detail && !detail.diff && (
          <div className={s.emptyCenter}>
            このファイルに差分はありません
          </div>
        )}

        {/* 差分表示 */}
        {!error && detail && detail.diff && (
          <DiffLines diff={detail.diff} filePath={filename} wordWrap={wordWrap} />
        )}
      </div>
    </div>
  );
};

export default DiffViewer;
