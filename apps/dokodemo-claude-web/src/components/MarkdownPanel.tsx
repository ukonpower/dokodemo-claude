import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Copy as CopyIcon,
  Check,
  Trash2,
  Download,
  Maximize2,
  FileText,
  ChevronLeft,
} from 'lucide-react';
import type { UploadedFileInfo } from '../types';
import { BACKEND_URL } from '../utils/backend-url';
import MarkdownViewer from './MarkdownViewer';
import MarkdownLightbox from './MarkdownLightbox';
import EmptyState from './EmptyState';
import s from './MarkdownPanel.module.scss';

interface MarkdownPanelProps {
  rid: string;
  files: UploadedFileInfo[];
  onDelete: (filename: string) => void;
  isMobile: boolean;
  mobileView: 'list' | 'preview';
  onMobileViewChange: (view: 'list' | 'preview') => void;
}

function getDisplayName(filename: string): string {
  return (
    filename.replace(/^\d+_[a-f0-9]+/, '').replace(/^_/, '') || filename
  );
}

const MarkdownPanel: React.FC<MarkdownPanelProps> = ({
  rid,
  files,
  onDelete,
  isMobile,
  mobileView,
  onMobileViewChange,
}) => {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [content, setContent] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [lightboxOpen, setLightboxOpen] = useState(false);

  const selectedFile = useMemo(
    () => files.find((f) => f.id === selectedId) ?? null,
    [files, selectedId]
  );

  // ファイル一覧が変わったときに、選択が消えていれば先頭を選ぶ
  useEffect(() => {
    if (files.length === 0) {
      setSelectedId(null);
      onMobileViewChange('list');
      return;
    }
    if (!files.some((f) => f.id === selectedId)) {
      setSelectedId(files[0].id);
    }
  }, [files, selectedId, onMobileViewChange]);

  // 選択ファイルの内容を取得
  useEffect(() => {
    if (!selectedFile) {
      setContent(null);
      setError(null);
      return;
    }
    let cancelled = false;
    setContent(null);
    setError(null);
    const url = `${BACKEND_URL}/api/media/${encodeURIComponent(rid)}/${encodeURIComponent(selectedFile.filename)}`;
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
  }, [selectedFile, rid]);

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
    if (!selectedFile || content === null) return;
    const displayName = getDisplayName(selectedFile.filename);
    const blob = new Blob([content], { type: 'text/markdown' });
    const objectUrl = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = objectUrl;
    link.download = displayName.endsWith('.md')
      ? displayName
      : `${displayName}.md`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(objectUrl);
  }, [selectedFile, content]);

  const handleDelete = useCallback(() => {
    if (!selectedFile) return;
    if (window.confirm('このMarkdownを削除しますか？')) {
      onDelete(selectedFile.filename);
    }
  }, [selectedFile, onDelete]);

  const handleSelect = useCallback(
    (id: string) => {
      setSelectedId(id);
      onMobileViewChange('preview');
    },
    [onMobileViewChange]
  );

  const showList = !isMobile || mobileView === 'list';
  const showPreview = !isMobile || mobileView === 'preview';

  return (
    <div className={`${s.root} ${isMobile ? s.rootMobile : ''}`}>
      {/* 左ペイン: ファイル一覧 */}
      {showList && (
      <div className={`${s.leftPane} ${isMobile ? s.paneMobile : ''}`}>
        <div className={s.list}>
          {files.length === 0 ? (
            <EmptyState
              icon={<FileText size={20} strokeWidth={1.75} />}
              message="Markdown はまだありません"
            />
          ) : (
            files.map((file) => {
              const displayName = getDisplayName(file.filename);
              const label = file.title || displayName;
              const isActive = selectedId === file.id;
              return (
                <button
                  key={file.id}
                  onClick={() => handleSelect(file.id)}
                  className={`${s.listItem} ${isActive ? s.listItemActive : ''}`}
                  title={file.title ? `${file.title}\n${displayName}` : displayName}
                >
                  <FileText size={12} className={s.listIcon} />
                  <span className={s.listLabel}>{label}</span>
                </button>
              );
            })
          )}
        </div>
      </div>
      )}

      {/* 右ペイン: プレビュー */}
      {showPreview && (
      <div className={`${s.rightPane} ${isMobile ? s.paneMobile : ''}`}>
        {selectedFile ? (
          <>
            <div className={s.previewHeader}>
              {isMobile && (
                <button
                  onClick={() => onMobileViewChange('list')}
                  className={s.backButton}
                  title="一覧へ戻る"
                  aria-label="一覧へ戻る"
                >
                  <ChevronLeft size={14} strokeWidth={2.25} />
                </button>
              )}
              <div className={s.previewTitleWrap}>
                <span className={s.previewTitle}>
                  {selectedFile.title || getDisplayName(selectedFile.filename)}
                </span>
                {selectedFile.description && (
                  <span className={s.previewSubtitle}>
                    {selectedFile.description}
                  </span>
                )}
              </div>
              <div className={s.previewActions}>
                <button
                  onClick={handleCopy}
                  disabled={content === null}
                  className={`${s.actionButton} ${
                    copied ? s.actionButtonSuccess : ''
                  }`}
                  title="本文をコピー"
                  aria-label="本文をコピー"
                >
                  {copied ? (
                    <Check size={12} strokeWidth={2.5} />
                  ) : (
                    <CopyIcon size={12} strokeWidth={2} />
                  )}
                </button>
                <button
                  onClick={handleDownload}
                  disabled={content === null}
                  className={s.actionButton}
                  title="ダウンロード"
                  aria-label="ダウンロード"
                >
                  <Download size={12} strokeWidth={2} />
                </button>
                <button
                  onClick={() => setLightboxOpen(true)}
                  disabled={content === null}
                  className={s.actionButton}
                  title="全画面で表示"
                  aria-label="全画面で表示"
                >
                  <Maximize2 size={12} strokeWidth={2} />
                </button>
                <button
                  onClick={handleDelete}
                  className={`${s.actionButton} ${s.deleteButton}`}
                  title="削除"
                  aria-label="削除"
                >
                  <Trash2 size={12} strokeWidth={2} />
                </button>
              </div>
            </div>
            <div className={s.previewBody}>
              {error && (
                <div className={s.errorText}>
                  読み込みに失敗しました: {error}
                </div>
              )}
              {!error && content === null && (
                <div className={s.loadingText}>読み込み中...</div>
              )}
              {!error && content !== null && (
                <MarkdownViewer content={content} padded />
              )}
            </div>
          </>
        ) : (
          <EmptyState
            icon={<FileText size={20} strokeWidth={1.75} />}
            message={
              isMobile
                ? '一覧から Markdown を選択'
                : '左側から Markdown を選択'
            }
          />
        )}
      </div>
      )}

      <MarkdownLightbox
        rid={rid}
        file={lightboxOpen ? selectedFile : null}
        isOpen={lightboxOpen}
        onClose={() => setLightboxOpen(false)}
        onDelete={onDelete}
      />
    </div>
  );
};

export default MarkdownPanel;
