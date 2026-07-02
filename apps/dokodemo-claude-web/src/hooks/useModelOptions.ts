import { useMemo } from 'react';
import { BUILTIN_MODEL_OPTIONS, type ModelOption } from '../utils/models';
import { useCustomModels } from './useCustomModels';
import { useAnthropicModels, type AnthropicModelsStatus } from './useAnthropicModels';

export interface UseModelOptionsReturn {
  /** 組み込み → API 取得 → カスタム の順でマージした選択肢 */
  options: ModelOption[];
  /** Anthropic モデル取得の状態（「未設定」表示などに使う） */
  anthropicStatus: AnthropicModelsStatus;
  addCustomModel: (id: string, displayName?: string) => void;
  removeCustomModel: (id: string) => void;
}

/**
 * モデル選択肢を統合して提供するフック。
 * 組み込みモデルを土台に、Anthropic API 取得モデル・カスタム追加モデルを重複なくマージする。
 */
export function useModelOptions(): UseModelOptionsReturn {
  const { customModels, addCustomModel, removeCustomModel } = useCustomModels();
  const { models: anthropicModels, status: anthropicStatus } =
    useAnthropicModels();

  const options = useMemo(() => {
    const list: ModelOption[] = [...BUILTIN_MODEL_OPTIONS];
    const seen = new Set(list.map((o) => o.value));

    for (const m of anthropicModels) {
      if (seen.has(m.id)) continue;
      seen.add(m.id);
      list.push({ value: m.id, label: m.display_name || m.id, source: 'anthropic' });
    }

    for (const m of customModels) {
      if (seen.has(m.id)) continue;
      seen.add(m.id);
      list.push({ value: m.id, label: m.displayName || m.id, source: 'custom' });
    }

    return list;
  }, [anthropicModels, customModels]);

  return { options, anthropicStatus, addCustomModel, removeCustomModel };
}
