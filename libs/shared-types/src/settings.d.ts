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
