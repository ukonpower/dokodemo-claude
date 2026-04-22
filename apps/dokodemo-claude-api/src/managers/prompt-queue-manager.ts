/**
 * プロンプトキュー管理マネージャー
 * AIへのプロンプト送信キューの管理を担当
 */

import { EventEmitter } from 'events';
import type {
  PromptQueueItem,
  PromptQueueState,
  AiProvider,
} from '../types/index.js';
import { PersistenceService } from '../services/persistence-service.js';
import { Result, Ok, Err } from '../utils/result.js';
import { QueueError } from '../utils/errors.js';

const PROMPT_QUEUES_FILE = 'prompt-queues.json';

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
   */
  sendCommand(sessionId: string, command: string): void;

  /**
   * セッションを確保（存在しなければ作成）
   */
  ensureSession(
    repositoryPath: string,
    provider: AiProvider
  ): Promise<{ id: string; repositoryPath: string; provider: AiProvider }>;

  /**
   * セッションの状態を取得
   */
  getSessionStatus(sessionId: string): { isActive: boolean } | null;
}

export class PromptQueueManager extends EventEmitter {
  private queues: Map<string, PromptQueueState> = new Map();
  private queueCounter = 0;

  private aiSessionAdapter: QueueAiSessionAdapter | null = null;

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
    }
  ): Promise<Result<PromptQueueItem, QueueError>> {
    try {
      const state = this.getOrCreateQueueState(repositoryPath, provider);
      const item: PromptQueueItem = {
        id: `prompt-${++this.queueCounter}-${Date.now()}`,
        prompt,
        repositoryPath,
        provider,
        createdAt: Date.now(),
        status: 'pending',
        sendClearBefore: options?.sendClearBefore,
        isAutoCommit: options?.isAutoCommit,
        isCodexReview: options?.isCodexReview,
        model: options?.model,
      };

      state.queue.push(item);

      await this.persistQueues();

      // キュー更新イベントを発火
      this.emitQueueUpdated(repositoryPath, provider, state);

      // 処理中でない場合は即座に処理開始
      if (!state.isProcessing && !state.isPaused) {
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

    await this.persistQueues();
    this.emitQueueUpdated(repositoryPath, provider, state);

    return Ok(true);
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

      // コマンド送信処理
      await this.sendItemCommands(session.id, item);
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

        this.aiSessionAdapter.sendCommand(
          session.id,
          '/dokodemo-claude-tools:workflow-plan-codexreview'
        );
        setTimeout(() => {
          this.aiSessionAdapter?.sendCommand(session.id, '\r');
        }, 300);
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

        this.aiSessionAdapter.sendCommand(
          session.id,
          '/dokodemo-claude-tools:commit-push'
        );
        setTimeout(() => {
          this.aiSessionAdapter?.sendCommand(session.id, '\r');
        }, 300);
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
      this.queues.delete(key);
    }

    await this.persistQueues();
  }

  /**
   * シャットダウン
   */
  async shutdown(): Promise<void> {
    await this.persistQueues();
    this.queues.clear();
    this.removeAllListeners();
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
    item.status = 'processing';
    state.isProcessing = true;
    state.currentItemId = item.id;

    await this.persistQueues();

    this.emit('prompt-queue-processing-started', {
      repositoryPath,
      provider,
      itemId: item.id,
    });

    try {
      const session = await this.aiSessionAdapter.ensureSession(
        repositoryPath,
        provider
      );

      // コマンド送信処理
      await this.sendItemCommands(session.id, item);
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

      await this.processNextItem(repositoryPath, provider);
    }
  }

  /**
   * アイテムのコマンドを送信
   */
  private async sendItemCommands(
    sessionId: string,
    item: PromptQueueItem
  ): Promise<void> {
    if (!this.aiSessionAdapter) return;

    const sendPromptWithEnter = (delay: number = 0) => {
      setTimeout(() => {
        this.aiSessionAdapter?.sendCommand(sessionId, item.prompt);
        setTimeout(() => {
          this.aiSessionAdapter?.sendCommand(sessionId, '\r');
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
        this.aiSessionAdapter.sendCommand(sessionId, item.prompt);

        setTimeout(() => {
          this.aiSessionAdapter?.sendCommand(sessionId, '\r');
        }, 500);
      }
    }
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
      // 復元時は処理中状態をリセット
      this.queues.set(key, {
        ...state,
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
