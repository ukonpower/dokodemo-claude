import type { ReactElement } from 'react';
import { Check, Hand, Loader } from 'lucide-react';
import type { AiProvider, RepoDisplayAiStatus } from '@/types';
import { getProviderShortName } from '@/features/ai/utils/ai-provider-info';
import s from './ProjectAiStatusBadge.module.scss';

interface ProjectAiStatusBadgeProps {
  displayProvider: AiProvider;
  displayAiStatus: RepoDisplayAiStatus;
  selectedProvider: AiProvider;
}

const STATUS_LABELS: Record<RepoDisplayAiStatus, string> = {
  ready: '待機中',
  running: '実行中',
  waiting: '入力待ち',
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

  // 状態ごとの色とアイコン（入力待ちは人の操作が要るので警告色）
  let stateClass = s.done;
  let icon = <Check size={12} aria-hidden />;
  if (displayAiStatus === 'running') {
    stateClass = s.running;
    icon = <Loader size={12} className={s.spinIcon} aria-hidden />;
  }
  if (displayAiStatus === 'waiting') {
    stateClass = s.waiting;
    icon = <Hand size={12} aria-hidden />;
  }

  return (
    <span
      title={title}
      role="img"
      aria-label={title}
      className={`${s.badge} ${stateClass}`}
    >
      {icon}
    </span>
  );
}
