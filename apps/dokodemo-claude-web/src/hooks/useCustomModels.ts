import { useCallback, useSyncExternalStore } from 'react';

// カスタムモデルはリポジトリ/ワークツリーに紐付かないグローバルな localStorage キーで保存する。
// command-send-settings-* / dashboard-send-settings-* には含めない（そちらは選択中モデルの状態のみ）。
const STORAGE_KEY = 'dokodemo:custom-models:v1';

export interface CustomModel {
  /** CLI に渡す実値（モデルID） */
  id: string;
  /** 任意の表示名。未指定なら id をそのまま表示 */
  displayName?: string;
}

// 同一タブ内の全 useCustomModels インスタンスを同期させるための購読者集合。
const listeners = new Set<() => void>();
// getSnapshot が安定参照を返せるようにキャッシュする（変更時のみ差し替える）。
let cache: CustomModel[] | null = null;

function read(): CustomModel[] {
  if (cache) return cache;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    cache = Array.isArray(parsed)
      ? parsed.filter(
          (m): m is CustomModel =>
            !!m && typeof m === 'object' && typeof m.id === 'string'
        )
      : [];
  } catch {
    cache = [];
  }
  return cache;
}

function write(next: CustomModel[]): void {
  cache = next;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    /* noop */
  }
  listeners.forEach((l) => l());
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  const onStorage = (e: StorageEvent) => {
    if (e.key === STORAGE_KEY) {
      cache = null; // 他タブでの変更を次回 read で反映
      listener();
    }
  };
  window.addEventListener('storage', onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener('storage', onStorage);
  };
}

/**
 * グローバル localStorage に保存したカスタムモデルを参照・更新するフック。
 * 各コンポーネントから使い、追加/削除は全インスタンスへ即時反映される。
 */
export function useCustomModels() {
  const customModels = useSyncExternalStore(subscribe, read);

  const addCustomModel = useCallback((id: string, displayName?: string) => {
    const trimmedId = id.trim();
    if (!trimmedId) return;
    const current = read();
    if (current.some((m) => m.id === trimmedId)) return; // 重複防止
    const name = displayName?.trim();
    write([...current, { id: trimmedId, ...(name ? { displayName: name } : {}) }]);
  }, []);

  const removeCustomModel = useCallback((id: string) => {
    write(read().filter((m) => m.id !== id));
  }, []);

  return { customModels, addCustomModel, removeCustomModel };
}
