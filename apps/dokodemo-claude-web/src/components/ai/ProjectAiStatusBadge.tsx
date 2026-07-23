import type { ReactElement } from 'react';
import { Check, Loader } from 'lucide-react';
import type { AiProvider, RepoDisplayAiStatus } from '../../types';
import { getProviderShortName } from '../../utils/ai-provider-info';
import s from './ProjectAiStatusBadge.module.scss';

interface ProjectAiStatusBadgeProps {
  displayProvider: AiProvider;
  displayAiStatus: RepoDisplayAiStatus;
  selectedProvider: AiProvider;
}

const STATUS_LABELS: Record<RepoDisplayAiStatus, string> = {
  ready: '待機中',
  running: '実行中',
  done: '完了',
};

export default function ProjectAiStatusBadge({
  displayProvider,
  displayAiStatus,
  selectedProvider,
}: ProjectAiStatusBadgeProps): ReactElement {
  const displayProviderName = getProviderShortName(displayProvider);
  const selectedProviderName = getProviderShortName(selectedProvider);
  const statusLabel = STATUS_LABELS[displayAiStatus];
  const title =
    displayProvider === selectedProvider
      ? `${displayProviderName}: ${statusLabel}`
      : `表示: ${displayProviderName} / 選択: ${selectedProviderName} / 状態: ${statusLabel}`;

  if (displayAiStatus === 'ready') return <></>;

  return (
    <span
      title={title}
      role="img"
      aria-label={title}
      className={`${s.badge} ${displayAiStatus === 'running' ? s.running : s.done}`}
    >
      {displayAiStatus === 'running' ? (
        <Loader size={12} className={s.spinIcon} aria-hidden />
      ) : (
        <Check size={12} aria-hidden />
      )}
    </span>
  );
}
