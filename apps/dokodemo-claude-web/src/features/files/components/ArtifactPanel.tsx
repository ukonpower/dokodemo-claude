import React from 'react';
import { AppWindow } from 'lucide-react';
import type { ArtifactInfo } from '@/types';
import EmptyState from '@/shared/components/EmptyState';
import s from './ArtifactPanel.module.scss';

interface ArtifactPanelProps {
  artifacts: ArtifactInfo[];
}

const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

/** 更新日時を「3分前」「2日前」のような相対表記にする */
function formatRelativeTime(timestamp: number, now: number): string {
  const diff = now - timestamp;
  if (diff < MINUTE_MS) {
    return 'たった今';
  }
  if (diff < HOUR_MS) {
    return `${Math.floor(diff / MINUTE_MS)}分前`;
  }
  if (diff < DAY_MS) {
    return `${Math.floor(diff / HOUR_MS)}時間前`;
  }
  if (diff < 30 * DAY_MS) {
    return `${Math.floor(diff / DAY_MS)}日前`;
  }
  // 1 か月以上前は相対表記だと粗すぎるので日付で出す
  return new Date(timestamp).toLocaleDateString();
}

/** リポジトリ / ワークツリーで作られた claude.ai Artifact の一覧。クリックで新しいタブに開く */
const ArtifactPanel: React.FC<ArtifactPanelProps> = ({ artifacts }) => {
  if (artifacts.length === 0) {
    return (
      <div className={s.empty}>
        <EmptyState message="Claude が作成した Artifact がここに表示されます" />
      </div>
    );
  }

  const now = Date.now();
  return (
    <div className={s.list}>
      {artifacts.map((artifact) => (
        <a
          key={artifact.url}
          href={artifact.url}
          target="_blank"
          rel="noopener noreferrer"
          className={s.listItem}
          title={`${artifact.title}\n${artifact.url}`}
        >
          <AppWindow size={12} className={s.listIcon} />
          <span className={s.listLabel}>{artifact.title}</span>
          <span className={s.listTime}>
            {formatRelativeTime(artifact.updatedAt, now)}
          </span>
        </a>
      ))}
    </div>
  );
};

export default ArtifactPanel;
