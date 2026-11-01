// AI プロバイダーの型定義
export type AiProvider = 'claude' | 'codex';
export type AiExecutionStatus = 'idle' | 'running' | 'completed';
export type RepoDisplayAiStatus = 'ready' | 'running' | 'done';

// コマンドタイプの型定義
export type CommandType = 'prompt' | 'clear' | 'commit' | 'raw';

// AI CLI関連の型定義
export interface AiMessage {
  id: string;
  type: 'user' | 'ai' | 'system';
  content: string;
  timestamp: number;
  provider: AiProvider;
}

// AI インスタンスの型定義
// 1 リポジトリに対し複数のタブとして並列起動できる
// プライマリ: リポジトリオープン時に自動生成され、閉じられない（provider 切替は可能）
// サブ     : ユーザが + ボタンで作成、閉じられる、provider 固定
export interface AiInstance {
  instanceId: string;
  repositoryPath: string;
  provider: AiProvider;
  isPrimary: boolean;
  displayName?: string;
  order: number;
  createdAt: number;
  sessionId?: string;
  // Claude 会話の復元用セッションID（有効な UUID）。
  // claude を初回 spawn する際に --session-id で固定発行し、以降の再起動・
  // provider 復帰時は --resume でこの ID を継続する。provider が claude の
  // ときだけ使用する（codex では未使用）。
  claudeSessionId?: string;
  // Codex 会話の復元用セッションID。codex は spawn 側から ID を指定できず、
  // CLI が起動後に ~/.codex/sessions/YYYY/MM/DD/rollout-*-<uuid>.jsonl を
  // 書き出すので、spawn 後にファイルを検知して ID とパスを控える。
  // 再起動時にファイルがまだ存在すれば `codex resume <id>` で継続、
  // 取れなければフレッシュ起動する。
  codexSessionId?: string;
  codexSessionFile?: string;
}

// AI CLI出力履歴の行情報
export interface AiOutputLine {
  id: string;
  content: string;
  timestamp: number;
  type: 'stdout' | 'stderr' | 'system';
  provider: AiProvider;
}

// AI CLI カスタム送信ボタン
// scope === 'global' は全リポジトリ共通、'repository' は repositoryPath で指定された
// リポジトリでのみ表示する
export type CustomAiButtonScope = 'global' | 'repository';

export interface CustomAiButton {
  id: string;
  name: string;
  command: string;
  createdAt: number;
  order: number;
  scope: CustomAiButtonScope;
  repositoryPath?: string; // scope === 'repository' のときに必須
}
