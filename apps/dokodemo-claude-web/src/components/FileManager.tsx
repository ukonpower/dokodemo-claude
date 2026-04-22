import React, { useState, useRef, useCallback, useMemo, useEffect } from 'react';
import { RefreshCw, Plus, File as FileIcon } from 'lucide-react';
import * as tus from 'tus-js-client';
import type { UploadedFileInfo } from '../types';
import { BACKEND_URL } from '../utils/backend-url';
import { useCopyToClipboard } from '../hooks/useCopyToClipboard';
import ImageLightbox from './ImageLightbox';
import type { LightboxItem } from './ImageLightbox';
import s from './FileManager.module.scss';

interface FileManagerProps {
  rid: string;
  files: UploadedFileInfo[];
  onRefresh: () => void;
  onDelete: (filename: string) => void;
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

const FileManager: React.FC<FileManagerProps> = ({
  rid,
  files,
  onRefresh,
  onDelete,
}) => {
  const [isDragging, setIsDragging] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const [lightboxIndex, setLightboxIndex] = useState(0);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { copiedText, copyToClipboard } = useCopyToClipboard();
  const [activeItemId, setActiveItemId] = useState<string | null>(null);
  const isTouchDevice = useRef(false);
  const gridRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    isTouchDevice.current = window.matchMedia('(hover: none)').matches;
  }, []);

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
      imageUrl: `${BACKEND_URL}/api/media/${rid}/${f.filename}`,
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
            setIsUploading(false);
            setUploadProgress(null);
            resolve();
          },
          onError() {
            setUploadError('ファイルのアップロードに失敗しました');
            setIsUploading(false);
            setUploadProgress(null);
            resolve();
          },
        });
        upload.start();
      });
    },
    [rid, onRefresh]
  );

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

  const handleLightboxDelete = useCallback(
    (filename: string) => { onDelete(filename); },
    [onDelete]
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
    const idx = getLightboxIndex(file);
    if (idx < 0) return;
    if (isTouchDevice.current && activeItemId !== file.id) {
      setActiveItemId(file.id);
    } else {
      openLightbox(idx);
    }
  }, [activeItemId, openLightbox, getLightboxIndex]);

  const closeLightbox = useCallback(() => { setLightboxOpen(false); }, []);

  const getThumbnailUrl = useCallback(
    (filename: string) => `${BACKEND_URL}/api/media/${rid}/${filename}`,
    [rid]
  );

  return (
    <div className={s.container}>
      <div className={s.headerRow}>
        <span className={s.fileCount}>
          {files.length > 0 ? `${files.length} 件` : ''}
        </span>
        <button
          onClick={onRefresh}
          className={s.refreshButton}
          title="更新"
        >
          <RefreshCw size={10} className={s.refreshIcon} />
        </button>
      </div>

      {uploadError && (
        <div className={s.errorBox}>
          {uploadError}
        </div>
      )}

      <div ref={gridRef} className={s.grid}>
        {/* アップロードボックス */}
        <div
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          onClick={() => fileInputRef.current?.click()}
          className={`${s.uploadBox} ${
            isDragging ? s.uploadBoxDragging : s.uploadBoxDefault
          } ${isUploading ? s.uploadBoxDisabled : ''}`}
        >
          <input
            ref={fileInputRef}
            type="file"
            multiple
            onChange={handleFileSelect}
            className={s.hiddenInput}
          />
          {isUploading ? (
            <div className={s.progressContainer}>
              <div className={s.progressBar}>
                <div className={s.progressFill} style={{ width: `${uploadProgress ?? 0}%` }} />
              </div>
              <span className={s.progressText}>
                {uploadProgress ?? 0}%
              </span>
            </div>
          ) : (
            <Plus size={16} className={s.plusIcon} />
          )}
        </div>

        {/* ファイルサムネイル */}
        {files.map((file) => {
          const isActive = activeItemId === file.id;
          const isMedia = file.type === 'image' || file.type === 'video';
          return (
          <div
            key={file.id}
            className={s.thumbnailCard}
          >
            <button
              onClick={() => handleItemClick(file)}
              className={`${s.thumbnailButton} ${isMedia ? s.thumbnailButtonMedia : s.thumbnailButtonOther}`}
              aria-label={`${file.title || file.filename}`}
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
                  alt={file.title || file.filename}
                  className={s.mediaFill}
                  loading="lazy"
                  draggable={false}
                />
              ) : (
                <div className={s.otherFileContent}>
                  <FileIcon size={20} className={s.otherFileIcon} />
                  <span className={s.otherFileName}>
                    {file.filename.replace(/^\d+_[a-f0-9]+/, '').replace(/^_/, '') || file.filename}
                  </span>
                  <span className={s.otherFileSize}>
                    {formatFileSize(file.size)}
                  </span>
                </div>
              )}
            </button>

            {/* ホバーオーバーレイ */}
            <div
              onClick={() => { if (isMedia) handleItemClick(file); }}
              className={`${s.hoverOverlay} ${
                isMedia ? s.hoverOverlayMedia : ''
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
              >
                {copiedText === file.path ? (
                  <svg className={s.actionIcon} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                ) : (
                  <svg className={s.actionIcon} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                  </svg>
                )}
              </button>
              <button
                onClick={(e) => { e.stopPropagation(); handleDelete(file.filename); }}
                className={`${s.actionButton} ${s.deleteButton}`}
                title="削除"
              >
                <svg className={s.actionIcon} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                </svg>
              </button>
            </div>

            {/* タイトル表示 */}
            {file.title && (
              <div className={`${s.titleOverlay} ${
                isActive ? s.titleOverlayActive : s.titleOverlayInactive
              }`}>
                <div className={s.titleText}>{file.title}</div>
              </div>
            )}
          </div>
          );
        })}
      </div>

      <ImageLightbox
        items={lightboxItems}
        currentIndex={lightboxIndex}
        isOpen={lightboxOpen}
        onClose={closeLightbox}
        onIndexChange={setLightboxIndex}
        onCopyPath={copyToClipboard}
        onDelete={handleLightboxDelete}
        copiedPath={copiedText}
      />
    </div>
  );
};

export default FileManager;
