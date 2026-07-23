import { useMemo } from 'react';
import { Highlight, themes } from 'prism-react-renderer';
import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import '../../utils/prism-languages';
import s from './MarkdownViewer.module.scss';

const LANGUAGE_FALLBACK: Record<string, string> = {
  'dockerfile': 'docker',
  'mdx': 'markdown',
};

function normalizeLang(lang: string): string {
  return LANGUAGE_FALLBACK[lang] || lang;
}

// prism によるコードブロックハイライト + インラインコード描画。
function renderCode({ className, children }: { className?: string; children?: React.ReactNode }) {
  const match = /language-(\w+)/.exec(className || '');
  const code = String(children).replace(/\n$/, '');
  if (!match) {
    return <code className={s.inlineCode}>{children}</code>;
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
}

interface MarkdownViewerProps {
  /** 表示する Markdown テキスト */
  content: string;
  /** 外側に padding（1rem）を付ける場合 true。デフォルトは余白なし */
  padded?: boolean;
  /**
   * リンククリック時にイベント伝播を止める。
   * 親要素のクリック（例: メモのクリックで編集モードへ）を抑止したい場合に使う。
   */
  stopLinkPropagation?: boolean;
}

/**
 * 共通 Markdown 表示コンポーネント。
 * remarkGfm 対応、コードブロックは prism でハイライト、リンクは別タブで開く。
 * 外側余白は padded prop で制御する（呼び出し側で持たせたい場合は false のまま）。
 */
export default function MarkdownViewer({
  content,
  padded = false,
  stopLinkPropagation = false,
}: MarkdownViewerProps) {
  const components = useMemo<Components>(
    () => ({
      code: renderCode,
      a({ href, children }) {
        return (
          <a
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            onClick={stopLinkPropagation ? (e) => e.stopPropagation() : undefined}
          >
            {children}
          </a>
        );
      },
    }),
    [stopLinkPropagation]
  );

  return (
    <div className={`${s.markdown} ${padded ? s.padded : ''}`}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {content}
      </ReactMarkdown>
    </div>
  );
}
