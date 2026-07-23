import React, { useEffect, useState } from 'react';
import { FileText } from 'lucide-react';
import type { UploadedFileInfo } from '@/types';
import { BACKEND_URL } from '@/utils/backend-url';
import MarkdownViewer from './MarkdownViewer';
import EmptyState from '@/components/ui/EmptyState';
import s from './MarkdownFullscreen.module.scss';

interface MarkdownFullscreenProps {
  rid: string;
  files: UploadedFileInfo[];
}

function getDisplayName(filename: string): string {
  return (
    filename.replace(/^\d+_[a-f0-9]+/, '').replace(/^_/, '') || filename
  );
}

const MarkdownFullscreen: React.FC<MarkdownFullscreenProps> = ({
  rid,
  files,
}) => {
  const [selectedId, setSelectedId] = useState<string | null>(
    files[0]?.id ?? null
  );
  const [content, setContent] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const selectedFile = files.find((f) => f.id === selectedId) ?? null;

  useEffect(() => {
    if (!files.some((f) => f.id === selectedId)) {
      setSelectedId(files[0]?.id ?? null);
    }
  }, [files, selectedId]);

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

  if (files.length === 0) {
    return (
      <div className={s.root}>
        <div className={s.preview}>
          <EmptyState
            icon={<FileText size={20} strokeWidth={1.75} />}
            message="Markdown はまだありません"
          />
        </div>
      </div>
    );
  }

  return (
    <div className={s.root}>
      <div className={s.sidebar}>
        {files.map((file) => {
          const displayName = getDisplayName(file.filename);
          const label = file.title || displayName;
          const isActive = file.id === selectedId;
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
        })}
      </div>
      <div className={s.preview}>
        {!selectedFile && (
          <div className={s.placeholder}>ファイルを選択してください</div>
        )}
        {selectedFile && error && (
          <div className={s.errorText}>読み込みに失敗しました: {error}</div>
        )}
        {selectedFile && !error && content === null && (
          <div className={s.loadingText}>読み込み中...</div>
        )}
        {selectedFile && !error && content !== null && (
          <MarkdownViewer content={content} />
        )}
      </div>
    </div>
  );
};

export default MarkdownFullscreen;
