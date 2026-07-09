import { useMemo } from 'react';
import { BUILTIN_MODEL_OPTIONS, type ModelOption } from '../utils/models';
import { useCustomModels } from './useCustomModels';

export interface UseModelOptionsReturn {
  /** 組み込み + カスタム を重複なくマージした選択肢 */
  options: ModelOption[];
  addCustomModel: (id: string, displayName?: string) => void;
  removeCustomModel: (id: string) => void;
}

/**
 * モデル選択肢を統合して提供するフック。
 * 組み込みモデル（API key 不要）を土台に、ローカル追加のカスタムモデルを重複なくマージする。
 */
export function useModelOptions(): UseModelOptionsReturn {
  const { customModels, addCustomModel, removeCustomModel } = useCustomModels();

  const options = useMemo(() => {
    const list: ModelOption[] = [...BUILTIN_MODEL_OPTIONS];
    const seen = new Set(list.map((o) => o.value));

    for (const m of customModels) {
      if (seen.has(m.id)) continue;
      seen.add(m.id);
      list.push({ value: m.id, label: m.displayName || m.id, source: 'custom' });
    }

    return list;
  }, [customModels]);

  return { options, addCustomModel, removeCustomModel };
}
