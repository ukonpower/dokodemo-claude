import type { AiProvider } from '../types';

/**
 * AIプロバイダーの表示情報
 */
export interface ProviderDisplayInfo {
  name: string; // フルネーム（例: "Claude CLI"）
  shortName: string; // 短縮名（例: "Claude"）
  initialMessage1: string; // 初期メッセージ1行目
  initialMessage2: string; // 初期メッセージ2行目
  loadingMessage: string; // 読み込み中メッセージ
  headerLabel: string; // ヘッダーラベル
}

/**
 * プロバイダー情報の定義
 */
const PROVIDER_INFO_MAP: Record<AiProvider, ProviderDisplayInfo> = {
  claude: {
    name: 'Claude CLI',
    shortName: 'Claude',
    initialMessage1: 'Claude CLIの出力がここに表示されます',
    initialMessage2: 'リポジトリを選択してClaude CLIを開始してください',
    loadingMessage: 'Claude CLI履歴を読み込み中...',
    headerLabel: 'Claude CLI Output',
  },
  codex: {
    name: 'Codex CLI',
    shortName: 'Codex',
    initialMessage1: 'Codex CLIの出力がここに表示されます',
    initialMessage2: 'リポジトリを選択してCodex CLIを開始してください',
    loadingMessage: 'Codex CLI履歴を読み込み中...',
    headerLabel: 'Codex CLI Output',
  },
};

/**
 * デフォルトのプロバイダー情報
 */
const DEFAULT_PROVIDER_INFO: ProviderDisplayInfo = {
  name: 'AI CLI',
  shortName: 'AI',
  initialMessage1: 'AI CLIの出力がここに表示されます',
  initialMessage2: 'リポジトリを選択してAI CLIを開始してください',
  loadingMessage: 'AI CLI履歴を読み込み中...',
  headerLabel: 'AI CLI Output',
};

/**
 * プロバイダーの表示情報を取得
 */
export function getProviderInfo(provider: AiProvider): ProviderDisplayInfo {
  return PROVIDER_INFO_MAP[provider] || DEFAULT_PROVIDER_INFO;
}

/**
 * プロバイダー名を取得
 */
export function getProviderName(provider: AiProvider): string {
  return getProviderInfo(provider).name;
}

/**
 * プロバイダー短縮名を取得
 */
export function getProviderShortName(provider: AiProvider): string {
  return getProviderInfo(provider).shortName;
}
