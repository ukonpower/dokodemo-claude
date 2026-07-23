import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  X,
  Copy as CopyIcon,
  Check,
  Trash2,
  Download,
  Code2,
  Eye,
} from 'lucide-react';
import type { UploadedFileInfo } from '../../types';
import { BACKEND_URL } from '../../utils/backend-url';
import MarkdownViewer from './MarkdownViewer';
import { useOverlayClose } from '../../hooks/useOverlayClose';
import s from './MarkdownLightbox.module.scss';

interface MarkdownLightboxProps {
  rid: string;
  file: UploadedFileInfo | null;
  isOpen: boolean;
  onClose: () => void;
  onDelete?: (filename: string) => void;
}

const MarkdownLightbox: React.FC<MarkdownLightboxProps> = ({
  rid,
  file,
  isOpen,
  onClose,
  onDelete,
}) => {
  const [content, setContent] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [viewMode, setViewMode] = useState<'rendered' | 'raw'>('rendered');
  const backdropRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isOpen || !file) {
      setContent(null);
      setError(null);
      return;
    }
    let cancelled = false;
    setContent(null);
    setError(null);
    const url = `${BACKEND_URL}/api/media/${encodeURIComponent(rid)}/${encodeURIComponent(file.filename)}`;
    fetch(url)
      .then(async (res) => {
        if (!res.ok) throw new Error(`status ${res.status}`);
        return res.text();
      })
      .then((text) => {
        if (!cancelled) setContent(text);
      })
      .catch((e) => {
        if (!cancelled) setError(String(e));
      });
    return () => {
      cancelled = true;
    };
  }, [isOpen, file, rid]);

  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => {
      document.body.style.overflow = '';
    };
  }, [isOpen]);

  // backdrop 自身、または body の空白域（.contentCard の外）を「背景」として扱う
  const overlayProps = useOverlayClose(
    onClose,
    (e) => e.target === backdropRef.current || e.target === bodyRef.current
  );

  const handleCopy = useCallback(async () => {
    if (content === null) return;
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(content);
      } else {
        const ta = document.createElement('textarea');
        ta.value = content;
        ta.style.position = 'fixed';
        ta.style.left = '-9999px';
        document.body.appendChild(ta);
        ta.focus();
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
      }
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // ignore
    }
  }, [content]);

  const handleDownload = useCallback(() => {
    if (!file || content === null) return;
    const displayName =
      file.filename.replace(/^\d+_[a-f0-9]+/, '').replace(/^_/, '') ||
      file.filename;
    const blob = new Blob([content], { type: 'text/markdown' });
    const objectUrl = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = objectUrl;
    link.download = displayName.endsWith('.md') ? displayName : `${displayName}.md`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(objectUrl);
  }, [file, content]);

  const handleDelete = useCallback(() => {
    if (!file || !onDelete) return;
    if (window.confirm('このMarkdownを削除しますか？')) {
      onDelete(file.filename);
      onClose();
    }
  }, [file, onDelete, onClose]);

  if (!isOpen || !file) return null;

  const headerTitle =
    file.title ||
    file.filename.replace(/^\d+_[a-f0-9]+/, '').replace(/^_/, '') ||
    file.filename;

  return (
    <div ref={backdropRef} {...overlayProps} className={s.backdrop}>
      <div className={s.header}>
        <div className={s.headerLeft}>
          <span className={s.headerTitle}>{headerTitle}</span>
          {file.description && (
            <span className={s.headerSubtitle}>{file.description}</span>
          )}
        </div>
        <button
          onClick={onClose}
          className={s.closeButton}
          aria-label="閉じる"
          title="閉じる (Esc)"
        >
          <X size={20} strokeWidth={2.25} />
        </button>
      </div>

      <div ref={bodyRef} className={s.body}>
        <div className={s.contentCard}>
          {error && (
            <div className={s.errorText}>読み込みに失敗しました: {error}</div>
          )}
          {!error && content === null && (
            <div className={s.loadingText}>読み込み中...</div>
          )}
          {!error && content !== null && viewMode === 'rendered' && (
            <MarkdownViewer content={content} />
          )}
          {!error && content !== null && viewMode === 'raw' && (
            <pre className={s.rawContent}>{content}</pre>
          )}
        </div>
      </div>

      <div className={s.actionBar}>
        <button
          onClick={() =>
            setViewMode((m) => (m === 'rendered' ? 'raw' : 'rendered'))
          }
          disabled={content === null}
          className={s.iconButton}
          aria-label={
            viewMode === 'rendered' ? 'ソース表示に切替' : 'レンダリング表示に切替'
          }
          title={
            viewMode === 'rendered' ? 'ソース表示に切替' : 'レンダリング表示に切替'
          }
        >
          {viewMode === 'rendered' ? (
            <Code2 size={14} strokeWidth={2} />
          ) : (
            <Eye size={14} strokeWidth={2} />
          )}
        </button>
        <button
          onClick={handleCopy}
          disabled={content === null}
          className={`${s.copyButton} ${
            copied ? s.copyButtonCopied : s.copyButtonDefault
          }`}
        >
          {copied ? (
            <>
              <Check size={14} strokeWidth={2.5} />
              <span>Copied</span>
            </>
          ) : (
            <>
              <CopyIcon size={14} strokeWidth={2} />
              <span>本文をコピー</span>
            </>
          )}
        </button>
        <button
          onClick={handleDownload}
          disabled={content === null}
          className={s.iconButton}
          aria-label="ダウンロード"
          title="ダウンロード"
        >
          <Download size={14} strokeWidth={2} />
        </button>
        {onDelete && (
          <button
            onClick={handleDelete}
            className={`${s.iconButton} ${s.deleteButton}`}
            aria-label="削除"
            title="削除"
          >
            <Trash2 size={14} strokeWidth={2} />
          </button>
        )}
      </div>
    </div>
  );
};

export default MarkdownLightbox;
