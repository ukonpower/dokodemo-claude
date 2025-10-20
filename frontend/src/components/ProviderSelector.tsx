import React from 'react';
import type { AiProvider } from '../types';

interface ProviderSelectorProps {
  currentProvider: AiProvider;
  onProviderChange: (provider: AiProvider) => void;
  disabled?: boolean;
}

const ProviderSelector: React.FC<ProviderSelectorProps> = ({
  currentProvider,
  onProviderChange,
  disabled = false,
}) => {
  const providers: { value: AiProvider; label: string; description: string }[] = [
    {
      value: 'claude',
      label: 'Claude Code',
      description: 'Anthropicの開発アシスタント',
    },
    {
      value: 'codex',
      label: 'Codex',
      description: 'AI Agent (codex)',
    },
  ];

  return (
    <div className="flex items-center space-x-2">
      <select
        value={currentProvider}
        onChange={(e) => onProviderChange(e.target.value as AiProvider)}
        disabled={disabled}
        className="px-2 py-1 sm:px-3 sm:py-1.5 bg-dark-bg-secondary border-2 border-dark-border-light rounded-lg text-xs sm:text-sm text-dark-text-primary focus:outline-none focus:ring-2 focus:ring-dark-accent-blue focus:border-dark-accent-blue hover:bg-dark-bg-hover hover:border-dark-border-focus disabled:bg-gray-600 disabled:cursor-not-allowed disabled:opacity-50 transition-all duration-150 shadow-md font-medium"
        title={disabled ? 'リポジトリを選択してからプロバイダーを変更してください' : ''}
      >
        {providers.map((provider) => (
          <option key={provider.value} value={provider.value} className="bg-dark-bg-secondary text-dark-text-primary">
            {provider.label}
          </option>
        ))}
      </select>
    </div>
  );
};

export default ProviderSelector;