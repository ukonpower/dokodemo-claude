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
  AiProvider,
} from '../types/index.js';
import { PersistenceService } from '../services/persistence-service.js';
import { Result, Ok, Err } from '../utils/result.js';
import { QueueError } from '../utils/errors.js';
import { judgeLoop } from '../services/loop-judge-service.js';

const PROMPT_QUEUES_FILE = 'prompt-queues.json';

// コールドスタート（CLI 新規起動）時は起動完了を待ってからプロンプトを送るが、
// それでも TUI 入力ハンドラの初期化と Enter の到達が競合して取りこぼされる
// ことが稀にある。保険として Enter をこの間隔で 1 回追加送信する。
// 入力欄が空でも空 Enter は無害なため、二重送信のリスクはない。
const COLD_START_ENTER_RETRY_MS = 600;

// 送信から指定時間内に UserPromptSubmit hook が発火しなければ、CLI に届かなかった
// or 本文が TUI ダイアログ（スラッシュコマンド等）に飲まれたと判断し、currentItem を
// completed として次に進める。最長経路（/clear + /model + cold-start）の所要時間
// 約 4.1s に対して十分な grace を取った 6s。
const SEND_WATCHDOG_FROM_READY_MS = 6000;

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
   * プライマリセッションの出力末尾を取得（ループ AI 判断の入力に使う）。
   * 実装側で ANSI 除去と末尾行トリミングを行う。
   */
  getPrimaryOutputTail(repositoryPath: string, provider: AiProvider): string;
}

export class PromptQueueManager extends EventEmitter {
  private queues: Map<string, PromptQueueState> = new Map();
  private queueCounter = 0;

  private aiSessionAdapter: QueueAiSessionAdapter | null = null;

  // ループのインターバル待機用タイマー（キー = queueKey）
  private loopTimers: Map<string, NodeJS.Timeout> = new Map();

  // AI 判断の abort（キー = queueKey）
  private loopJudgeAborts: Map<string, AbortController> = new Map();

  // 送信世代（キー = queueKey）。送信ごとにインクリメントし、watchdog が自分の
  // 世代と照合する。ループアイテムは周回をまたいで同じ itemId を使い回すため、
  // itemId の一致だけでは前の周回の watchdog（stale）を弾けない。
  private sendGenerations: Map<string, number> = new Map();

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
      isCodexReview?: boolean;
      model?: string;
      loop?: {
        judge: 'ai' | 'user' | 'none';
        judgeEveryN: number;
        intervalSec: number;
      };
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
        isCodexReview: options?.isCodexReview,
        model: options?.model,
        loop,
      };

      state.queue.push(item);

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
      isCodexReview?: boolean;
      model?: string;
      // null: ループ解除 / 値あり: 設定 3 項目を差し替え（iteration 等の状態は維持）
      loop?: {
        judge: 'ai' | 'user' | 'none';
        judgeEveryN: number;
        intervalSec: number;
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
        // 既存ループの設定 3 項目のみ差し替え
        item.loop.judge = updates.loop.judge;
        item.loop.judgeEveryN = Math.max(
          1,
          Math.floor(updates.loop.judgeEveryN)
        );
        item.loop.intervalSec = Math.max(
          0,
          Math.floor(updates.loop.intervalSec)
        );
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

    await this.persistQueues();
    this.emitQueueUpdated(repositoryPath, provider, state);

    if (!state.isProcessing && !state.isPaused) {
      await this.processNextItem(repositoryPath, provider);
    }

    return Ok(undefined);
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

    // ループアイテムの場合: 承認待ち / 判断中は強制送信できない。
    // インターバル待機中はタイマーとカウントダウンをクリアして即送信へ
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
      await this.sendItemCommands(session.id, item, session.coldStart);

      // processNextItem と同じく送信ウォッチドッグを仕掛ける
      this.scheduleSendWatchdog(repositoryPath, provider, item.id, generation);
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
    let shouldCodexReview = false;
    if (state.currentItemId) {
      const currentItem = state.queue.find(
        (item) => item.id === state.currentItemId
      );
      if (currentItem) {
        currentItem.status = 'completed';
        shouldAutoCommit = currentItem.isAutoCommit || false;
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
          if (loop.intervalSec > 0) {
            loop.nextSendAt = Date.now() + loop.intervalSec * 1000;
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

        await this.sendSlashCommand(
          session.id,
          '/dokodemo-claude-tools:commit-push',
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
   * 送信後 SEND_WATCHDOG_FROM_READY_MS 以内に UserPromptSubmit hook が発火しない
   * ケース（本文スラッシュコマンド消化 / TUI ダイアログに飲まれ / PTY write 失敗等）
   * を検出して currentItem を completed として次へ進める。Stop hook 経路や
   * forceSendItem / cancelCurrentItem / removeFromQueue で先に状態が変わって
   * いれば全部 no-op に倒す。
   */
  private scheduleSendWatchdog(
    repositoryPath: string,
    provider: AiProvider,
    itemId: string,
    generation: number
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

      // UserPromptSubmit が発火していれば primary は running 状態。送信成功と
      // 判断して何もしない（Stop hook の到達を待つ）。
      const aiBusy =
        this.aiSessionAdapter?.isPrimaryAiBusy(repositoryPath, provider) ??
        false;
      if (aiBusy) return;

      const item = state.queue.find((i) => i.id === itemId);
      if (!item || item.status !== 'processing') return;

      // ループアイテムを completed で終わらせると再投入経路が無く黙って死ぬため、
      // 安全側として承認待ちの pending に戻して停止する（フック未達や送信取り
      // こぼしの疑いがある状況で、自動再送を続けるのは危険）。
      if (item.loop) {
        console.warn(
          `[PromptQueueManager] 送信ウォッチドッグ: ループアイテム ${itemId} の UserPromptSubmit を確認できなかったため承認待ちに倒します`
        );
        item.status = 'pending';
        item.loop.awaitingUserApproval = true;
        item.loop.lastJudgeReason =
          '⚠ 送信後にプロンプト受付（UserPromptSubmit hook）を確認できませんでした。フック設定や送信の取りこぼしを確認してください。';
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
    }, SEND_WATCHDOG_FROM_READY_MS);
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
      await this.sendItemCommands(session.id, item, session.coldStart);

      // 送信完了から SEND_WATCHDOG_FROM_READY_MS 後に「UserPromptSubmit が
      // 来なかった」ケース（本文がスラッシュコマンドで消化された等）を
      // 検出して自動的にキューを進める。Stop hook 経路で先に進んでいれば no-op。
      this.scheduleSendWatchdog(repositoryPath, provider, item.id, generation);
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
    setTimeout(() => {
      this.aiSessionAdapter?.sendCommand(sessionId, '\r');
      if (coldStart) {
        setTimeout(() => {
          this.aiSessionAdapter?.sendCommand(sessionId, '\r');
        }, COLD_START_ENTER_RETRY_MS);
      }
    }, 300);
  }

  /**
   * アイテムのコマンドを送信
   */
  private async sendItemCommands(
    sessionId: string,
    item: PromptQueueItem,
    coldStart = false
  ): Promise<void> {
    if (!this.aiSessionAdapter) return;

    const sendPromptWithEnter = (delay: number = 0) => {
      setTimeout(() => {
        const ok = this.aiSessionAdapter?.sendCommand(sessionId, item.prompt);
        if (ok === false) {
          // PTY が死んでいる。watchdog (6s) を待たずに即時で失敗扱いにする
          void this.handleSendFailure(
            item.repositoryPath,
            item.provider,
            item.id
          );
          return;
        }
        setTimeout(() => {
          this.aiSessionAdapter?.sendCommand(sessionId, '\r');
          // コールドスタート時は Enter 取りこぼし対策で 1 回だけ再送する
          if (coldStart) {
            setTimeout(() => {
              this.aiSessionAdapter?.sendCommand(sessionId, '\r');
            }, COLD_START_ENTER_RETRY_MS);
          }
        }, 500);
      }, delay);
    };

    // sendClearBeforeフラグがtrueの場合
    if (item.sendClearBefore) {
      this.aiSessionAdapter.sendCommand(sessionId, '/clear');

      setTimeout(() => {
        this.aiSessionAdapter?.sendCommand(sessionId, '\r');
      }, 500);

      if (item.model) {
        const modelValue = item.model === 'OpusPlan' ? 'opusplan' : item.model;
        setTimeout(() => {
          this.aiSessionAdapter?.sendCommand(sessionId, `/model ${modelValue}`);
          setTimeout(() => {
            this.aiSessionAdapter?.sendCommand(sessionId, '\r');
          }, 500);
        }, 1500);

        sendPromptWithEnter(3000);
      } else {
        sendPromptWithEnter(1500);
      }
    } else {
      // 通常のプロンプト送信
      if (item.model) {
        const modelValue = item.model === 'OpusPlan' ? 'opusplan' : item.model;
        this.aiSessionAdapter.sendCommand(sessionId, `/model ${modelValue}`);

        setTimeout(() => {
          this.aiSessionAdapter?.sendCommand(sessionId, '\r');
        }, 500);

        sendPromptWithEnter(1500);
      } else {
        // モデル指定も /clear も無い最短経路。コールドスタート時の Enter
        // 取りこぼし対策も含めるため sendPromptWithEnter に集約する
        sendPromptWithEnter(0);
      }
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
        if (restored.loop) {
          restored.loop = {
            ...restored.loop,
            nextSendAt: undefined,
            awaitingUserApproval: true,
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
