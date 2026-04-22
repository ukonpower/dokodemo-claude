import type { ReactElement } from 'react';
import type { AiProvider, RepoDisplayAiStatus } from '../types';
import { getProviderShortName } from '../utils/ai-provider-info';
import s from './ProjectAiStatusBadge.module.scss';

interface ProjectAiStatusBadgeProps {
  displayProvider: AiProvider;
  displayAiStatus: RepoDisplayAiStatus;
  selectedProvider: AiProvider;
}

export default function ProjectAiStatusBadge({
  displayProvider,
  displayAiStatus,
  selectedProvider,
}: ProjectAiStatusBadgeProps): ReactElement {
  const displayProviderName = getProviderShortName(displayProvider);
  const selectedProviderName = getProviderShortName(selectedProvider);
  const title =
    displayProvider === selectedProvider
      ? `${displayProviderName}: ${displayAiStatus}`
      : `表示: ${displayProviderName} / 選択: ${selectedProviderName} / 状態: ${displayAiStatus}`;

  if (displayAiStatus === 'ready') return <></>;

  return (
    <span
      title={title}
      className={`${s.badge} ${displayAiStatus === 'running' ? s.running : s.done}`}
    >
      <span className={s.label}>{displayAiStatus}</span>
    </span>
  );
}
