// 共有型定義は libs/shared-types に集約されている。
// アプリコードからは従来どおり '@/types' 経由で参照する
// （vite 側にエイリアスを足していないため、shared-types を直接 import しない）。
export type * from '@dokodemo-workspace/shared-types';

// --- 以下は web 固有の型（shared には置かない） ---

// コマンドタイプごとの送信設定
// needsEnter: コマンド送信後に改行を自動送信するかどうか
export interface CommandConfig {
  needsEnter: boolean; // 改行を自動送信するか
}
