// 評価リクエスト（レビュー受信箱）関連の型定義
// docs/feedback-loop.md の「3. 評価リクエスト」に対応する

// 提示物: 判断材料となる画像 or 実機URL
export interface ReviewAttachment {
  type: 'image' | 'url';
  url: string; // image はバックエンドの恒久配信URL（相対パス）、url は実機URL 等
  label?: string; // 「案A」等のラベル
}

// 応答の3種（コスト順: 選択 < 一言 < そもそも）
export type ReviewResponseKind = 'choice' | 'comment' | 'fundamental';

export interface ReviewResponse {
  kind: ReviewResponseKind;
  choice?: string; // kind === 'choice' のとき選んだ選択肢
  comment?: string; // 一言（choice への添え書きにも使う）
  respondedAt: number;
}

export type ReviewRequestStatus = 'pending' | 'answered';

export interface ReviewRequest {
  id: string;
  rid: string; // 発行元リポジトリの ID
  aim: string; // 狙い: このサイクルで何を改善しようとしたか
  question: string; // 問い: 何を判断してほしいか
  attachments: ReviewAttachment[];
  choices: string[]; // 選択肢。空なら自由記述のみで応答
  status: ReviewRequestStatus;
  createdAt: number;
  response?: ReviewResponse;
  // 応答が来るまで発行元キュー（ループ含む）を一時停止するブロッキング発行か
  blocking?: boolean;
}
