import React, { useState } from 'react';
import { FileText } from 'lucide-react';
import type { UploadedFileInfo } from '@/types';
import MarkdownLightbox from './MarkdownLightbox';
import EmptyState from '@/shared/components/EmptyState';
import s from './MarkdownPanel.module.scss';

interface MarkdownPanelProps {
  rid: string;
  files: UploadedFileInfo[];
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
  onDelete,
}) => {
  const [openFileId, setOpenFileId] = useState<string | null>(null);
  const openFile = files.find((f) => f.id === openFileId) ?? null;

  return (
    <div className={s.root}>
      {files.length === 0 && (
        <div className={s.empty}>
          <EmptyState message="Markdown はまだありません" />
        </div>
      )}
      {files.length > 0 && (
        <div className={s.list}>
          {files.map((file) => {
            const displayName = getDisplayName(file.filename);
            const label = file.title || displayName;
            return (
              <button
                key={file.id}
                onClick={() => setOpenFileId(file.id)}
                className={s.listItem}
                title={file.title ? `${file.title}\n${displayName}` : displayName}
              >
                <FileText size={12} className={s.listIcon} />
                <span className={s.listLabel}>{label}</span>
              </button>
            );
          })}
        </div>
      )}

      <MarkdownLightbox
        rid={rid}
        file={openFile}
        isOpen={openFile !== null}
        onClose={() => setOpenFileId(null)}
        onDelete={onDelete}
      />
    </div>
  );
};

export default MarkdownPanel;
