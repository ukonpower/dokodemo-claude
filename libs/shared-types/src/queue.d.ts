import type { AiProvider } from './ai';

// プロンプトループ関連の型定義
// キューに投入したプロンプトを Stop hook 着弾のたびに末尾へ再投入し、
// 同じプロンプトを繰り返し実行する（自走）ためのアイテム内部状態

// 定期プランニング設定: N 周ごとに強いモデルで計画プロンプトを 1 ターン差し込み、
// 以降の周回の方向性を更新する（同一 CLI セッション内なので計画は文脈に残る）
export interface PromptLoopPlanning {
  everyN: number; // 何周ごとに実施（1以上）
  model: string; // プランニングターンで使うモデル（例: 'claude-opus-4-8'）
  prompt: string; // プランニングターンで送るプロンプト
}

export interface PromptLoopState {
  judge: 'ai' | 'user' | 'none';
  judgeEveryN: number; // 何周ごとに判断（judge !== 'none' のとき有効、1以上）
  judgeCriteria?: string; // AI 判断時のユーザー指定判定基準（終了条件）
  intervalSec: number; // 再送待機秒数（0 = 即時）
  iteration: number; // 現在の周回番号（1始まり、サーバ側で加算）
  startedAt: number;
  startedAtCommit?: string; // ループ開始時 HEAD（AI 判断の diff 起点）
  nextSendAt?: number; // インターバル待機中の次回送信予定 epoch ms
  pendingJudge?: boolean; // この周の送信前に AI 判断が必要
  awaitingUserApproval?: boolean;
  lastJudgeReason?: string;
  planning?: PromptLoopPlanning; // 定期プランニング設定
  pendingPlanning?: boolean; // 次の送信はプランニングターン
  planningActive?: boolean; // プランニングターン実行中
  modelRestorePending?: boolean; // プランニング後、次の通常送信でモデルを default に戻す
}

// プロンプトキュー関連の型定義
export interface PromptQueueItem {
  id: string;
  prompt: string;
  repositoryPath: string;
  provider: AiProvider;
  createdAt: number;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  sendClearBefore?: boolean; // プロンプト送信前に/clearを実行するか
  isAutoCommit?: boolean; // 完了後に自動的に/commitを実行するか
  isCodexReview?: boolean; // 完了後にCodexレビューを自動実行するか
  model?: string; // 使用するモデル（例: 'opus', 'sonnet', 'haiku'）
  loop?: PromptLoopState; // 設定されているとループアイテムとして扱う
}

export interface PromptQueueState {
  repositoryPath: string;
  provider: AiProvider;
  queue: PromptQueueItem[];
  isProcessing: boolean;
  isPaused: boolean; // キュー送信の一時停止状態
  currentItemId?: string;
}
