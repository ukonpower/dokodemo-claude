// モデル選択肢の共通定義。
// CommandInput / SortableQueueItem / KeyboardButtons から共通利用する（DRY化）。
//
// value は Claude CLI の /model にそのまま渡す実値。空文字は「未指定」を表す。
// 組み込みモデルは API 取得やカスタム追加が無い場合のフォールバックとして常に先頭に並ぶ。

export type ModelSource = 'builtin' | 'anthropic' | 'custom';

export interface ModelOption {
  /** CLI に渡す実値。空文字は「未指定」 */
  value: string;
  /** UI 表示名 */
  label: string;
  /** 由来。custom のみ削除可能 */
  source: ModelSource;
}

// 組み込みモデル（表示順）。値は現行の Claude CLI 挙動を維持する。
export const BUILTIN_MODEL_OPTIONS: ModelOption[] = [
  { value: '', label: '未指定', source: 'builtin' },
  { value: 'default', label: 'Default', source: 'builtin' },
  { value: 'Opus', label: 'Opus', source: 'builtin' },
  { value: 'Sonnet', label: 'Sonnet', source: 'builtin' },
  { value: 'OpusPlan', label: 'OpusPlan', source: 'builtin' },
];

/**
 * value に対応する表示名を解決する。
 * 一覧に無い値はそのまま表示し、空文字は「未指定」を返す。
 */
export function resolveModelLabel(
  value: string | undefined,
  options: ModelOption[]
): string {
  if (!value) return '未指定';
  const found = options.find((o) => o.value === value);
  return found ? found.label : value;
}
