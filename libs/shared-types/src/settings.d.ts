import type { AiProvider } from './ai';

// パーミッションモード（AI CLI 起動時の権限スキップ設定）
export type PermissionMode = 'disabled' | 'auto' | 'dangerous';

// Web Push通知関連の型定義
export interface PushSubscriptionJSON {
  endpoint: string;
  keys: {
    p256dh: string;
    auth: string;
  };
}

// AI の hook イベントを外へ知らせる Webhook の送り先
export interface HookWebhook {
  id: string;
  url: string;
  createdAt: number;
}

// Webhook で送る本文（POST の JSON）
export interface HookWebhookPayload {
  // hook のイベント名（Stop / UserPromptSubmit など）。設定画面からのテスト送信は 'Test'
  event: string;
  provider: AiProvider;
  // イベントが起きたリポジトリ（本体かワークツリー）の絶対パス。テスト送信では空文字
  repositoryPath: string;
  // 会話ログ（jsonl）の絶対パス。hook に付いていなければ null
  transcriptPath: string | null;
  // 送った時刻（ミリ秒）
  timestamp: number;
}
