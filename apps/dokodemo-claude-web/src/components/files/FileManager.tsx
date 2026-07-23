import React, {
  useState,
  useRef,
  useCallback,
  useMemo,
  useEffect,
  forwardRef,
  useImperativeHandle,
} from 'react';
import {
  File as FileIcon,
  FileText,
  Copy as CopyIcon,
  Check,
  Trash2,
  Download,
  Inbox,
  Upload,
} from 'lucide-react';
import * as tus from 'tus-js-client';
import type { UploadedFileInfo } from '@/types';
import { BACKEND_URL } from '@/utils/backend-url';
import { useCopyToClipboard } from '@/hooks/useCopyToClipboard';
import ImageLightbox from '@/components/ui/ImageLightbox';
import type { LightboxItem } from '@/components/ui/ImageLightbox';
import MarkdownLightbox from './MarkdownLightbox';
import EmptyState from '@/components/ui/EmptyState';
import s from './FileManager.module.scss';

interface FileManagerProps {
  rid: string;
  files: UploadedFileInfo[];
  onRefresh: () => void;
  onDelete: (filename: string) => void;
  readOnly?: boolean;
  emptyMessage?: string;
  /** 画像に赤入れする（Lightbox から呼ばれる。未指定なら赤入れボタン非表示） */
  onAnnotate?: (imageUrl: string) => void;
}

export interface FileManagerHandle {
  pickFiles: () => void;
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

function getDisplayName(filename: string): string {
  return (
    filename.replace(/^\d+_[a-f0-9]+/, '').replace(/^_/, '') || filename
  );
}

const FileManager = forwardRef<FileManagerHandle, FileManagerProps>(function FileManager(
  { rid, files, onRefresh, onDelete, readOnly = false, emptyMessage, onAnnotate },
  ref
) {
  const [isDragging, setIsDragging] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const [lightboxIndex, setLightboxIndex] = useState(0);
  const [markdownFile, setMarkdownFile] = useState<UploadedFileInfo | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  // 進行中アップロードの中断ハンドラ（cancelUpload から呼ぶ）
  const activeUploadRef = useRef<(() => void) | null>(null);
  const { copiedText, copyToClipboard } = useCopyToClipboard();
  const [activeItemId, setActiveItemId] = useState<string | null>(null);
  const isTouchDevice = useRef(false);
  const gridRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    isTouchDevice.current = window.matchMedia('(hover: none)').matches;
  }, []);

  useImperativeHandle(
    ref,
    () => ({
      pickFiles: () => {
        if (!readOnly) fileInputRef.current?.click();
      },
    }),
    [readOnly]
  );

  useEffect(() => {
    if (activeItemId === null) return;
    const handleOutsideClick = (e: MouseEvent) => {
      if (gridRef.current && !gridRef.current.contains(e.target as Node)) {
        setActiveItemId(null);
      }
    };
    document.addEventListener('click', handleOutsideClick);
    return () => document.removeEventListener('click', handleOutsideClick);
  }, [activeItemId]);

  const mediaFiles = useMemo(
    () => files.filter((f) => f.type === 'image' || f.type === 'video'),
    [files]
  );

  const lightboxItems: LightboxItem[] = useMemo(() => {
    return mediaFiles.map((f) => ({
      id: f.id,
      filename: f.filename,
      imageUrl: `${BACKEND_URL}/api/media/${encodeURIComponent(rid)}/${encodeURIComponent(f.filename)}`,
      copyPath: f.path,
      type: f.type as 'image' | 'video',
      title: f.title,
      description: f.description,
    }));
  }, [mediaFiles, rid]);

  const uploadFile = useCallback(
    (file: File): Promise<void> => {
      return new Promise((resolve) => {
        setIsUploading(true);
        setUploadProgress(0);
        setUploadError(null);

        let settled = false;
        const finish = () => {
          if (settled) return;
          settled = true;
          activeUploadRef.current = null;
          setIsUploading(false);
          setUploadProgress(null);
          resolve();
        };

        const upload = new tus.Upload(file, {
          endpoint: `${BACKEND_URL}/api/tus`,
          chunkSize: 5 * 1024 * 1024,
          retryDelays: [0, 1000, 3000, 5000],
          metadata: {
            filename: file.name,
            filetype: file.type,
            rid,
          },
          onProgress(bytesUploaded, bytesTotal) {
            setUploadProgress(
              Math.round((bytesUploaded / bytesTotal) * 100)
            );
          },
          onSuccess() {
            onRefresh();
            finish();
          },
          onError() {
            setUploadError('ファイルのアップロードに失敗しました');
            finish();
          },
        });

        // キャンセル時は tus を中断（サーバ側の部分アップロードも破棄）して解決する。
        activeUploadRef.current = () => {
          upload.abort(true).catch(() => undefined);
          finish();
        };

        upload.start();
      });
    },
    [rid, onRefresh]
  );

  const cancelUpload = useCallback(() => {
    activeUploadRef.current?.();
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  }, []);

  const handleDrop = useCallback(
    async (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragging(false);
      const droppedFiles = Array.from(e.dataTransfer.files);
      for (const file of droppedFiles) await uploadFile(file);
    },
    [uploadFile]
  );

  const handleFileSelect = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const selectedFiles = e.target.files;
      if (!selectedFiles) return;
      for (const file of Array.from(selectedFiles)) await uploadFile(file);
      e.target.value = '';
    },
    [uploadFile]
  );

  const handleDelete = useCallback(
    (filename: string) => {
      if (window.confirm('このファイルを削除しますか？')) onDelete(filename);
    },
    [onDelete]
  );

  // fetch→blob だと巨大ファイルを全てメモリに載せるまで無反応になるため、
  // Content-Disposition: attachment を返すURLへの直リンクでブラウザのネイティブダウンロードに任せる
  const handleDownload = useCallback(
    (file: UploadedFileInfo) => {
      const url = `${BACKEND_URL}/api/media/${encodeURIComponent(rid)}/${encodeURIComponent(file.filename)}?download=1`;
      const link = document.createElement('a');
      link.href = url;
      link.download = file.filename;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    },
    [rid]
  );

  const handleLightboxDelete = useCallback(
    (filename: string) => { onDelete(filename); },
    [onDelete]
  );

  // 赤入れ開始時は Lightbox を閉じてお絵かきキャンバスに引き継ぐ
  const handleLightboxAnnotate = useCallback(
    (item: LightboxItem) => {
      setLightboxOpen(false);
      onAnnotate?.(item.imageUrl);
    },
    [onAnnotate]
  );

  const getLightboxIndex = useCallback(
    (file: UploadedFileInfo): number => {
      return mediaFiles.findIndex((f) => f.id === file.id);
    },
    [mediaFiles]
  );

  const openLightbox = useCallback((index: number) => {
    setLightboxIndex(index);
    setLightboxOpen(true);
  }, []);

  const handleItemClick = useCallback((file: UploadedFileInfo) => {
    if (file.type === 'other') return;
    if (file.type === 'markdown') {
      if (isTouchDevice.current && activeItemId !== file.id) {
        setActiveItemId(file.id);
      } else {
        setMarkdownFile(file);
      }
      return;
    }
    const idx = getLightboxIndex(file);
    if (idx < 0) return;
    if (isTouchDevice.current && activeItemId !== file.id) {
      setActiveItemId(file.id);
    } else {
      openLightbox(idx);
    }
  }, [activeItemId, openLightbox, getLightboxIndex]);

  const closeLightbox = useCallback(() => { setLightboxOpen(false); }, []);
  const closeMarkdownLightbox = useCallback(() => { setMarkdownFile(null); }, []);

  const getThumbnailUrl = useCallback(
    (filename: string) =>
      `${BACKEND_URL}/api/media/${encodeURIComponent(rid)}/${encodeURIComponent(filename)}`,
    [rid]
  );

  const enableDrop = !readOnly;

  return (
    <div
      className={`${s.container} ${
        enableDrop && isDragging ? s.containerDragging : ''
      }`}
      onDragOver={enableDrop ? handleDragOver : undefined}
      onDragLeave={enableDrop ? handleDragLeave : undefined}
      onDrop={enableDrop ? handleDrop : undefined}
    >
      <input
        ref={fileInputRef}
        type="file"
        multiple
        onChange={handleFileSelect}
        className={s.hiddenInput}
      />

      {isUploading && (
        <div className={s.uploadStatus}>
          <div className={s.uploadProgress}>
            <div
              className={s.uploadProgressFill}
              style={{ width: `${uploadProgress ?? 0}%` }}
            />
          </div>
          <div className={s.uploadStatusRow}>
            <span className={s.uploadStatusText}>
              アップロード中... {uploadProgress ?? 0}%
            </span>
            <button
              type="button"
              onClick={cancelUpload}
              className={s.uploadCancelButton}
              title="アップロードをキャンセル"
              aria-label="アップロードをキャンセル"
            >
              キャンセル
            </button>
          </div>
        </div>
      )}

      {uploadError && (
        <div className={s.errorBox}>
          {uploadError}
        </div>
      )}

      {readOnly && files.length === 0 && emptyMessage ? (
        <EmptyState
          icon={<Inbox size={20} strokeWidth={1.75} />}
          message={emptyMessage}
        />
      ) : !readOnly && files.length === 0 ? (
        <button
          type="button"
          onClick={() => {
            if (!isUploading) fileInputRef.current?.click();
          }}
          className={`${s.dropZone} ${isDragging ? s.dropZoneDragging : ''} ${
            isUploading ? s.dropZoneDisabled : ''
          }`}
        >
          <EmptyState
            icon={<Upload size={20} strokeWidth={1.75} />}
            message="ファイルをアップロード"
            hint="ドラッグ&ドロップ または クリックで選択"
          />
        </button>
      ) : (
      <div ref={gridRef} className={s.grid}>
        {/* ファイルサムネイル */}
        {files.map((file) => {
          const isActive = activeItemId === file.id;
          const isMedia = file.type === 'image' || file.type === 'video';
          const isMarkdown = file.type === 'markdown';
          const isClickable = isMedia || isMarkdown;
          const displayName = getDisplayName(file.filename);
          const tooltip = file.title
            ? `${file.title}\n${displayName}`
            : displayName;
          return (
          <div
            key={file.id}
            className={s.thumbnailCard}
            title={tooltip}
          >
            <button
              onClick={() => handleItemClick(file)}
              className={`${s.thumbnailButton} ${isClickable ? s.thumbnailButtonMedia : s.thumbnailButtonOther}`}
              aria-label={`${file.title || displayName}`}
            >
              {file.type === 'video' ? (
                <>
                  <video
                    src={getThumbnailUrl(file.filename)}
                    className={s.mediaFill}
                    muted
                    preload="metadata"
                  />
                  <div className={s.videoOverlay}>
                    <div className={s.playButton}>
                      <svg className={s.playIcon} fill="currentColor" viewBox="0 0 24 24">
                        <path d="M8 5v14l11-7z" />
                      </svg>
                    </div>
                  </div>
                </>
              ) : file.type === 'image' ? (
                <img
                  src={getThumbnailUrl(file.filename)}
                  alt={file.title || displayName}
                  className={s.mediaFill}
                  loading="lazy"
                  draggable={false}
                />
              ) : file.type === 'markdown' ? (
                <div className={s.otherFileContent}>
                  <FileText size={20} className={s.otherFileIcon} />
                  <span className={s.otherFileName}>
                    {file.title ||
                      file.filename.replace(/^\d+_[a-f0-9]+/, '').replace(/^_/, '') ||
                      file.filename}
                  </span>
                  <span className={s.otherFileSize}>MD</span>
                </div>
              ) : (
                <div className={s.otherFileContent}>
                  <FileIcon size={20} className={s.otherFileIcon} />
                  <span className={s.otherFileSize}>
                    {formatFileSize(file.size)}
                  </span>
                </div>
              )}
            </button>

            {/* ホバーオーバーレイ */}
            <div
              onClick={() => { if (isClickable) handleItemClick(file); }}
              className={`${s.hoverOverlay} ${
                isClickable ? s.hoverOverlayMedia : ''
              } ${
                isActive ? s.hoverOverlayActive : s.hoverOverlayInactive
              }`}
            />

            {/* アクションボタン */}
            <div className={`${s.actionButtons} ${
              isActive ? s.actionButtonsActive : s.actionButtonsInactive
            }`}>
              <button
                onClick={(e) => { e.stopPropagation(); copyToClipboard(file.path); }}
                className={`${s.actionButton} ${
                  copiedText === file.path ? s.copyButtonSuccess : s.copyButton
                }`}
                title="パスをコピー"
                aria-label="パスをコピー"
              >
                {copiedText === file.path ? (
                  <Check className={s.actionIcon} strokeWidth={2.5} />
                ) : (
                  <CopyIcon className={s.actionIcon} strokeWidth={2} />
                )}
              </button>
              <button
                onClick={(e) => { e.stopPropagation(); handleDownload(file); }}
                className={`${s.actionButton} ${s.downloadButton}`}
                title="ダウンロード"
                aria-label="ダウンロード"
              >
                <Download className={s.actionIcon} strokeWidth={2} />
              </button>
              <button
                onClick={(e) => { e.stopPropagation(); handleDelete(file.filename); }}
                className={`${s.actionButton} ${s.deleteButton}`}
                title="削除"
                aria-label="削除"
              >
                <Trash2 className={s.actionIcon} strokeWidth={2} />
              </button>
            </div>

            {/* ファイル名 (常時表示) */}
            <div className={s.nameLabel}>
              {file.title && (
                <div className={s.titleText}>{file.title}</div>
              )}
              <div className={s.filenameText}>{displayName}</div>
            </div>
          </div>
          );
        })}
      </div>
      )}

      <ImageLightbox
        items={lightboxItems}
        currentIndex={lightboxIndex}
        isOpen={lightboxOpen}
        onClose={closeLightbox}
        onIndexChange={setLightboxIndex}
        onCopyPath={copyToClipboard}
        onDelete={handleLightboxDelete}
        onAnnotate={onAnnotate ? handleLightboxAnnotate : undefined}
        copiedPath={copiedText}
      />

      <MarkdownLightbox
        rid={rid}
        file={markdownFile}
        isOpen={markdownFile !== null}
        onClose={closeMarkdownLightbox}
        onDelete={onDelete}
      />
    </div>
  );
});

export default FileManager;
