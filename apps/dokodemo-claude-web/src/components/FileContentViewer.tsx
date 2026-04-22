import { useMemo, useState } from 'react';
import { Highlight, themes } from 'prism-react-renderer';
import { ArrowLeft, FileText, AlertTriangle, Maximize2, Minimize2, WrapText } from 'lucide-react';
import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { FileContent, GitDiffDetail } from '../types';
import { BACKEND_URL } from '../utils/backend-url';
import '../utils/prism-languages';
import s from './FileContentViewer.module.scss';

const LANGUAGE_FALLBACK: Record<string, string> = {
  'dockerfile': 'docker',
  'mdx': 'markdown',
};

function normalizeLang(lang: string): string {
  return LANGUAGE_FALLBACK[lang] || lang;
}

const markdownComponents: Components = {
  code({ className, children }) {
    const match = /language-(\w+)/.exec(className || '');
    const code = String(children).replace(/\n$/, '');
    if (!match) {
      return (
        <code className={s.inlineCode}>
          {children}
        </code>
      );
    }
    return (
      <Highlight theme={themes.vsDark} code={code} language={normalizeLang(match[1])}>
        {({ tokens, getLineProps, getTokenProps, style }) => (
          <pre style={{ ...(style as React.CSSProperties), margin: 0, padding: '12px', borderRadius: '6px', fontSize: '0.6875rem', lineHeight: '1.5', overflow: 'auto' }}>
            {tokens.map((line, i) => {
              const lineProps = getLineProps({ line });
              return (
                <div key={i} {...lineProps} style={lineProps.style as React.CSSProperties}>
                  {line.map((token, key) => (
                    <span key={key} {...getTokenProps({ token }) as React.HTMLAttributes<HTMLSpanElement>} />
                  ))}
                </div>
              );
            })}
          </pre>
        )}
      </Highlight>
    );
  },
};

interface DiffLine {
  type: 'header' | 'hunk' | 'context' | 'addition' | 'deletion' | 'empty';
  content: string;
  lineNumber?: {
    old?: number;
    new?: number;
  };
}

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
      result.push({ type: 'context', content: line });
    }
  }

  return result;
}

function getChangedLineNumbers(diff: string): Set<number> {
  const lines = diff.split('\n');
  const addedLines = new Set<number>();
  let newLineNum = 0;

  for (const line of lines) {
    if (line.startsWith('@@')) {
      const match = line.match(/@@ -\d+,?\d* \+(\d+),?\d* @@/);
      if (match) {
        newLineNum = parseInt(match[1], 10);
      }
    } else if (line.startsWith('+')) {
      addedLines.add(newLineNum);
      newLineNum++;
    } else if (line.startsWith('-')) {
      // 削除行は新しいファイルの行番号に影響しない
    } else if (line.startsWith(' ')) {
      newLineNum++;
    }
  }

  return addedLines;
}

interface FileContentViewerProps {
  content: FileContent | null;
  isLoading: boolean;
  error: string | null;
  onBack: () => void;
  showBackButton?: boolean;
  diffDetail?: GitDiffDetail | null;
  gitStatus?: string;
  isDiffMode?: boolean;
  onToggleDiffMode?: () => void;
  isFullScreen?: boolean;
  onToggleFullScreen?: () => void;
  rid?: string;
}

export default function FileContentViewer({
  content,
  isLoading,
  error,
  onBack,
  showBackButton = false,
  diffDetail,
  gitStatus,
  isDiffMode = false,
  onToggleDiffMode,
  isFullScreen = false,
  onToggleFullScreen,
  rid,
}: FileContentViewerProps) {
  const [wordWrap, setWordWrap] = useState(false);
  const [markdownPreview, setMarkdownPreview] = useState(true);

  const isMarkdown = content?.language === 'markdown' || content?.language === 'mdx';

  const changedLines = useMemo(() => {
    if (!diffDetail?.diff) return new Set<number>();
    return getChangedLineNumbers(diffDetail.diff);
  }, [diffDetail]);

  const parsedDiffLines = useMemo(() => {
    if (!diffDetail?.diff) return [];
    return parseDiff(diffDetail.diff);
  }, [diffDetail]);

  const hasGitChange = gitStatus && gitStatus !== '';
  const hasDiff = diffDetail?.diff && diffDetail.diff.length > 0;
  const isMedia = content?.fileType === 'image' || content?.fileType === 'video';
  const mediaUrl = content && rid && isMedia
    ? `${BACKEND_URL}/api/repos/${encodeURIComponent(rid)}/raw/${content.path}`
    : null;

  if (isLoading) {
    return (
      <div className={s.loadingCenter}>
        読み込み中...
      </div>
    );
  }

  if (error) {
    return (
      <div className={s.errorCenter}>
        <AlertTriangle size={32} className={s.errorIcon} />
        <p className={s.errorText}>{error}</p>
        {showBackButton && (
          <button
            onClick={onBack}
            className={s.backLink}
          >
            <ArrowLeft size={14} />
            戻る
          </button>
        )}
      </div>
    );
  }

  if (!content) {
    return (
      <div className={s.emptyCenter}>
        <FileText size={32} />
        <p className={s.emptyText}>ファイルを選択してください</p>
      </div>
    );
  }

  const filename = content.path.split('/').pop() || content.path;

  return (
    <div className={s.container}>
      {/* ファイルヘッダー */}
      <div className={s.fileHeader}>
        {showBackButton && (
          <button
            onClick={onBack}
            className={s.backButton}
          >
            <ArrowLeft size={18} />
          </button>
        )}
        <span className={s.headerFilename}>
          {filename}
        </span>

        {/* コード / 差分 タブ切り替え（メディアファイルでは非表示） */}
        {!isMedia && hasGitChange && hasDiff && onToggleDiffMode && (
          <div className={s.tabGroup}>
            <button
              onClick={() => isDiffMode && onToggleDiffMode()}
              className={`${s.tabButton} ${
                !isDiffMode ? s.tabButtonActive : s.tabButtonInactive
              }`}
            >
              コード
            </button>
            <button
              onClick={() => !isDiffMode && onToggleDiffMode()}
              className={`${s.tabButton} ${
                isDiffMode ? s.tabButtonActive : s.tabButtonInactive
              }`}
            >
              差分
            </button>
          </div>
        )}

        {/* ソース / プレビュー タブ切り替え（markdownファイルのみ） */}
        {!isMedia && isMarkdown && !isDiffMode && (
          <div className={s.tabGroup}>
            <button
              onClick={() => setMarkdownPreview(false)}
              className={`${s.tabButton} ${
                !markdownPreview ? s.tabButtonActive : s.tabButtonInactive
              }`}
            >
              ソース
            </button>
            <button
              onClick={() => setMarkdownPreview(true)}
              className={`${s.tabButton} ${
                markdownPreview ? s.tabButtonActive : s.tabButtonInactive
              }`}
            >
              プレビュー
            </button>
          </div>
        )}

        <div className={s.headerActions}>
          {!isMedia && (
            <button
              onClick={() => setWordWrap(!wordWrap)}
              className={`${s.wrapButton} ${
                wordWrap ? s.wrapButtonActive : s.wrapButtonInactive
              }`}
              title={wordWrap ? '折り返しOFF' : '折り返しON'}
            >
              <WrapText size={16} />
            </button>
          )}
          {onToggleFullScreen && (
            <button
              onClick={onToggleFullScreen}
              className={s.fullscreenButton}
              title={isFullScreen ? '全画面解除' : '全画面表示'}
            >
              {isFullScreen ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
            </button>
          )}
        </div>
      </div>

      {/* truncated 警告 */}
      {content.truncated && (
        <div className={s.truncatedWarning}>
          <AlertTriangle size={12} />
          <span>
            {content.totalLines?.toLocaleString()}行中、最初の10,000行のみ表示
          </span>
        </div>
      )}

      {/* コンテンツ表示 */}
      <div className={s.contentArea}>
        {isMedia && mediaUrl ? (
          /* メディアプレビューモード */
          <div className={s.mediaPreview}>
            {content.fileType === 'image' ? (
              <img
                src={mediaUrl}
                alt={filename}
                className={s.mediaImage}
              />
            ) : (
              <video
                src={mediaUrl}
                controls
                className={s.mediaVideo}
              >
                ブラウザがこの動画形式をサポートしていません
              </video>
            )}
          </div>
        ) : isMarkdown && markdownPreview && !isDiffMode ? (
          /* Markdown プレビューモード */
          <div className={s.markdownPreview}>
            <ReactMarkdown
              remarkPlugins={[remarkGfm]}
              components={markdownComponents}
            >
              {content.content}
            </ReactMarkdown>
          </div>
        ) : isDiffMode && hasDiff ? (
          /* 差分モード */
          <div className={s.diffContainer}>
            {parsedDiffLines.map((line, index) => {
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
                  <span
                    className={`${wordWrap ? s.contentColWrap : s.contentCol} ${textClass}`}
                  >
                    {line.content}
                  </span>
                </div>
              );
            })}
          </div>
        ) : (
          /* コードモード */
          <Highlight theme={themes.vsDark} code={content.content} language={normalizeLang(content.language)}>
            {({ tokens, getLineProps, getTokenProps, style }) => (
              <pre style={{
                ...(style as React.CSSProperties),
                margin: 0,
                padding: '12px 0',
                backgroundColor: '#0a0a0a',
                fontSize: '13px',
                lineHeight: '1.5',
                minHeight: '100%',
                whiteSpace: wordWrap ? 'pre-wrap' : 'pre',
                wordBreak: wordWrap ? 'break-all' : 'normal',
              }}>
                {tokens.map((line, i) => {
                  const lineNumber = i + 1;
                  const isChanged = changedLines.has(lineNumber);
                  return (
                    <div key={i} {...getLineProps({ line })} style={{
                      display: 'table-row',
                      ...(isChanged ? {
                        backgroundColor: 'rgba(34, 197, 94, 0.08)',
                        borderLeft: '3px solid rgba(34, 197, 94, 0.5)',
                      } : {}),
                    }}>
                      <span style={{
                        display: 'table-cell',
                        textAlign: 'right',
                        minWidth: '3em',
                        paddingRight: '12px',
                        color: '#444',
                        userSelect: 'none',
                      }}>
                        {lineNumber}
                      </span>
                      <span style={{ display: 'table-cell' }}>
                        {line.map((token, key) => (
                          <span key={key} {...getTokenProps({ token }) as React.HTMLAttributes<HTMLSpanElement>} />
                        ))}
                      </span>
                    </div>
                  );
                })}
              </pre>
            )}
          </Highlight>
        )}
      </div>
    </div>
  );
}
