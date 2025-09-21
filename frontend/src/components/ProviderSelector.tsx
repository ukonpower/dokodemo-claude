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
      <label className="text-sm font-medium text-gray-700">
        AI プロバイダー:
      </label>
      <select
        value={currentProvider}
        onChange={(e) => onProviderChange(e.target.value as AiProvider)}
        disabled={disabled}
        className="px-3 py-1 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent disabled:bg-gray-100 disabled:cursor-not-allowed"
        title={disabled ? 'リポジトリを選択してからプロバイダーを変更してください' : ''}
      >
        {providers.map((provider) => (
          <option key={provider.value} value={provider.value}>
            {provider.label}
          </option>
        ))}
      </select>
      <div className="text-xs text-gray-500">
        {providers.find((p) => p.value === currentProvider)?.description}
      </div>
    </div>
  );
};

export default ProviderSelector;