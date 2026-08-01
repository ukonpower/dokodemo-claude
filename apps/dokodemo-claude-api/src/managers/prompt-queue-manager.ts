/**
 * プロンプトキュー管理マネージャー
 * AIへのプロンプト送信キューの管理を担当
 */

import { EventEmitter } from 'events';
import { execFileSync } from 'child_process';
import type {
  PromptQueueItem,
  PromptQueueState,
  PromptLoopState,
  PromptLoopPlanning,
  AiProvider,
} from '../types/index.js';
import { PersistenceService } from '../services/persistence-service.js';
import { Result, Ok, Err } from '../utils/result.js';
import { QueueError } from '../utils/errors.js';
import { judgeLoop } from '../services/loop-judge-service.js';

const PROMPT_QUEUES_FILE = 'prompt-queues.json';

// 空回り検知: 自動コミット有効なループで、この周回数だけ連続して HEAD が動かなければ
// 「同じところで足踏みしている」とみなして承認待ちに倒す。
// 毎周コミットが積まれる前提のループでしか判定できないため、自動コミット有効時のみ働く。
const LOOP_IDLE_ROUND_LIMIT = 3;

// TUI の再描画（起動直後・/clear や /model の実行直後）と入力の到達が競合すると、
// 文字や Enter が取りこぼされることが稀にある。保険として Enter をこの間隔で
// 1 回追加送信する。入力欄が空でも空 Enter は無害なため、二重送信のリスクはない。
const ENTER_RETRY_MS = 600;

// /clear・/model 実行後、次の入力を打ち込むまでの静定待ち。
// スラッシュコマンド実行直後は TUI が再描画中で入力を取りこぼしやすい
// （/model 切替直後にプロンプトが飲まれ UserPromptSubmit が来ない実績あり）。
const SLASH_SETTLE_MS = 900;

// プロンプトの最終 Enter 送信後、この時間内に UserPromptSubmit hook が発火しなければ
// 取りこぼしを疑い、送信全体の再送信（SEND_RESEND_LIMIT 回まで）→ 最後は
// 承認待ち/completed に倒す。
// カスタムスラッシュコマンドは展開後に UserPromptSubmit が発火するため、
// 展開・hook POST の遅延も見込んだ値にしている。
// 注意: かつてあった「Enter だけ再送」の救済は廃止した。CLI 内部のメッセージ
// キューにプロンプトが滞留している場合、空 Enter は「キュー済みメッセージの
// 割り込み送信」操作になり、実行中ターンを中断して事故を起こす（2026-08-02 実測）。
// Enter 取りこぼしの救済は、入力欄クリア込みの全体再送信が兼ねる。
const SEND_WATCHDOG_AFTER_SEND_MS = 6000;

// 送信前アイドルゲート: CLI が実行中に打鍵・Enter すると、プロンプトは実行されず
// CLI 内部のメッセージキューに滞留する。以後は「Stop hook で完了扱い→実は
// キューの古いプロンプトが走り出しただけ」という 1 周先行のズレが恒久化する
// （2026-08-02 実測: ループ開始時に CLI が実行中で、40 周ズレたまま走行）。
// 送信はアイドルを確認できるまで見送る。
const SEND_GATE_RETRY_MS = 5000; // 見送り後の再チェック間隔（Stop hook 再トリガの保険）

// 実行ステータスが running でも、PTY 出力がこの時間まったく無ければ stale
// （Stop の取りこぼし・順序レースで running が残った）とみなす。実行中の CLI は
// spinner の再描画で継続的に出力を出し続けるため、長い無出力＝実行していない。
const STATUS_DESYNC_SILENCE_MS = 20000;

// 送信ウォッチドッグの「送信全体の再送信」の上限回数。Enter 再送で救えない
// 取りこぼし（/model 後の打鍵破棄窓に打鍵が全部飲まれた等）を、承認待ちに
// 倒す前に /model の再適用込みでアイテム送信全体をやり直して自己回復を試みる。
const SEND_RESEND_LIMIT = 2;

// UserPromptSubmit hook が来ないまま「実行中らしき出力」を検知した場合の
// 再監視回数の上限（間隔は SEND_WATCHDOG_AFTER_SEND_MS）。hook の取りこぼし・
// 遅延が疑われる状況で、実行中のセッションへ再打鍵して別プロンプトを重ねる
// 事故を防ぐため、出力が動いている間は再送信せず監視だけを続ける。
const SEND_ACTIVITY_WAIT_LIMIT = 10;

// 「実行中らしさ」を PTY 出力から判定する目印（小文字比較）。
// Claude CLI / Codex CLI とも実行中はステータス行に interrupt 案内を出し続け、
// spinner 更新で継続的に再描画されるため、直近ウィンドウの出力デルタに
// この文字列が含まれるかで「今まさに実行中か」を判定できる。
const OUTPUT_ACTIVITY_MARKERS = ['esc to interrupt'];

// 打鍵確認（echo 確認）: 本文打鍵後、Enter 送信前に「入力欄へ本文が到達したか」を
// PTY 出力から確認する。/model・/clear 直後の TUI 再描画と打鍵が競合して本文ごと
// 飲まれた場合、watchdog の Enter 再送では救えず（空の入力欄に Enter しても何も
// 起きない）承認待ちに倒すしかなかった。打鍵時刻以降の出力デルタに目印（本文の
// 先頭/末尾数文字）が現れるかを見て、現れなければ本文を打ち直す。
//
// 打ち直しは間隔を漸増させながら粘る。/model 実行直後の CLI には打鍵を
// まるごと破棄する時間帯が十数秒続くことがあり（2026-07-29 実測: /model
// claude-fable-5 の実行完了後、打ち直しも watchdog の Enter 再送もすべて
// 無反応のまま消え、その後 CLI は空の入力欄でアイドルに戻っていた）、
// 回数上限ではなく時間予算で粘る（破棄窓の実測十数秒＋余裕）。
// 打ち直しの前には入力欄をクリア（Ctrl+U）し、「実は前の打鍵が届いていたが
// echo 確認に失敗していた」ケースで本文が二重に連結されるのを防ぐ。
const ECHO_CHECK_FIRST_DELAY_MS = 500; // 打鍵から最初の確認までの待ちの基準値（従来の Enter 前待ちを兼ねる）
const ECHO_CHECK_RETRY_DELAY_MS = 700; // 目印未達時の再確認までの待ちの基準値
const ECHO_RETYPE_BUDGET_MS = 30000; // 打ち直しを続ける時間予算
const ECHO_RETYPE_DELAY_SCALE_MAX = 4; // 待ち時間の漸増上限（基準値×この倍率まで）
const ECHO_NEEDLE_LENGTH = 16; // 目印の長さ（正規化後の文字数）

/**
 * AIセッションとのやり取りを抽象化するインターフェース
 */
export interface QueueAiSessionAdapter {
  /**
   * リポジトリのセッションを取得
   */
  getSession(
    repositoryPath: string,
    provider: AiProvider
  ): { id: string; repositoryPath: string; provider: AiProvider } | null;

  /**
   * セッションにコマンドを送信
   * 戻り値: PTY 書き込みに成功したかどうか（セッション/インスタンスが見つからなければ false）
   */
  sendCommand(sessionId: string, command: string): boolean;

  /**
   * セッションを確保（存在しなければ作成）
   * coldStart: 今回新規に CLI を spawn した場合 true（既存セッション再利用時は false）
   */
  ensureSession(
    repositoryPath: string,
    provider: AiProvider
  ): Promise<{
    id: string;
    repositoryPath: string;
    provider: AiProvider;
    coldStart: boolean;
  }>;

  /**
   * コールドスタート直後のセッションが入力受付可能になるまで待つ
   */
  waitForSessionReady(sessionId: string): Promise<void>;

  /**
   * セッションの状態を取得
   */
  getSessionStatus(sessionId: string): { isActive: boolean } | null;

  /**
   * プライマリAIが処理中か（UserPromptSubmit → running, Stop → completed/idle）
   */
  isPrimaryAiBusy(repositoryPath: string, provider: AiProvider): boolean;

  /**
   * プライマリAIが running へ遷移した時刻（ms）。running でなければ null。
   * 送信ウォッチドッグが「この送信に対する UserPromptSubmit か、それ以前から
   * 残っている stale な running か」を判別するのに使う。
   */
  getPrimaryRunningSince(
    repositoryPath: string,
    provider: AiProvider
  ): number | null;

  /**
   * プライマリセッションの出力末尾を取得（ループ AI 判断の入力に使う）。
   * 実装側で ANSI 除去と末尾行トリミングを行う。
   */
  getPrimaryOutputTail(repositoryPath: string, provider: AiProvider): string;

  /**
   * プライマリセッションの出力のうち、指定時刻以降に受信した分を ANSI 除去して
   * 返す（打鍵確認に使う。打鍵より古い出力＝前周回の同一プロンプトの残骸を
   * 照合対象から外すため、時刻で絞る）。
   */
  getPrimaryOutputSince(
    repositoryPath: string,
    provider: AiProvider,
    sinceTimestampMs: number
  ): string;
}

export class PromptQueueManager extends EventEmitter {
  private queues: Map<string, PromptQueueState> = new Map();
  private queueCounter = 0;

  private aiSessionAdapter: QueueAiSessionAdapter | null = null;

  // ループのインターバル待機用タイマー（キー = queueKey）
  private loopTimers: Map<string, NodeJS.Timeout> = new Map();

  // 送信前アイドルゲートの再チェックタイマー（キー = queueKey）。
  // CLI が実行中で送信を見送ったときの保険。通常は実行中ターンの Stop hook が
  // processNextItem を再トリガするため、これは Stop を取りこぼした場合の救済。
  private sendGateTimers: Map<string, NodeJS.Timeout> = new Map();

  // AI 判断の abort（キー = queueKey）
  private loopJudgeAborts: Map<string, AbortController> = new Map();

  // 送信世代（キー = queueKey）。送信ごとにインクリメントし、watchdog が自分の
  // 世代と照合する。ループアイテムは周回をまたいで同じ itemId を使い回すため、
  // itemId の一致だけでは前の周回の watchdog（stale）を弾けない。
  private sendGenerations: Map<string, number> = new Map();

  // セッションへ最後に適用した /model の値（キー = queueKey）。
  // worktree 委譲時に「作成元セッションと同じモデルで動かす」継承の参照元になるほか、
  // 同じ値なら /model 送信をスキップする判定（冗長送信の削減）にも使う。
  private currentModels: Map<string, string> = new Map();

  constructor(
    private readonly persistenceService: PersistenceService,
    aiSessionAdapter?: QueueAiSessionAdapter
  ) {
    super();
    if (aiSessionAdapter) {
      this.aiSessionAdapter = aiSessionAdapter;
    }
  }

  /**
   * AIセッションアダプターを設定
   */
  setAiSessionAdapter(adapter: QueueAiSessionAdapter): void {
    this.aiSessionAdapter = adapter;
  }

  /**
   * 初期化（永続化データの復元）
   */
  async initialize(): Promise<void> {
    await this.restoreQueues();
  }

  /**
   * キューキーを生成
   */
  private getQueueKey(repositoryPath: string, provider: AiProvider): string {
    return `${provider}:${repositoryPath}`;
  }

  /**
   * セッションへ最後に適用した /model の値を取得する（未送信なら undefined）。
   */
  getCurrentModel(repositoryPath: string, provider: AiProvider): string | undefined {
    return this.currentModels.get(this.getQueueKey(repositoryPath, provider));
  }

  /**
   * /model 適用キャッシュの無効化。Web UI からユーザーが手動で /model を送った等、
   * キュー外の経路でセッションのモデルが変わりうるときに呼ぶ。
   * 次回のキュー送信ではスキップ判定が効かず /model を必ず再適用する。
   */
  invalidateCurrentModel(repositoryPath: string, provider: AiProvider): void {
    this.currentModels.delete(this.getQueueKey(repositoryPath, provider));
  }

  /**
   * リポジトリの HEAD コミットハッシュを取得。失敗時 undefined。
   * ループ開始時の diff 起点として使う。
   */
  private getHeadCommit(repositoryPath: string): string | undefined {
    try {
      const out = execFileSync('git', ['rev-parse', 'HEAD'], {
        cwd: repositoryPath,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      });
      const commit = out.trim();
      return commit || undefined;
    } catch {
      return undefined;
    }
  }

  /**
   * キュー状態を取得または作成
   */
  private getOrCreateQueueState(
    repositoryPath: string,
    provider: AiProvider
  ): PromptQueueState {
    const key = this.getQueueKey(repositoryPath, provider);
    let state = this.queues.get(key);

    if (!state) {
      state = {
        repositoryPath,
        provider,
        queue: [],
        isProcessing: false,
        isPaused: false,
      };
      this.queues.set(key, state);
    }

    return state;
  }

  /**
   * キューにアイテムを追加
   */
  async addToQueue(
    repositoryPath: string,
    provider: AiProvider,
    prompt: string,
    options?: {
      sendClearBefore?: boolean;
      isAutoCommit?: boolean;
      isAutoCommitPush?: boolean;
      isCodexReview?: boolean;
      model?: string;
      loop?: {
        judge: 'ai' | 'user' | 'none';
        judgeEveryN: number;
        intervalSec: number;
        judgeCriteria?: string;
        reviewBlocking?: 'ai' | 'always' | 'never';
        planning?: PromptLoopPlanning;
      };
      // ループアイテムより手前に挿入する（評価応答の反映ターン等、
      // 次のループ周回より先に処理させたいプロンプト用）
      insertBeforeLoop?: boolean;
    }
  ): Promise<Result<PromptQueueItem, QueueError>> {
    try {
      const state = this.getOrCreateQueueState(repositoryPath, provider);

      // 1 キュー（provider × repositoryPath）につきループアイテムは 1 つまで
      if (options?.loop) {
        const hasLoop = state.queue.some((i) => i.loop);
        if (hasLoop) {
          return Err(QueueError.loopAlreadyExists(repositoryPath));
        }
      }

      const now = Date.now();
      let loop: PromptLoopState | undefined;
      if (options?.loop) {
        loop = {
          judge: options.loop.judge,
          judgeEveryN: Math.max(1, Math.floor(options.loop.judgeEveryN)),
          intervalSec: Math.max(0, Math.floor(options.loop.intervalSec)),
          judgeCriteria: options.loop.judgeCriteria?.trim() || undefined,
          planning: this.normalizeLoopPlanning(options.loop.planning),
          iteration: 1,
          startedAt: now,
          startedAtCommit: this.getHeadCommit(repositoryPath),
        };
      }

      const item: PromptQueueItem = {
        id: `prompt-${++this.queueCounter}-${now}`,
        prompt,
        repositoryPath,
        provider,
        createdAt: now,
        status: 'pending',
        sendClearBefore: options?.sendClearBefore,
        isAutoCommit: options?.isAutoCommit,
        isAutoCommitPush: options?.isAutoCommitPush,
        isCodexReview: options?.isCodexReview,
        model: options?.model,
        loop,
      };

      // insertBeforeLoop: 待機中（pending）のループアイテムがあればその手前に挿入する。
      // 処理中のループアイテムは順序に影響しないため対象外（末尾 push でよい）
      const loopIndex = options?.insertBeforeLoop
        ? state.queue.findIndex((i) => i.loop && i.status === 'pending')
        : -1;
      if (loopIndex !== -1) {
        state.queue.splice(loopIndex, 0, item);
      } else {
        state.queue.push(item);
      }

      await this.persistQueues();

      // キュー更新イベントを発火
      this.emitQueueUpdated(repositoryPath, provider, state);

      // 処理中でなく、一時停止中でなく、プライマリAIも busy でなければ即座に処理開始
      // （直送プロンプトで AI が処理中のときは Stop hook 着弾後に triggerFromHook が処理を進める）
      const aiBusy =
        this.aiSessionAdapter?.isPrimaryAiBusy(repositoryPath, provider) ??
        false;
      if (!state.isProcessing && !state.isPaused && !aiBusy) {
        this.processNextItem(repositoryPath, provider);
      }

      return Ok(item);
    } catch (e) {
      const error = QueueError.addFailed(repositoryPath, e);
      console.error('[PromptQueueManager]', error.message, e);
      return Err(error);
    }
  }

  /**
   * キューからアイテムを削除
   */
  async removeFromQueue(
    repositoryPath: string,
    provider: AiProvider,
    itemId: string
  ): Promise<Result<void, QueueError>> {
    const state = this.getOrCreateQueueState(repositoryPath, provider);

    const index = state.queue.findIndex((item) => item.id === itemId);
    if (index === -1) {
      return Err(QueueError.itemNotFound(itemId));
    }

    // 処理中のアイテムを削除する場合、処理状態をリセット
    // 注: シグナル送信はProcessManager側で行う
    const isDeletingCurrentItem = state.currentItemId === itemId;
    if (isDeletingCurrentItem) {
      state.isProcessing = false;
      state.currentItemId = undefined;
    }

    const targetItem = state.queue[index];
    // ループアイテムの削除ならタイマー・判断 abort をクリア
    if (targetItem?.loop) {
      this.clearLoopTimer(repositoryPath, provider);
      this.abortLoopJudge(repositoryPath, provider);
    }

    state.queue.splice(index, 1);
    await this.persistQueues();

    this.emitQueueUpdated(repositoryPath, provider, state);

    // 処理中のアイテムを削除した場合、次のキューアイテムを処理
    if (isDeletingCurrentItem && !state.isPaused && state.queue.length > 0) {
      setImmediate(() => {
        this.processNextItem(repositoryPath, provider);
      });
    }

    return Ok(undefined);
  }

  /**
   * キューアイテムを更新
   */
  async updateItem(
    repositoryPath: string,
    provider: AiProvider,
    itemId: string,
    updates: {
      prompt?: string;
      sendClearBefore?: boolean;
      isAutoCommit?: boolean;
      isAutoCommitPush?: boolean;
      isCodexReview?: boolean;
      model?: string;
      // null: ループ解除 / 値あり: 設定項目を差し替え（iteration 等の状態は維持）
      loop?: {
        judge: 'ai' | 'user' | 'none';
        judgeEveryN: number;
        intervalSec: number;
        judgeCriteria?: string;
        planning?: PromptLoopPlanning;
      } | null;
    }
  ): Promise<Result<boolean, QueueError>> {
    const state = this.getOrCreateQueueState(repositoryPath, provider);

    const item = state.queue.find((i) => i.id === itemId);
    if (!item) {
      return Err(QueueError.itemNotFound(itemId));
    }

    // pending状態のアイテムのみ更新可能
    if (item.status !== 'pending') {
      return Ok(false);
    }

    // 更新を適用
    if (updates.prompt !== undefined) {
      item.prompt = updates.prompt;
    }
    if (updates.sendClearBefore !== undefined) {
      item.sendClearBefore = updates.sendClearBefore;
    }
    if (updates.isAutoCommit !== undefined) {
      item.isAutoCommit = updates.isAutoCommit;
    }
    if (updates.isAutoCommitPush !== undefined) {
      item.isAutoCommitPush = updates.isAutoCommitPush;
    }
    if (updates.isCodexReview !== undefined) {
      item.isCodexReview = updates.isCodexReview;
    }
    if (updates.model !== undefined) {
      item.model = updates.model;
    }
    if (updates.loop !== undefined) {
      if (updates.loop === null) {
        // ループ解除。タイマー・判断 abort をクリア
        item.loop = undefined;
        this.clearLoopTimer(repositoryPath, provider);
        this.abortLoopJudge(repositoryPath, provider);
      } else if (item.loop) {
        // 既存ループの設定項目のみ差し替え
        item.loop.judge = updates.loop.judge;
        item.loop.judgeEveryN = Math.max(
          1,
          Math.floor(updates.loop.judgeEveryN)
        );
        item.loop.intervalSec = Math.max(
          0,
          Math.floor(updates.loop.intervalSec)
        );
        item.loop.judgeCriteria = updates.loop.judgeCriteria?.trim() || undefined;
        item.loop.planning = this.normalizeLoopPlanning(updates.loop.planning);
        if (!item.loop.planning) {
          // プランニング解除時は予約中のプランニングターンも取り消す
          item.loop.pendingPlanning = undefined;
          item.loop.planningActive = undefined;
        }
      } else {
        // 新規ループ化。1 キュー 1 ループ制限をチェック
        const hasLoop = state.queue.some((i) => i.loop);
        if (hasLoop) {
          return Err(QueueError.loopAlreadyExists(repositoryPath));
        }
        item.loop = {
          judge: updates.loop.judge,
          judgeEveryN: Math.max(1, Math.floor(updates.loop.judgeEveryN)),
          intervalSec: Math.max(0, Math.floor(updates.loop.intervalSec)),
          judgeCriteria: updates.loop.judgeCriteria?.trim() || undefined,
          planning: this.normalizeLoopPlanning(updates.loop.planning),
          iteration: 1,
          startedAt: Date.now(),
          startedAtCommit: this.getHeadCommit(repositoryPath),
        };
      }
    }

    await this.persistQueues();
    this.emitQueueUpdated(repositoryPath, provider, state);

    return Ok(true);
  }

  /**
   * ループを停止（アイテムを削除、または実行中は再投入されないよう loop をクリア）
   */
  async stopLoop(
    repositoryPath: string,
    provider: AiProvider,
    itemId: string
  ): Promise<Result<void, QueueError>> {
    const state = this.getOrCreateQueueState(repositoryPath, provider);
    const item = state.queue.find((i) => i.id === itemId);
    if (!item) {
      return Err(QueueError.itemNotFound(itemId));
    }
    if (!item.loop) {
      return Err(QueueError.loopBusy('対象はループアイテムではありません'));
    }

    this.clearLoopTimer(repositoryPath, provider);
    this.abortLoopJudge(repositoryPath, provider);

    if (item.status === 'processing') {
      // 実行中: 完走させるが再投入されないよう loop をクリア
      item.loop = undefined;
    } else {
      // pending: 削除
      const idx = state.queue.indexOf(item);
      if (idx !== -1) {
        state.queue.splice(idx, 1);
      }
    }

    this.emit('prompt-loop-ended', {
      repositoryPath,
      provider,
      itemId,
      endedBy: 'user' as const,
    });

    await this.persistQueues();
    this.emitQueueUpdated(repositoryPath, provider, state);

    return Ok(undefined);
  }

  /**
   * ループアイテムの継続をユーザーが承認 or 停止する
   */
  async approveLoopContinuation(
    repositoryPath: string,
    provider: AiProvider,
    itemId: string,
    approved: boolean
  ): Promise<Result<void, QueueError>> {
    const state = this.getOrCreateQueueState(repositoryPath, provider);
    const item = state.queue.find((i) => i.id === itemId);
    if (!item) {
      return Err(QueueError.itemNotFound(itemId));
    }
    if (!item.loop) {
      return Err(QueueError.loopBusy('対象はループアイテムではありません'));
    }
    if (!item.loop.awaitingUserApproval) {
      return Err(QueueError.loopBusy('承認待ちではありません'));
    }

    if (!approved) {
      return this.stopLoop(repositoryPath, provider, itemId);
    }

    item.loop.awaitingUserApproval = false;
    // 空回りで倒れていた場合、カウンタを戻さないと承認直後に再び倒れる
    item.loop.idleRounds = 0;

    await this.persistQueues();
    this.emitQueueUpdated(repositoryPath, provider, state);

    if (!state.isProcessing && !state.isPaused) {
      await this.processNextItem(repositoryPath, provider);
    }

    return Ok(undefined);
  }

  /**
   * ループへの指示を追加する。指示は loop.feedback に溜まり、
   * 次のサイクル間で指示反映ターンとしてまとめて送られる。
   */
  async addLoopFeedback(
    repositoryPath: string,
    provider: AiProvider,
    itemId: string,
    text: string
  ): Promise<Result<void, QueueError>> {
    const state = this.getOrCreateQueueState(repositoryPath, provider);
    const item = state.queue.find((i) => i.id === itemId);
    if (!item) {
      return Err(QueueError.itemNotFound(itemId));
    }
    if (!item.loop) {
      return Err(QueueError.loopBusy('対象はループアイテムではありません'));
    }
    const trimmed = text.trim();
    if (!trimmed) {
      return Err(QueueError.loopBusy('指示が空です'));
    }

    item.loop.feedback = [...(item.loop.feedback ?? []), trimmed];

    await this.persistQueues();
    this.emitQueueUpdated(repositoryPath, provider, state);

    // 送信待ちで止まっている場合（キュー空 + 非処理中）はここから反映ターンが動き出す。
    // インターバル待機・承認待ち等のゲートは processNextItem 側で判定される
    if (!state.isProcessing && !state.isPaused) {
      void this.processNextItem(repositoryPath, provider);
    }

    return Ok(undefined);
  }

  /**
   * 未反映の指示を削除する（index = loop.feedback 内の位置）。
   * 反映ターンに含めて送信済みの分（feedbackActive 件数）は削除できない。
   */
  async removeLoopFeedback(
    repositoryPath: string,
    provider: AiProvider,
    itemId: string,
    index: number
  ): Promise<Result<void, QueueError>> {
    const state = this.getOrCreateQueueState(repositoryPath, provider);
    const item = state.queue.find((i) => i.id === itemId);
    if (!item?.loop?.feedback) {
      return Err(QueueError.itemNotFound(itemId));
    }
    const sentCount = item.loop.feedbackActive ?? 0;
    if (index < sentCount || index >= item.loop.feedback.length) {
      return Err(QueueError.loopBusy('削除できない指示です'));
    }

    item.loop.feedback = item.loop.feedback.filter((_, i) => i !== index);
    if (item.loop.feedback.length === 0) {
      item.loop.feedback = undefined;
    }

    await this.persistQueues();
    this.emitQueueUpdated(repositoryPath, provider, state);

    return Ok(undefined);
  }

  /**
   * 指示反映ターンのプロンプトを組み立てる。
   */
  private buildFeedbackPrompt(feedback: string[]): string {
    const list = feedback
      .map((f) => `- ${f.replace(/\n/g, '\n  ')}`)
      .join('\n');
    return [
      'ループ実行中にユーザーから以下の指示が届きました。',
      '',
      list,
      '',
      'これらの指示を読み、今後の作業の計画・進め方に反映してください。',
      '計画やタスクを管理するファイル（docs/tasks.md 等）を運用している場合は、その内容も更新してください。',
      'このターンでは指示の反映のみを行い、通常の作業タスクは進めないでください。',
    ].join('\n');
  }

  /**
   * 定期プランニング設定の正規化。model / prompt が空なら「設定なし」として扱う。
   */
  private normalizeLoopPlanning(
    planning?: PromptLoopPlanning
  ): PromptLoopPlanning | undefined {
    if (!planning) return undefined;
    const model = planning.model?.trim();
    const prompt = planning.prompt?.trim();
    if (!model || !prompt) return undefined;
    return {
      everyN: Math.max(1, Math.floor(planning.everyN)),
      model,
      prompt,
    };
  }

  private bumpSendGeneration(
    repositoryPath: string,
    provider: AiProvider
  ): number {
    const key = this.getQueueKey(repositoryPath, provider);
    const generation = (this.sendGenerations.get(key) ?? 0) + 1;
    this.sendGenerations.set(key, generation);
    return generation;
  }

  private clearLoopTimer(repositoryPath: string, provider: AiProvider): void {
    const key = this.getQueueKey(repositoryPath, provider);
    const timer = this.loopTimers.get(key);
    if (timer) {
      clearTimeout(timer);
      this.loopTimers.delete(key);
    }
  }

  private abortLoopJudge(repositoryPath: string, provider: AiProvider): void {
    const key = this.getQueueKey(repositoryPath, provider);
    const controller = this.loopJudgeAborts.get(key);
    if (controller) {
      controller.abort();
      this.loopJudgeAborts.delete(key);
    }
  }

  /**
   * キューをリセット（処理中アイテムもpendingに戻す）
   */
  async resetQueue(
    repositoryPath: string,
    provider: AiProvider
  ): Promise<Result<void, QueueError>> {
    const state = this.getOrCreateQueueState(repositoryPath, provider);

    // 処理中のアイテムをpendingに戻す
    for (const item of state.queue) {
      if (item.status === 'processing') {
        item.status = 'pending';
      }
    }

    // 処理状態をリセット
    state.isProcessing = false;
    state.currentItemId = undefined;
    state.isPaused = true;

    await this.persistQueues();
    this.emitQueueUpdated(repositoryPath, provider, state);

    return Ok(undefined);
  }

  /**
   * キューアイテムを再キュー
   */
  async requeueItem(
    repositoryPath: string,
    provider: AiProvider,
    itemId: string
  ): Promise<Result<void, QueueError>> {
    const state = this.getOrCreateQueueState(repositoryPath, provider);

    const item = state.queue.find((i) => i.id === itemId);
    if (!item) {
      return Err(QueueError.itemNotFound(itemId));
    }

    if (item.status === 'completed' || item.status === 'failed') {
      item.status = 'pending';
      await this.persistQueues();
      this.emitQueueUpdated(repositoryPath, provider, state);

      if (!state.isProcessing && !state.isPaused) {
        this.processNextItem(repositoryPath, provider);
      }
    }

    return Ok(undefined);
  }

  /**
   * キューアイテムを強制送信（順番を無視して即座に処理）
   */
  async forceSendItem(
    repositoryPath: string,
    provider: AiProvider,
    itemId: string
  ): Promise<Result<void, QueueError>> {
    if (!this.aiSessionAdapter) {
      console.error(
        '[PromptQueueManager] AIセッションアダプターが設定されていません'
      );
      return Err(
        QueueError.addFailed(
          repositoryPath,
          'AIセッションアダプターが設定されていません'
        )
      );
    }

    const state = this.getOrCreateQueueState(repositoryPath, provider);

    const item = state.queue.find((i) => i.id === itemId);
    if (!item) {
      return Err(QueueError.itemNotFound(itemId));
    }

    // 待機中でなければ強制送信できない
    if (item.status !== 'pending') {
      return Err(
        QueueError.addFailed(
          repositoryPath,
          '待機中のアイテムのみ強制送信できます'
        )
      );
    }

    // すでに処理中のアイテムがある場合はエラー
    if (state.isProcessing) {
      return Err(
        QueueError.addFailed(repositoryPath, '他のアイテムが処理中です')
      );
    }

    // 送信前アイドルゲート: 実行中の CLI へ強制送信すると、プロンプトが CLI
    // 内部キューに滞留して周回の対応関係が壊れるため拒否する
    if (!this.isPrimarySessionIdle(repositoryPath, provider)) {
      return Err(
        QueueError.addFailed(
          repositoryPath,
          'AI が実行中のため送信できません。完了を待ってから再実行してください'
        )
      );
    }

    // ループアイテムの場合: 承認待ち / 判断中は強制送信できない。
    // インターバル待機中はタイマーとカウントダウンをクリアして即送信へ
    let sendOverride:
      | { prompt?: string; model?: string; skipClear?: boolean }
      | undefined;
    if (item.loop) {
      if (item.loop.awaitingUserApproval) {
        return Err(
          QueueError.loopBusy('承認待ち中は強制送信できません')
        );
      }
      if (item.loop.pendingJudge) {
        return Err(QueueError.loopBusy('AI 判断中は強制送信できません'));
      }
      item.loop.nextSendAt = undefined;
      this.clearLoopTimer(repositoryPath, provider);

      // processNextItem と同じ送信差し替え（指示反映 / プランニング / モデル復帰）
      if (item.loop.feedback?.length) {
        item.loop.feedbackActive = item.loop.feedback.length;
        sendOverride = {
          prompt: this.buildFeedbackPrompt(item.loop.feedback),
          skipClear: true,
        };
      } else if (item.loop.pendingPlanning && item.loop.planning) {
        item.loop.pendingPlanning = false;
        item.loop.planningActive = true;
        sendOverride = {
          prompt: item.loop.planning.prompt,
          model: item.loop.planning.model,
          skipClear: true,
        };
      } else if (item.loop.modelRestorePending) {
        item.loop.modelRestorePending = false;
        if (!item.model) {
          sendOverride = { model: 'default' };
        }
      }
    }

    // ステータスを processing に変更
    item.status = 'processing';
    state.isProcessing = true;
    state.currentItemId = item.id;

    await this.persistQueues();

    this.emit('prompt-queue-processing-started', {
      repositoryPath,
      provider,
      itemId: item.id,
    });

    this.emitQueueUpdated(repositoryPath, provider, state);

    try {
      const session = await this.aiSessionAdapter.ensureSession(
        repositoryPath,
        provider
      );

      // CLI が入力受付可能になるまで待ってから送信する。
      // ensure-primary-instance などで先に PTY を spawn 済みの場合
      // coldStart=false が返るが、CLI 起動完了前に prompt を打ち込むと
      // 取りこぼされるため、ここでも必ず ready を待機する
      // （waitForSessionReady() は session.readyPromise を await するだけで、
      // 既に ready 済みなら即座に resolve するためコストは無い）。
      await this.aiSessionAdapter.waitForSessionReady(session.id);

      // コマンド送信処理
      const generation = this.bumpSendGeneration(repositoryPath, provider);
      const sendStartedAt = Date.now();
      await this.sendItemCommands(
        session.id,
        item,
        session.coldStart,
        sendOverride
      );

      // processNextItem と同じく送信ウォッチドッグを仕掛ける
      this.scheduleSendWatchdog(
        repositoryPath,
        provider,
        item.id,
        generation,
        sendOverride,
        sendStartedAt
      );
    } catch (error) {
      console.error('[PromptQueueManager] セッション確保エラー:', error);
      item.status = 'failed';
      state.isProcessing = false;
      state.currentItemId = undefined;
      await this.persistQueues();

      this.emit('prompt-queue-processing-completed', {
        repositoryPath,
        provider,
        itemId: item.id,
        success: false,
      });

      this.emitQueueUpdated(repositoryPath, provider, state);
    }

    return Ok(undefined);
  }

  /**
   * キューの並べ替え
   */
  async reorderQueue(
    repositoryPath: string,
    provider: AiProvider,
    itemIds: string[]
  ): Promise<Result<void, QueueError>> {
    const state = this.getOrCreateQueueState(repositoryPath, provider);

    const newQueue: PromptQueueItem[] = [];
    for (const itemId of itemIds) {
      const item = state.queue.find((i) => i.id === itemId);
      if (item) {
        newQueue.push(item);
      }
    }

    // 含まれていなかったアイテムを末尾に追加
    for (const item of state.queue) {
      if (!itemIds.includes(item.id)) {
        newQueue.push(item);
      }
    }

    state.queue = newQueue;
    await this.persistQueues();
    this.emitQueueUpdated(repositoryPath, provider, state);

    return Ok(undefined);
  }

  /**
   * キューを一時停止
   */
  async pauseQueue(
    repositoryPath: string,
    provider: AiProvider
  ): Promise<Result<void, QueueError>> {
    const state = this.getOrCreateQueueState(repositoryPath, provider);
    state.isPaused = true;

    await this.persistQueues();
    this.emitQueueUpdated(repositoryPath, provider, state);

    return Ok(undefined);
  }

  /**
   * 現在処理中のアイテムをキャンセルして未送信に戻す
   */
  async cancelCurrentItem(
    repositoryPath: string,
    provider: AiProvider
  ): Promise<Result<void, QueueError>> {
    const state = this.getOrCreateQueueState(repositoryPath, provider);

    // 処理中のアイテムがない場合
    if (!state.currentItemId || !state.isProcessing) {
      return Err(
        QueueError.addFailed(repositoryPath, '処理中のアイテムがありません')
      );
    }

    // ループ判断中のセンチネルを掴んでいる場合は abort して pendingJudge をクリア
    if (state.currentItemId === 'loop-judge') {
      this.abortLoopJudge(repositoryPath, provider);
      // ループアイテムを検索して pendingJudge を確認待ちに倒す（安全側フォールバック）
      const loopItem = state.queue.find((i) => i.loop);
      if (loopItem?.loop) {
        loopItem.loop.pendingJudge = false;
        loopItem.loop.awaitingUserApproval = true;
      }
      state.isProcessing = false;
      state.currentItemId = undefined;
      state.isPaused = true;
      await this.persistQueues();
      this.emitQueueUpdated(repositoryPath, provider, state);
      return Ok(undefined);
    }

    // 処理中のアイテムを見つけてpendingに戻す
    const currentItem = state.queue.find(
      (item) => item.id === state.currentItemId
    );
    if (currentItem && currentItem.status === 'processing') {
      currentItem.status = 'pending';
    }

    // 処理状態をリセットして停止
    state.isProcessing = false;
    state.currentItemId = undefined;
    state.isPaused = true;

    await this.persistQueues();
    this.emitQueueUpdated(repositoryPath, provider, state);

    return Ok(undefined);
  }

  /**
   * キューを再開
   */
  async resumeQueue(
    repositoryPath: string,
    provider: AiProvider
  ): Promise<Result<void, QueueError>> {
    const state = this.getOrCreateQueueState(repositoryPath, provider);
    state.isPaused = false;

    await this.persistQueues();
    this.emitQueueUpdated(repositoryPath, provider, state);

    // 次のアイテムを処理
    if (!state.isProcessing) {
      this.processNextItem(repositoryPath, provider);
    }

    return Ok(undefined);
  }

  /**
   * キューをクリア
   */
  async clearQueue(
    repositoryPath: string,
    provider: AiProvider
  ): Promise<Result<void, QueueError>> {
    const state = this.getOrCreateQueueState(repositoryPath, provider);

    // キューをクリアして処理状態をリセット
    // 注: シグナル送信はProcessManager側で行う
    state.queue = [];
    state.isProcessing = false;
    state.currentItemId = undefined;

    await this.persistQueues();
    this.emitQueueUpdated(repositoryPath, provider, state);

    return Ok(undefined);
  }

  /**
   * キュー状態を取得
   */
  getQueueState(
    repositoryPath: string,
    provider: AiProvider
  ): PromptQueueState | undefined {
    const key = this.getQueueKey(repositoryPath, provider);
    return this.queues.get(key);
  }

  /**
   * キューアイテム一覧を取得
   */
  getQueue(repositoryPath: string, provider: AiProvider): PromptQueueItem[] {
    const state = this.getQueueState(repositoryPath, provider);
    return state?.queue || [];
  }

  /**
   * フックからのキュートリガー
   */
  async triggerFromHook(
    repositoryPath: string,
    provider: AiProvider
  ): Promise<void> {
    const state = this.getOrCreateQueueState(repositoryPath, provider);

    const hasPendingItems = state.queue.some(
      (item) => item.status === 'pending'
    );
    if (!state.currentItemId && !hasPendingItems) {
      return;
    }

    // 自動コミット処理中の場合
    if (state.currentItemId === 'auto-commit') {
      state.isProcessing = false;
      state.currentItemId = undefined;

      await this.persistQueues();
      this.emitQueueUpdated(repositoryPath, provider, state);

      await this.processNextItem(repositoryPath, provider);
      return;
    }

    // Codexレビュー処理中の場合
    if (state.currentItemId === 'codex-review') {
      state.isProcessing = false;
      state.currentItemId = undefined;

      await this.persistQueues();
      this.emitQueueUpdated(repositoryPath, provider, state);

      await this.processNextItem(repositoryPath, provider);
      return;
    }

    // 処理中のアイテムを完了にする
    let shouldAutoCommit = false;
    let shouldAutoCommitPush = false;
    let shouldCodexReview = false;
    if (state.currentItemId) {
      const currentItem = state.queue.find(
        (item) => item.id === state.currentItemId
      );
      if (currentItem) {
        currentItem.status = 'completed';
        shouldAutoCommit = currentItem.isAutoCommit || false;
        shouldAutoCommitPush = currentItem.isAutoCommitPush || false;
        shouldCodexReview = currentItem.isCodexReview || false;

        this.emit('prompt-queue-processing-completed', {
          repositoryPath,
          provider,
          itemId: currentItem.id,
          success: true,
        });

        // ループアイテムなら、shouldAutoCommit / shouldCodexReview 判定の前に
        // 同一アイテムを pending に戻して末尾へ再投入する
        // （周回ごとに completed を積まない）
        if (currentItem.loop) {
          const loop = currentItem.loop;
          if (loop.feedbackActive) {
            // 指示反映ターン完了: 反映済みの指示だけを消す（ターン中に届いた
            // 指示は持ち越して次の反映ターンへ）。周回は数えず、判断・自動
            // コミット等も挟まずに次のターンへ戻る
            const remaining = loop.feedback?.slice(loop.feedbackActive);
            loop.feedback = remaining?.length ? remaining : undefined;
            loop.feedbackActive = undefined;
            shouldAutoCommit = false;
            shouldCodexReview = false;
            currentItem.status = 'pending';
            const idx = state.queue.indexOf(currentItem);
            if (idx !== -1) {
              state.queue.splice(idx, 1);
              state.queue.push(currentItem);
            }
          } else if (loop.planningActive) {
            // プランニングターン完了: 周回は数えず、判断・自動コミット等も挟まずに
            // 即時で次の作業ターンへ戻る（計画は同一セッションの文脈に残っている）
            loop.planningActive = false;
            if (!currentItem.model) {
              // アイテムにモデル指定が無い場合、セッションがプランニング用モデルの
              // ままになるため、次の通常送信で /model default に戻す
              loop.modelRestorePending = true;
            }
            shouldAutoCommit = false;
            shouldCodexReview = false;
            currentItem.status = 'pending';
            const idx = state.queue.indexOf(currentItem);
            if (idx !== -1) {
              state.queue.splice(idx, 1);
              state.queue.push(currentItem);
            }
          } else {
            const completedIteration = loop.iteration;
            loop.iteration += 1;
            currentItem.status = 'pending';
            const idx = state.queue.indexOf(currentItem);
            if (idx !== -1) {
              state.queue.splice(idx, 1);
              state.queue.push(currentItem);
            }
            // 判断周か（完了した周番号で判定: judgeEveryN=3 なら 3,6,9 周完了後）
            if (
              loop.judge !== 'none' &&
              completedIteration % loop.judgeEveryN === 0
            ) {
              if (loop.judge === 'ai') {
                loop.pendingJudge = true;
              } else {
                loop.awaitingUserApproval = true;
                this.emit('loop-approval-required', {
                  repositoryPath,
                  provider,
                  itemId: currentItem.id,
                  iteration: completedIteration,
                });
              }
            }
            // プランニング周か（判断と重なった場合は 判断 → プランニング の順で消化）
            if (
              loop.planning &&
              completedIteration % loop.planning.everyN === 0
            ) {
              loop.pendingPlanning = true;
            }
            if (loop.intervalSec > 0) {
              loop.nextSendAt = Date.now() + loop.intervalSec * 1000;
            }
          }
        }
      }
    }

    // Codexレビューが必要な場合（auto-commitより先に実行）
    if (shouldCodexReview && this.aiSessionAdapter) {
      state.currentItemId = 'codex-review';
      await this.persistQueues();
      this.emitQueueUpdated(repositoryPath, provider, state);

      try {
        const session = await this.aiSessionAdapter.ensureSession(
          repositoryPath,
          provider
        );

        await this.sendSlashCommand(
          session.id,
          '/dokodemo-claude-tools:workflow-plan-codexreview',
          session.coldStart,
          { repositoryPath, provider, itemId: 'codex-review' }
        );
      } catch (error) {
        console.error('[PromptQueueManager] Codexレビューセッションエラー:', error);
        state.isProcessing = false;
        state.currentItemId = undefined;
        await this.persistQueues();
        await this.processNextItem(repositoryPath, provider);
      }
      return;
    }

    // 自動コミットが必要な場合
    if (shouldAutoCommit && this.aiSessionAdapter) {
      state.currentItemId = 'auto-commit';
      await this.persistQueues();
      this.emitQueueUpdated(repositoryPath, provider, state);

      try {
        const session = await this.aiSessionAdapter.ensureSession(
          repositoryPath,
          provider
        );

        // 既定は push しないコミット。push は明示的に有効化されたときだけ行う
        // （無人ループでは push が「公開行為」になるため、既定を安全側に置く）
        await this.sendSlashCommand(
          session.id,
          shouldAutoCommitPush
            ? '/dokodemo-claude-tools:commit-push'
            : '/dokodemo-claude-tools:commit',
          session.coldStart,
          { repositoryPath, provider, itemId: 'auto-commit' }
        );
      } catch (error) {
        console.error('[PromptQueueManager] セッション確保エラー:', error);
        state.isProcessing = false;
        state.currentItemId = undefined;
        await this.persistQueues();
        await this.processNextItem(repositoryPath, provider);
      }
      return;
    }

    // 処理中フラグをクリア
    state.isProcessing = false;
    state.currentItemId = undefined;

    await this.persistQueues();
    this.emitQueueUpdated(repositoryPath, provider, state);

    // 次のアイテムを処理
    await this.processNextItem(repositoryPath, provider);
  }

  /**
   * リポジトリのキューをクリーンアップ
   */
  async cleanupRepository(repositoryPath: string): Promise<void> {
    const keysToDelete: string[] = [];

    for (const [key, state] of this.queues.entries()) {
      if (state.repositoryPath === repositoryPath) {
        keysToDelete.push(key);
      }
    }

    for (const key of keysToDelete) {
      const timer = this.loopTimers.get(key);
      if (timer) {
        clearTimeout(timer);
        this.loopTimers.delete(key);
      }
      const controller = this.loopJudgeAborts.get(key);
      if (controller) {
        controller.abort();
        this.loopJudgeAborts.delete(key);
      }
      this.sendGenerations.delete(key);
      this.queues.delete(key);
    }

    await this.persistQueues();
  }

  /**
   * シャットダウン
   */
  async shutdown(): Promise<void> {
    for (const timer of this.loopTimers.values()) {
      clearTimeout(timer);
    }
    this.loopTimers.clear();
    for (const timer of this.sendGateTimers.values()) {
      clearTimeout(timer);
    }
    this.sendGateTimers.clear();
    for (const controller of this.loopJudgeAborts.values()) {
      controller.abort();
    }
    this.loopJudgeAborts.clear();
    this.sendGenerations.clear();

    await this.persistQueues();
    this.queues.clear();
    this.removeAllListeners();
  }

  /**
   * 直近ウィンドウの PTY 出力に「実行中らしさ」の目印があるかを判定する。
   * UserPromptSubmit hook が来ていないのに実は実行が始まっている
   * （hook の取りこぼし・遅延）ケースを検出し、実行中セッションへの
   * 再打鍵（誤送信）を防ぐために使う。
   */
  private hasRecentOutputActivity(
    repositoryPath: string,
    provider: AiProvider
  ): boolean {
    const delta =
      this.aiSessionAdapter?.getPrimaryOutputSince(
        repositoryPath,
        provider,
        Date.now() - SEND_WATCHDOG_AFTER_SEND_MS
      ) ?? '';
    const lower = delta.toLowerCase();
    return OUTPUT_ACTIVITY_MARKERS.some((m) => lower.includes(m));
  }

  /**
   * 実行ステータス（hook 由来）で running、かつ PTY 出力が実際に動いているか。
   * running でも STATUS_DESYNC_SILENCE_MS 出力が静止していれば stale
   * （Stop の取りこぼし・順序レースの残骸）とみなして false を返す。
   */
  private isPrimaryActuallyBusy(
    repositoryPath: string,
    provider: AiProvider
  ): boolean {
    if (!this.aiSessionAdapter) return false;
    if (!this.aiSessionAdapter.isPrimaryAiBusy(repositoryPath, provider)) {
      return false;
    }
    const recentOutput = this.aiSessionAdapter.getPrimaryOutputSince(
      repositoryPath,
      provider,
      Date.now() - STATUS_DESYNC_SILENCE_MS
    );
    return recentOutput.trim().length > 0;
  }

  /**
   * 送信前アイドルゲート: プライマリ CLI がプロンプト送信を受けられる状態か。
   * 実行中に打鍵すると CLI 内部キューへの滞留（1 周先行ズレ）が起きるため、
   * 実行中マーカー・実行ステータスのどちらかが実行中を示す間は送信しない。
   */
  private isPrimarySessionIdle(
    repositoryPath: string,
    provider: AiProvider
  ): boolean {
    return (
      !this.hasRecentOutputActivity(repositoryPath, provider) &&
      !this.isPrimaryActuallyBusy(repositoryPath, provider)
    );
  }

  /**
   * アイドルゲートで送信を見送った後の再チェックを予約する。
   * 既に予約済みなら何もしない（Stop hook 由来の processNextItem と重複してもよい）。
   */
  private scheduleSendGateRetry(
    repositoryPath: string,
    provider: AiProvider
  ): void {
    const key = this.getQueueKey(repositoryPath, provider);
    if (this.sendGateTimers.has(key)) return;
    const timer = setTimeout(() => {
      this.sendGateTimers.delete(key);
      void this.processNextItem(repositoryPath, provider);
    }, SEND_GATE_RETRY_MS);
    this.sendGateTimers.set(key, timer);
  }

  /**
   * 送信完了（最終 Enter）後 SEND_WATCHDOG_AFTER_SEND_MS 以内に UserPromptSubmit
   * hook が発火しないケース（本文スラッシュコマンド消化 / TUI ダイアログに飲まれ /
   * PTY write 失敗等）を検出し、段階的に自己回復を試みる:
   *   1. 今回の送信以降に running へ遷移していれば送信成功（Stop を待つ）。
   *      送信より前からの running は stale（順序レースの残骸）として無視する
   *   2. 実行中らしき出力を検知したら再送信せず監視継続（hook 取りこぼし疑い。
   *      SEND_ACTIVITY_WAIT_LIMIT 回まで）
   *   3. resendCount < SEND_RESEND_LIMIT: /model 再適用込みで送信全体をやり直す
   *      （入力欄クリア込みなので Enter 取りこぼし・本文残留のどちらも救える。
   *      空 Enter の再送はキュー済みメッセージの割り込み送信になるため行わない）
   *   4. 上限到達: currentItem を completed として次へ進める（ループアイテムは
   *      承認待ちに倒す）
   * Stop hook 経路や forceSendItem / cancelCurrentItem / removeFromQueue で先に
   * 状態が変わっていれば全部 no-op に倒す。
   * override は送信時の差し替え内容（プランニング等）。再送信で同じ内容を
   * 送り直すために引き回す。
   */
  private scheduleSendWatchdog(
    repositoryPath: string,
    provider: AiProvider,
    itemId: string,
    generation: number,
    override: { prompt?: string; model?: string; skipClear?: boolean } | undefined,
    sendStartedAt: number,
    resendCount = 0,
    activityWaits = 0
  ): void {
    setTimeout(async () => {
      const key = this.getQueueKey(repositoryPath, provider);
      // 世代が進んでいたらこの watchdog は過去の送信の見張り（stale）。
      // ループ再投入で同じ itemId のまま次の送信が始まった直後
      // （UserPromptSubmit 到達前）に誤爆するのを防ぐ。
      if (this.sendGenerations.get(key) !== generation) return;
      const state = this.queues.get(key);
      if (!state) return;
      if (state.currentItemId !== itemId) return;
      if (!state.isProcessing) return;

      // 今回の送信開始以降に UserPromptSubmit が発火していれば送信成功と判断して
      // 何もしない（Stop hook の到達を待つ）。running でも遷移時刻が送信開始より
      // 古い場合は、前のターンの残骸（Stop 取りこぼし・順序レース）なので
      // 成功とはみなさず、下の救済フローへ進む。
      const runningSince = this.aiSessionAdapter?.getPrimaryRunningSince(
        repositoryPath,
        provider
      );
      if (runningSince != null && runningSince >= sendStartedAt) return;

      const item = state.queue.find((i) => i.id === itemId);
      if (!item || item.status !== 'processing') return;

      // hook は来ていないが出力が動いている＝実は実行中の可能性が高い。
      // ここで再送信すると実行中のセッションへ別プロンプトを重ねてしまうため、
      // 監視だけ継続する（上限を超えたら hook 側の異常として下の失敗処理へ）。
      if (this.hasRecentOutputActivity(repositoryPath, provider)) {
        if (activityWaits < SEND_ACTIVITY_WAIT_LIMIT) {
          if (activityWaits === 0) {
            console.warn(
              `[PromptQueueManager] 送信ウォッチドッグ: ${itemId} は UserPromptSubmit 未達のまま実行中らしき出力を検知しました（hook の取りこぼし疑い）。再送信せず監視を続けます`
            );
          }
          this.scheduleSendWatchdog(
            repositoryPath,
            provider,
            itemId,
            generation,
            override,
            sendStartedAt,
            resendCount,
            activityWaits + 1
          );
          return;
        }
      } else if (resendCount < SEND_RESEND_LIMIT) {
        // Enter 再送で救えなかった＝本文ごと取りこぼされた可能性が高い。
        // /model の適用キャッシュを無効化して（取りこぼしがモデル未適用を
        // 疑わせるため）、送信全体をやり直す。
        const session = this.aiSessionAdapter?.getSession(
          repositoryPath,
          provider
        );
        if (session) {
          console.warn(
            `[PromptQueueManager] 送信ウォッチドッグ: ${itemId} の送信全体をやり直します（${resendCount + 1}/${SEND_RESEND_LIMIT}回目）`
          );
          this.invalidateCurrentModel(repositoryPath, provider);
          const newGeneration = this.bumpSendGeneration(
            repositoryPath,
            provider
          );
          const newSendStartedAt = Date.now();
          try {
            await this.sendItemCommands(session.id, item, false, override);
            this.scheduleSendWatchdog(
              repositoryPath,
              provider,
              itemId,
              newGeneration,
              override,
              newSendStartedAt,
              resendCount + 1,
              0
            );
            return;
          } catch (error) {
            console.error(
              '[PromptQueueManager] 送信ウォッチドッグ: 再送信に失敗しました:',
              error
            );
            // 下の失敗処理へフォールスルー
          }
        }
      }

      // ループアイテムを completed で終わらせると再投入経路が無く黙って死ぬため、
      // 安全側として承認待ちの pending に戻して停止する（フック未達や送信取り
      // こぼしの疑いがある状況で、自動再送を続けるのは危険）。
      if (item.loop) {
        console.warn(
          `[PromptQueueManager] 送信ウォッチドッグ: ループアイテム ${itemId} の UserPromptSubmit を確認できなかったため承認待ちに倒します`
        );
        item.status = 'pending';
        item.loop.awaitingUserApproval = true;
        // プランニングターンの送信に失敗していた場合は、承認後に再度
        // プランニングターンから再開できるよう予約を立て直す
        if (item.loop.planningActive) {
          item.loop.planningActive = false;
          item.loop.pendingPlanning = true;
        }
        // 指示反映ターンの送信失敗時は feedback が残っているため、
        // フラグだけ倒せば承認後に反映ターンから再開される
        item.loop.feedbackActive = undefined;
        item.loop.lastJudgeReason =
          activityWaits >= SEND_ACTIVITY_WAIT_LIMIT
            ? '⚠ プロンプト受付（UserPromptSubmit hook）が届かないまま実行中らしき出力が続いています。フックが別インスタンスに向いていないか設定を確認してください。'
            : `⚠ 送信後にプロンプト受付（UserPromptSubmit hook）を確認できませんでした（自動再送 ${resendCount} 回も未達）。フック設定や送信の取りこぼしを確認してください。`;
        state.isProcessing = false;
        state.currentItemId = undefined;
        await this.persistQueues();

        this.emit('loop-approval-required', {
          repositoryPath,
          provider,
          itemId,
          iteration: item.loop.iteration - 1,
        });
        this.emitQueueUpdated(repositoryPath, provider, state);
        return;
      }

      console.warn(
        `[PromptQueueManager] 送信ウォッチドッグ: ${itemId} は UserPromptSubmit を引き起こさなかったため completed として次へ進めます`
      );
      item.status = 'completed';
      state.isProcessing = false;
      state.currentItemId = undefined;
      await this.persistQueues();

      this.emit('prompt-queue-processing-completed', {
        repositoryPath,
        provider,
        itemId,
        success: true,
      });
      this.emitQueueUpdated(repositoryPath, provider, state);

      await this.processNextItem(repositoryPath, provider);
    }, SEND_WATCHDOG_AFTER_SEND_MS);
  }

  /**
   * PTY 書き込み失敗を即時に検出した際の状態巻き戻し。
   * watchdog の completed パスと対になり、こちらは failed として倒す。
   */
  private async handleSendFailure(
    repositoryPath: string,
    provider: AiProvider,
    itemId: string
  ): Promise<void> {
    const state = this.queues.get(this.getQueueKey(repositoryPath, provider));
    if (!state || state.currentItemId !== itemId) return;
    const item = state.queue.find((i) => i.id === itemId);
    if (!item || item.status !== 'processing') return;

    console.warn(
      `[PromptQueueManager] PTY 書き込みに失敗したため ${itemId} を failed に倒します`
    );
    item.status = 'failed';
    state.isProcessing = false;
    state.currentItemId = undefined;
    await this.persistQueues();

    this.emit('prompt-queue-processing-completed', {
      repositoryPath,
      provider,
      itemId,
      success: false,
    });
    this.emitQueueUpdated(repositoryPath, provider, state);

    await this.processNextItem(repositoryPath, provider);
  }

  /**
   * 次のキューアイテムを処理
   */
  private async processNextItem(
    repositoryPath: string,
    provider: AiProvider
  ): Promise<void> {
    if (!this.aiSessionAdapter) {
      console.error(
        '[PromptQueueManager] AIセッションアダプターが設定されていません'
      );
      return;
    }

    const state = this.getOrCreateQueueState(repositoryPath, provider);

    const pendingItems = state.queue.filter(
      (item) => item.status === 'pending'
    );
    if (pendingItems.length === 0) {
      return;
    }

    if (state.isProcessing || state.isPaused) {
      return;
    }

    const item = pendingItems[0];

    // ループアイテムの送信前ゲート
    // a. 承認待ち: 何もしない（ユーザーの継続 or 停止を待つ）
    // b. AI 判断が必要: startLoopJudge に委譲（実装は Step 6）
    // c. インターバル待機中: タイマーを予約（Step 2 で scheduleLoopTimer）
    // d. 通常送信へ
    if (item.loop) {
      if (item.loop.awaitingUserApproval) {
        return;
      }
      if (item.loop.pendingJudge) {
        this.startLoopJudge(item, state);
        return;
      }
      if (item.loop.nextSendAt && item.loop.nextSendAt > Date.now()) {
        this.scheduleLoopTimer(
          repositoryPath,
          provider,
          item.loop.nextSendAt - Date.now()
        );
        return;
      }
      item.loop.nextSendAt = undefined;
    }

    // 送信前アイドルゲート: CLI が実行中（別ターン走行中・手動操作中など）に
    // 打鍵すると、プロンプトが CLI 内部キューに滞留して周回の対応関係が壊れる。
    // アイドルを確認できるまで送信しない。実行中ターンの Stop hook が
    // processNextItem を再トリガするのが本線で、タイマーは取りこぼしの保険。
    if (!this.isPrimarySessionIdle(repositoryPath, provider)) {
      console.warn(
        `[PromptQueueManager] CLI が実行中のため ${item.id} の送信を見送ります（アイドル確認後に再開）`
      );
      this.scheduleSendGateRetry(repositoryPath, provider);
      return;
    }

    if (item.loop) {
      // e. 空回り検知: 自動コミット有効なループなら、周回ごとにコミットが
      //    増えているはず。増えないまま LOOP_IDLE_ROUND_LIMIT 周続いたら、
      //    同じところで足踏みしているとみなして承認待ちに倒す。
      //    計画ターン・指示反映ターンは実装を伴わないため計測から除外する。
      if (
        item.isAutoCommit &&
        !item.loop.pendingPlanning &&
        !item.loop.feedback?.length
      ) {
        const head = this.getHeadCommit(repositoryPath);
        if (head) {
          if (item.loop.lastHeadCommit === head) {
            item.loop.idleRounds = (item.loop.idleRounds ?? 0) + 1;
          } else {
            item.loop.idleRounds = 0;
            item.loop.lastHeadCommit = head;
          }

          if ((item.loop.idleRounds ?? 0) >= LOOP_IDLE_ROUND_LIMIT) {
            item.loop.awaitingUserApproval = true;
            item.loop.lastJudgeReason = `⚠ ${LOOP_IDLE_ROUND_LIMIT}周連続でコミットが増えていません。同じところで足踏みしている可能性があるため停止しました。`;
            await this.persistQueues();
            this.emit('loop-approval-required', {
              repositoryPath,
              provider,
              itemId: item.id,
              iteration: item.loop.iteration,
            });
            this.emitQueueUpdated(repositoryPath, provider, state);
            return;
          }
        }
      }
    }

    // ループアイテムの送信内容の差し替え
    // - 指示反映ターン: 溜まった指示をまとめて反映プロンプトとして送る（最優先）
    // - プランニングターン: 計画プロンプト + プランニング用モデルで 1 ターン送る
    // - モデル復帰: プランニング直後の通常送信で /model default に戻す
    //   （item.model があれば通常送信の /model で戻るため override 不要）
    let sendOverride:
      | { prompt?: string; model?: string; skipClear?: boolean }
      | undefined;
    if (item.loop) {
      if (item.loop.feedback?.length) {
        item.loop.feedbackActive = item.loop.feedback.length;
        sendOverride = {
          prompt: this.buildFeedbackPrompt(item.loop.feedback),
          // 直前の作業ターンの文脈を踏まえて反映するため /clear は挟まない
          skipClear: true,
        };
      } else if (item.loop.pendingPlanning && item.loop.planning) {
        item.loop.pendingPlanning = false;
        item.loop.planningActive = true;
        sendOverride = {
          prompt: item.loop.planning.prompt,
          model: item.loop.planning.model,
          // 直前の作業ターンの文脈を踏まえて計画するため /clear は挟まない
          skipClear: true,
        };
      } else if (item.loop.modelRestorePending) {
        item.loop.modelRestorePending = false;
        if (!item.model) {
          sendOverride = { model: 'default' };
        }
      }
    }

    item.status = 'processing';
    state.isProcessing = true;
    state.currentItemId = item.id;

    await this.persistQueues();

    this.emit('prompt-queue-processing-started', {
      repositoryPath,
      provider,
      itemId: item.id,
    });

    this.emitQueueUpdated(repositoryPath, provider, state);

    try {
      const session = await this.aiSessionAdapter.ensureSession(
        repositoryPath,
        provider
      );

      // CLI が入力受付可能になるまで待ってから送信する。
      // ensure-primary-instance などで先に PTY を spawn 済みの場合
      // coldStart=false が返るが、CLI 起動完了前に prompt を打ち込むと
      // 取りこぼされるため、ここでも必ず ready を待機する
      // （waitForSessionReady() は session.readyPromise を await するだけで、
      // 既に ready 済みなら即座に resolve するためコストは無い）。
      await this.aiSessionAdapter.waitForSessionReady(session.id);

      // コマンド送信処理
      const generation = this.bumpSendGeneration(repositoryPath, provider);
      const sendStartedAt = Date.now();
      await this.sendItemCommands(
        session.id,
        item,
        session.coldStart,
        sendOverride
      );

      // 送信完了から SEND_WATCHDOG_AFTER_SEND_MS 後に「UserPromptSubmit が
      // 来なかった」ケース（本文がスラッシュコマンドで消化された等）を
      // 検出して自動的にキューを進める。Stop hook 経路で先に進んでいれば no-op。
      this.scheduleSendWatchdog(
        repositoryPath,
        provider,
        item.id,
        generation,
        sendOverride,
        sendStartedAt
      );
    } catch (error) {
      console.error('[PromptQueueManager] セッション確保エラー:', error);
      item.status = 'failed';
      state.isProcessing = false;
      state.currentItemId = undefined;
      await this.persistQueues();

      this.emit('prompt-queue-processing-completed', {
        repositoryPath,
        provider,
        itemId: item.id,
        success: false,
      });

      this.emitQueueUpdated(repositoryPath, provider, state);

      await this.processNextItem(repositoryPath, provider);
    }
  }

  /**
   * スラッシュコマンド（/commit-push 等）を送信する。
   * コールドスタート時は CLI 起動完了を待ってから送り、Enter 取りこぼし対策で
   * Enter を 1 回追加送信する。
   * 最初の write が PTY 失敗で false を返した場合は、watchdog を待たず即時で
   * failed に倒す（itemId にはセンチネル 'auto-commit' / 'codex-review' を渡す）。
   */
  private async sendSlashCommand(
    sessionId: string,
    command: string,
    coldStart: boolean,
    failureContext?: {
      repositoryPath: string;
      provider: AiProvider;
      itemId: string;
    }
  ): Promise<void> {
    if (!this.aiSessionAdapter) return;

    if (coldStart) {
      await this.aiSessionAdapter.waitForSessionReady(sessionId);
    }

    const ok = this.aiSessionAdapter.sendCommand(sessionId, command);
    if (ok === false && failureContext) {
      void this.handleSendFailure(
        failureContext.repositoryPath,
        failureContext.provider,
        failureContext.itemId
      );
      return;
    }
    await this.sleep(300);
    this.aiSessionAdapter?.sendCommand(sessionId, '\r');
    // 再描画との競合による Enter 取りこぼし対策で 1 回だけ再送する
    await this.sleep(ENTER_RETRY_MS);
    this.aiSessionAdapter?.sendCommand(sessionId, '\r');
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * echo 確認用の正規化。TUI の折り返し・入力欄の罫線・空白を除き、
   * 「打鍵した文字列そのもの」が出力に現れたかだけを比較できるようにする。
   */
  private normalizeForEchoCheck(s: string): string {
    return s.replace(/[\s│┃]/g, '');
  }

  /**
   * 本文を打鍵し、入力欄への到達を「打鍵時刻以降の出力デルタ」で確認する。
   * 到達を確認できなければ間隔を漸増させながら本文を打ち直す（Enter はまだ
   * 送らない）。/model 直後などに CLI が打鍵を破棄し続ける時間帯（十数秒）を
   * またいで粘るため、回数ではなく時間予算（ECHO_RETYPE_BUDGET_MS）で粘る。
   * 打ち直しの前には入力欄をクリア（Ctrl+U）して、echo 確認の見落としで
   * 実は届いていた本文に重ねて打ってしまう二重連結を防ぐ。
   * 長文は CLI がペーストプレースホルダ（[Pasted text #N +M lines]）表示に
   * 置き換えることがあるため、それも到達とみなす。
   * 戻り値は PTY write が成功したか（false はセッション死亡）。時間予算まで
   * 到達を確認できなかった場合も true を返して Enter へ進む（最終防衛線は
   * 送信 watchdog）。
   */
  private async typeWithEchoCheck(
    sessionId: string,
    repositoryPath: string,
    provider: AiProvider,
    text: string
  ): Promise<boolean> {
    if (!this.aiSessionAdapter) return false;

    const normalized = this.normalizeForEchoCheck(text);
    const headNeedle = normalized.slice(0, ECHO_NEEDLE_LENGTH);
    const tailNeedle = normalized.slice(-ECHO_NEEDLE_LENGTH);

    const startedAt = Date.now();
    for (let attempt = 0; ; attempt++) {
      if (attempt > 0) {
        // 入力欄のクリア（Ctrl+U = 行頭まで削除）。空欄への送信は無害。
        // 複数行状態への保険で数回送る（破棄窓の中なら丸ごと無視されるだけ）。
        for (let i = 0; i < 3; i++) {
          this.aiSessionAdapter.sendCommand(sessionId, '\x15');
          await this.sleep(80);
        }
      }

      const typedAt = Date.now();
      const ok = this.aiSessionAdapter.sendCommand(sessionId, text);
      if (!ok) return false;

      // 後の試行ほど待ちを伸ばす（上限 ECHO_RETYPE_DELAY_SCALE_MAX 倍）
      const scale = Math.min(attempt + 1, ECHO_RETYPE_DELAY_SCALE_MAX);
      await this.sleep(ECHO_CHECK_FIRST_DELAY_MS * scale);

      // 目印が短すぎて照合の信頼性が無い場合は従来どおり時間待ちのみで進む
      if (headNeedle.length < 4) return true;

      let confirmed = false;
      for (let check = 0; check < 2 && !confirmed; check++) {
        if (check > 0) await this.sleep(ECHO_CHECK_RETRY_DELAY_MS * scale);
        const delta = this.normalizeForEchoCheck(
          this.aiSessionAdapter.getPrimaryOutputSince(
            repositoryPath,
            provider,
            typedAt
          )
        );
        confirmed =
          delta.includes(headNeedle) ||
          delta.includes(tailNeedle) ||
          delta.includes('Pastedtext');
      }
      if (confirmed) return true;

      if (Date.now() - startedAt >= ECHO_RETYPE_BUDGET_MS) break;
      console.warn(
        `[PromptQueueManager] 打鍵確認: 入力欄への到達を確認できないため本文を打ち直します（${attempt + 1}回目、経過 ${Math.round((Date.now() - startedAt) / 1000)}s）`
      );
    }
    console.warn(
      '[PromptQueueManager] 打鍵確認: 時間予算内に到達を確認できませんでした（watchdog に委ねて送信を続行します）'
    );
    return true;
  }

  /**
   * /clear・/model 等の前置きスラッシュコマンドを 1 つ実行する。
   * 打鍵確認（未達なら打ち直し）・Enter 取りこぼし対策の再送・実行直後の
   * TUI 再描画の静定待ちまで含む
   * （静定を待たずに次の入力を打ち込むと取りこぼされることがある）。
   */
  private async runPrefixSlashCommand(
    sessionId: string,
    repositoryPath: string,
    provider: AiProvider,
    command: string
  ): Promise<void> {
    await this.typeWithEchoCheck(sessionId, repositoryPath, provider, command);
    this.aiSessionAdapter?.sendCommand(sessionId, '\r');
    await this.sleep(ENTER_RETRY_MS);
    this.aiSessionAdapter?.sendCommand(sessionId, '\r');
    await this.sleep(SLASH_SETTLE_MS);
  }

  /**
   * アイテムのコマンドを送信。最終 Enter の送信まで完了してから resolve する
   * （呼び出し側はこの完了時点を起点に送信ウォッチドッグを仕掛ける）。
   * override はプランニングターン等でアイテム本来の prompt / model / clear 設定を
   * 差し替えて送るための一時指定（アイテム自体は変更しない）。
   */
  private async sendItemCommands(
    sessionId: string,
    item: PromptQueueItem,
    coldStart = false,
    override?: { prompt?: string; model?: string; skipClear?: boolean }
  ): Promise<void> {
    if (!this.aiSessionAdapter) return;

    const prompt = override?.prompt ?? item.prompt;
    const model = override?.model ?? item.model;
    const sendClearBefore = override?.skipClear ? false : item.sendClearBefore;
    const { repositoryPath, provider } = item;

    if (sendClearBefore) {
      await this.runPrefixSlashCommand(
        sessionId,
        repositoryPath,
        provider,
        '/clear'
      );
    }

    if (model) {
      const key = this.getQueueKey(repositoryPath, provider);
      // 冗長な /model のスキップ: 前回適用した値と同じなら送らない。
      // /model 実行直後の TUI 再描画は後続打鍵を飲む主要なリスク源のため、
      // モデルが実際に変わるターンだけ送って露出回数を減らす。
      // コールドスタート時は新規 CLI の状態が不明なので必ず送る。
      const alreadyApplied =
        !coldStart && this.currentModels.get(key) === model;
      this.currentModels.set(key, model);
      if (!alreadyApplied) {
        const modelValue = model === 'OpusPlan' ? 'opusplan' : model;
        await this.runPrefixSlashCommand(
          sessionId,
          repositoryPath,
          provider,
          `/model ${modelValue}`
        );
      }
    }

    // 打鍵確認込みで本文を打ち込む（Enter 前待ちの 500ms は確認処理が兼ねる）
    const ok = await this.typeWithEchoCheck(
      sessionId,
      repositoryPath,
      provider,
      prompt
    );
    if (!ok) {
      // PTY が死んでいる。watchdog を待たずに即時で失敗扱いにする
      void this.handleSendFailure(repositoryPath, provider, item.id);
      return;
    }
    this.aiSessionAdapter?.sendCommand(sessionId, '\r');
    // コールドスタート時は Enter 取りこぼし対策で 1 回だけ再送する
    if (coldStart) {
      await this.sleep(ENTER_RETRY_MS);
      this.aiSessionAdapter?.sendCommand(sessionId, '\r');
    }
  }

  /**
   * ループのインターバルタイマーを予約。
   * 既に予約されているタイマーは破棄してから setTimeout する。
   * 発火時に Map から削除して processNextItem を呼ぶ。
   */
  private scheduleLoopTimer(
    repositoryPath: string,
    provider: AiProvider,
    delayMs: number
  ): void {
    const key = this.getQueueKey(repositoryPath, provider);
    const existing = this.loopTimers.get(key);
    if (existing) {
      clearTimeout(existing);
    }
    const timer = setTimeout(() => {
      this.loopTimers.delete(key);
      void this.processNextItem(repositoryPath, provider);
    }, Math.max(0, delayMs));
    this.loopTimers.set(key, timer);
  }

  /**
   * ループアイテムの AI 判断を開始。
   * センチネル（currentItemId = 'loop-judge', isProcessing = true）で他の処理を抑止しつつ
   * LoopJudgeService に判定を委譲する。結果に応じて continue/end/フォールバックへ分岐。
   */
  private startLoopJudge(
    item: PromptQueueItem,
    state: PromptQueueState
  ): void {
    if (!item.loop) return;
    const { repositoryPath, provider } = state;
    const key = this.getQueueKey(repositoryPath, provider);

    // センチネルを立てて他の処理を抑止
    state.isProcessing = true;
    state.currentItemId = 'loop-judge';
    this.emitQueueUpdated(repositoryPath, provider, state);

    const controller = new AbortController();
    this.loopJudgeAborts.set(key, controller);

    const outputTail =
      this.aiSessionAdapter?.getPrimaryOutputTail(repositoryPath, provider) ??
      '';

    void (async () => {
      try {
        const verdict = await judgeLoop(
          {
            cwd: repositoryPath,
            loopPrompt: item.prompt,
            judgeCriteria: item.loop!.judgeCriteria,
            iteration: item.loop!.iteration - 1,
            startedAtCommit: item.loop!.startedAtCommit,
            outputTail,
          },
          controller
        );

        this.loopJudgeAborts.delete(key);

        // 判定完了時にアイテムがまだキューにあるか確認
        const stillPresent = state.queue.includes(item);
        if (!stillPresent || !item.loop) {
          state.isProcessing = false;
          state.currentItemId = undefined;
          await this.persistQueues();
          this.emitQueueUpdated(repositoryPath, provider, state);
          void this.processNextItem(repositoryPath, provider);
          return;
        }

        item.loop.pendingJudge = false;
        item.loop.lastJudgeReason = verdict.reason;

        state.isProcessing = false;
        state.currentItemId = undefined;

        if (verdict.continue) {
          await this.persistQueues();
          this.emitQueueUpdated(repositoryPath, provider, state);
          void this.processNextItem(repositoryPath, provider);
        } else {
          // 終了: アイテム削除 + prompt-loop-ended emit
          const idx = state.queue.indexOf(item);
          if (idx !== -1) state.queue.splice(idx, 1);
          this.emit('prompt-loop-ended', {
            repositoryPath,
            provider,
            itemId: item.id,
            reason: verdict.reason,
            endedBy: 'ai-judge' as const,
          });
          await this.persistQueues();
          this.emitQueueUpdated(repositoryPath, provider, state);
          void this.processNextItem(repositoryPath, provider);
        }
      } catch (error) {
        this.loopJudgeAborts.delete(key);
        console.error('[PromptQueueManager] ループ判定エラー:', error);

        // 安全側フォールバック: 確認待ちに倒す
        if (item.loop) {
          item.loop.pendingJudge = false;
          item.loop.awaitingUserApproval = true;
          item.loop.lastJudgeReason =
            error instanceof Error
              ? `⚠ AI判断に失敗: ${error.message}`
              : '⚠ AI判断に失敗しました';
        }
        state.isProcessing = false;
        state.currentItemId = undefined;

        this.emit('loop-approval-required', {
          repositoryPath,
          provider,
          itemId: item.id,
          iteration: item.loop?.iteration ? item.loop.iteration - 1 : 0,
        });

        await this.persistQueues();
        this.emitQueueUpdated(repositoryPath, provider, state);
      }
    })();
  }

  /**
   * キュー更新イベントを発火
   */
  private emitQueueUpdated(
    repositoryPath: string,
    provider: AiProvider,
    state: PromptQueueState
  ): void {
    this.emit('prompt-queue-updated', {
      repositoryPath,
      provider,
      queue: state.queue,
      isProcessing: state.isProcessing,
      isPaused: state.isPaused,
      currentItemId: state.currentItemId,
    });
  }

  /**
   * キューを永続化
   */
  private async persistQueues(): Promise<void> {
    const states = Array.from(this.queues.values());
    const result = await this.persistenceService.save(
      PROMPT_QUEUES_FILE,
      states
    );

    if (!result.ok) {
      console.error('[PromptQueueManager] 永続化エラー:', result.error.message);
    }
  }

  /**
   * キューを復元
   */
  private async restoreQueues(): Promise<void> {
    const result =
      await this.persistenceService.load<PromptQueueState[]>(
        PROMPT_QUEUES_FILE
      );

    if (!result.ok) {
      console.error('[PromptQueueManager] 復元エラー:', result.error.message);
      return;
    }

    if (result.value === null) {
      return;
    }

    this.queues.clear();
    for (const state of result.value) {
      const key = this.getQueueKey(state.repositoryPath, state.provider);
      // 前回プロセスで processing のまま残った item は、Stop hook を取り逃した
      // 可能性があるので pending に巻き戻す。processing のまま放置されると
      // processNextItem の pending フィルタから永久に外れ、キューが詰まる。
      const restoredQueue = state.queue.map((item) => {
        const restored: PromptQueueItem =
          item.status === 'processing'
            ? { ...item, status: 'pending' as const }
            : { ...item };

        // ループアイテムの復元後処理:
        // - 過去の nextSendAt はクリア
        // - 再起動後の自動再開防止のため awaitingUserApproval = true を強制
        //   （pendingJudge は維持し、次の processNextItem で再判定）
        // - プランニングターン実行中に落ちていた場合は予約に戻して再実行
        // - 指示反映ターン実行中に落ちていた場合は feedback が残っているため、
        //   フラグだけ倒せば承認後に反映ターンから再実行される
        if (restored.loop) {
          restored.loop = {
            ...restored.loop,
            nextSendAt: undefined,
            awaitingUserApproval: true,
            planningActive: undefined,
            pendingPlanning:
              restored.loop.pendingPlanning || restored.loop.planningActive,
            feedbackActive: undefined,
          };
        }
        return restored;
      });

      // 判断中センチネル（currentItemId === 'loop-judge'）は復元時に必ずクリア。
      // 現状 restore では processing→pending 巻き戻し + isProcessing=false のため
      // どのみち currentItemId は undefined に倒す。
      this.queues.set(key, {
        ...state,
        queue: restoredQueue,
        isProcessing: false,
        currentItemId: undefined,
      });

      // カウンターの更新
      for (const item of state.queue) {
        const idParts = item.id.split('-');
        const idNumber = parseInt(idParts[1] || '0');
        if (idNumber > this.queueCounter) {
          this.queueCounter = idNumber;
        }
      }
    }

  }
}
