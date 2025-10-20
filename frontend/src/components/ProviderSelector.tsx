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
        className="px-2 py-1 sm:px-3 sm:py-1.5 bg-gray-700 border border-gray-600 rounded-md text-xs sm:text-sm text-gray-200 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 disabled:bg-gray-600 disabled:cursor-not-allowed disabled:opacity-50 transition-colors"
        title={disabled ? 'リポジトリを選択してからプロバイダーを変更してください' : ''}
      >
        {providers.map((provider) => (
          <option key={provider.value} value={provider.value}>
            {provider.label}
          </option>
        ))}
      </select>
    </div>
  );
};

export default ProviderSelector;