import type { ReactElement } from 'react';
import type { AiProvider } from '../types';
import { getProviderShortName } from '../utils/ai-provider-info';
import s from './ProviderSwitcher.module.scss';

interface ProviderSwitcherProps {
  currentProvider: AiProvider;
  onProviderChange: (provider: AiProvider) => void;
  disabled?: boolean;
}

/**
 * 利用可能なプロバイダー一覧
 */
const AVAILABLE_PROVIDERS: AiProvider[] = ['claude', 'codex'];

/**
 * AIプロバイダー切り替えコンポーネント
 * Claude/Codex間の切り替えUIを提供
 */
export default function ProviderSwitcher({
  currentProvider,
  onProviderChange,
  disabled = false,
}: ProviderSwitcherProps): ReactElement {
  /**
   * プロバイダー切り替えボタンクリック時のハンドラ
   */
  const handleProviderClick = (provider: AiProvider): void => {
    if (provider === currentProvider || disabled) {
      return;
    }
    onProviderChange(provider);
  };

  return (
    <div className={s.root}>
      {AVAILABLE_PROVIDERS.map((provider) => {
        const isActive = provider === currentProvider;
        const shortName = getProviderShortName(provider);

        return (
          <button
            key={provider}
            onClick={() => handleProviderClick(provider)}
            disabled={disabled}
            className={`${s.button} ${
              isActive ? s.buttonActive : s.buttonInactive
            } ${disabled ? s.buttonDisabled : s.buttonEnabled}`}
            title={`${shortName} CLIに切り替え`}
          >
            {shortName}
          </button>
        );
      })}
    </div>
  );
}
