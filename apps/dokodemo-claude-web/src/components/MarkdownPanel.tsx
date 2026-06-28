import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  RefreshCw,
  Copy as CopyIcon,
  Check,
  Trash2,
  Download,
  Maximize2,
  FileText,
} from 'lucide-react';
import type { UploadedFileInfo } from '../types';
import { BACKEND_URL } from '../utils/backend-url';
import MarkdownViewer from './MarkdownViewer';
import MarkdownLightbox from './MarkdownLightbox';
import s from './MarkdownPanel.module.scss';

interface MarkdownPanelProps {
  rid: string;
  files: UploadedFileInfo[];
  onRefresh: () => void;
  onDelete: (filename: string) => void;
}

function getDisplayName(filename: string): string {
  return (
    filename.replace(/^\d+_[a-f0-9]+/, '').replace(/^_/, '') || filename
  );
}

const MarkdownPanel: React.FC<MarkdownPanelProps> = ({
  rid,
  files,
  onRefresh,
  onDelete,
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
      return;
    }
    if (!files.some((f) => f.id === selectedId)) {
      setSelectedId(files[0].id);
    }
  }, [files, selectedId]);

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
    const url = `${BACKEND_URL}/api/media/${rid}/${encodeURIComponent(selectedFile.filename)}`;
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

  return (
    <div className={s.root}>
      {/* 左ペイン: ファイル一覧 */}
      <div className={s.leftPane}>
        <div className={s.leftHeader}>
          <span className={s.fileCount}>
            {files.length > 0 ? `${files.length} 件` : ''}
          </span>
          <button
            onClick={onRefresh}
            className={s.refreshButton}
            title="更新"
            aria-label="更新"
          >
            <RefreshCw size={10} />
          </button>
        </div>
        <div className={s.list}>
          {files.length === 0 ? (
            <div className={s.emptyHint}>
              Claude が送信した Markdown がここに表示されます
            </div>
          ) : (
            files.map((file) => {
              const displayName = getDisplayName(file.filename);
              const label = file.title || displayName;
              const isActive = selectedId === file.id;
              return (
                <button
                  key={file.id}
                  onClick={() => setSelectedId(file.id)}
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

      {/* 右ペイン: プレビュー */}
      <div className={s.rightPane}>
        {selectedFile ? (
          <>
            <div className={s.previewHeader}>
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
          <div className={s.emptyPreview}>左側から Markdown を選択してください</div>
        )}
      </div>

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
