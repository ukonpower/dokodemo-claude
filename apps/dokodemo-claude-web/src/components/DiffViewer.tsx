import React, { useEffect, useMemo, useState } from 'react';
import type { GitDiffDetail } from '../types';
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

interface DiffLine {
  type: 'header' | 'hunk' | 'context' | 'addition' | 'deletion' | 'empty';
  content: string;
  lineNumber?: {
    old?: number;
    new?: number;
  };
}

/**
 * 差分テキストをパースして行ごとの情報を返す
 */
function parseDiff(diff: string): DiffLine[] {
  const lines = diff.split('\n');
  const result: DiffLine[] = [];
  let oldLineNum = 0;
  let newLineNum = 0;

  for (const line of lines) {
    if (
      line.startsWith('diff ') ||
      line.startsWith('index ') ||
      line.startsWith('---') ||
      line.startsWith('+++')
    ) {
      result.push({ type: 'header', content: line });
    } else if (line.startsWith('@@')) {
      // ハンクヘッダーをパース (@@ -1,3 +1,4 @@)
      const match = line.match(/@@ -(\d+),?\d* \+(\d+),?\d* @@/);
      if (match) {
        oldLineNum = parseInt(match[1], 10);
        newLineNum = parseInt(match[2], 10);
      }
      result.push({ type: 'hunk', content: line });
    } else if (line.startsWith('+')) {
      result.push({
        type: 'addition',
        content: line.substring(1),
        lineNumber: { new: newLineNum },
      });
      newLineNum++;
    } else if (line.startsWith('-')) {
      result.push({
        type: 'deletion',
        content: line.substring(1),
        lineNumber: { old: oldLineNum },
      });
      oldLineNum++;
    } else if (line.startsWith(' ')) {
      result.push({
        type: 'context',
        content: line.substring(1),
        lineNumber: { old: oldLineNum, new: newLineNum },
      });
      oldLineNum++;
      newLineNum++;
    } else if (line === '') {
      result.push({ type: 'empty', content: '' });
    } else {
      // その他の行（No newline at end of file など）
      result.push({ type: 'context', content: line });
    }
  }

  return result;
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

  // 差分をパース
  const parsedLines = useMemo(() => {
    if (!detail?.diff) return [];
    return parseDiff(detail.diff);
  }, [detail]);

  return (
    <div className={s.container}>
      {/* ヘッダー */}
      <div className={s.header}>
        {/* 戻るボタン */}
        <button
          onClick={onBack}
          className={s.backButton}
        >
          <svg
            className={s.backIcon}
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M15 19l-7-7 7-7"
            />
          </svg>
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
          <svg className={s.wrapIcon} fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 6h18M3 12h15a3 3 0 110 6h-4m0 0l2-2m-2 2l2 2M3 18h7" />
          </svg>
        </button>

        {/* リフレッシュボタン */}
        <button
          onClick={onRefresh}
          disabled={isLoading}
          className={`${s.refreshButton} ${isLoading ? s.spinning : ''}`}
          title="更新"
        >
          <svg
            className={s.refreshIcon}
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
            />
          </svg>
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
            <svg
              className={s.loadingSpinner}
              fill="none"
              viewBox="0 0 24 24"
            >
              <circle
                className={s.spinnerCircle}
                cx="12"
                cy="12"
                r="10"
                stroke="currentColor"
                strokeWidth="4"
              />
              <path
                className={s.spinnerPath}
                fill="currentColor"
                d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
              />
            </svg>
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
          <div className={s.diffContainer}>
            {parsedLines.map((line, index) => {
              let bgClass = '';
              let textClass = s.textDefault;
              let lineNumClass = s.lineNumDefault;

              switch (line.type) {
                case 'header':
                  bgClass = s.bgHeader;
                  textClass = s.textHeader;
                  break;
                case 'hunk':
                  bgClass = s.bgHunk;
                  textClass = s.textHunk;
                  break;
                case 'addition':
                  bgClass = s.bgAddition;
                  textClass = s.textAddition;
                  lineNumClass = s.lineNumAddition;
                  break;
                case 'deletion':
                  bgClass = s.bgDeletion;
                  textClass = s.textDeletion;
                  lineNumClass = s.lineNumDeletion;
                  break;
                case 'context':
                  bgClass = '';
                  textClass = s.textContext;
                  break;
                case 'empty':
                  break;
              }

              return (
                <div
                  key={index}
                  className={`${s.diffLine} ${bgClass}`}
                >
                  {/* 行番号 */}
                  {(line.type === 'addition' ||
                    line.type === 'deletion' ||
                    line.type === 'context') && (
                    <>
                      <span
                        className={`${s.lineNum} ${lineNumClass}`}
                      >
                        {line.lineNumber?.old ?? ''}
                      </span>
                      <span
                        className={`${s.lineNum} ${lineNumClass}`}
                      >
                        {line.lineNumber?.new ?? ''}
                      </span>
                    </>
                  )}

                  {/* 記号 */}
                  {(line.type === 'addition' ||
                    line.type === 'deletion' ||
                    line.type === 'context') && (
                    <span
                      className={`${s.signCol} ${
                        line.type === 'addition'
                          ? s.signAddition
                          : line.type === 'deletion'
                            ? s.signDeletion
                            : s.signContext
                      }`}
                    >
                      {line.type === 'addition'
                        ? '+'
                        : line.type === 'deletion'
                          ? '-'
                          : ' '}
                    </span>
                  )}

                  {/* コンテンツ */}
                  <span
                    className={`${wordWrap ? s.contentColWrap : s.contentCol} ${textClass}`}
                  >
                    {line.content}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};

export default DiffViewer;
