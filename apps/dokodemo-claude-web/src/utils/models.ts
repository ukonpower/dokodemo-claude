// モデル選択肢の共通定義。
// CommandInput / SortableQueueItem / KeyboardButtons から共通利用する（DRY化）。
//
// value は Claude CLI の /model にそのまま渡す実値。空文字は「未指定」を表す。
// API key が必要なモデルは含めず、Claude Code CLI（ログイン済み前提）で使えるものだけを載せる。
// [1m] は Claude Code の fast mode 表記で、id は素の Opus ID を使い label にのみ付ける。

export type ModelSource = 'builtin' | 'custom';

export interface ModelOption {
  /** CLI に渡す実値。空文字は「未指定」 */
  value: string;
  /** UI 表示名 */
  label: string;
  /** 由来。custom のみ削除可能 */
  source: ModelSource;
}

// 組み込みモデル（表示順）。API key 不要のもののみ。
export const BUILTIN_MODEL_OPTIONS: ModelOption[] = [
  { value: '', label: '未指定', source: 'builtin' },
  { value: 'claude-opus-4-8', label: 'Opus 4.8 [1m]', source: 'builtin' },
  { value: 'claude-opus-4-7', label: 'Opus 4.7 [1m]', source: 'builtin' },
  { value: 'claude-sonnet-5', label: 'Sonnet 5', source: 'builtin' },
  { value: 'claude-sonnet-4-5', label: 'Sonnet 4', source: 'builtin' },
  { value: 'claude-fable-5', label: 'Fable 5', source: 'builtin' },
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
