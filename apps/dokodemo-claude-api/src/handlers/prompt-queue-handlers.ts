import type { HandlerContext } from './types.js';
import { repositoryIdManager } from '../services/repository-id-manager.js';

/**
 * rid から repositoryPath を解決（失敗時 null）
 */
function tryResolvePath(rid: string): string | null {
  try {
    return repositoryIdManager.getPath(rid);
  } catch {
    return null;
  }
}

/**
 * プロンプトキュー関連の Socket.IO イベントハンドラー
 */
export function registerPromptQueueHandlers(ctx: HandlerContext): void {
  const { socket, processManager } = ctx;

  socket.on('add-to-prompt-queue', async (data) => {
    const {
      rid,
      provider,
      prompt,
      sendClearBefore,
      isAutoCommit,
      isCodexReview,
      model,
    } = data;
    const repositoryPath = tryResolvePath(rid);
    if (!repositoryPath) return;

    try {
      const item = await processManager.addToPromptQueue(
        repositoryPath,
        provider,
        prompt,
        sendClearBefore,
        isAutoCommit,
        model,
        isCodexReview
      );
      socket.emit('prompt-added-to-queue', {
        success: true,
        message: 'プロンプトをキューに追加しました',
        item,
      });
    } catch (error) {
      socket.emit('prompt-added-to-queue', {
        success: false,
        message: `キューへの追加に失敗しました: ${error}`,
      });
    }
  });

  socket.on('remove-from-prompt-queue', async (data) => {
    const { rid, provider, itemId } = data;
    const repositoryPath = tryResolvePath(rid);
    if (!repositoryPath) return;

    try {
      const success = await processManager.removeFromPromptQueue(
        repositoryPath,
        provider,
        itemId
      );
      socket.emit('prompt-removed-from-queue', {
        success,
        message: success ? 'キューから削除しました' : '処理中のアイテムは削除できません',
        itemId,
      });
    } catch (error) {
      socket.emit('prompt-removed-from-queue', {
        success: false,
        message: `削除に失敗しました: ${error}`,
        itemId,
      });
    }
  });

  socket.on('update-prompt-queue', async (data) => {
    const {
      rid,
      provider,
      itemId,
      prompt,
      sendClearBefore,
      isAutoCommit,
      isCodexReview,
      model,
    } = data;
    const repositoryPath = tryResolvePath(rid);
    if (!repositoryPath) return;

    try {
      const success = await processManager.updatePromptQueue(
        repositoryPath,
        provider,
        itemId,
        prompt,
        sendClearBefore,
        isAutoCommit,
        model,
        isCodexReview
      );
      socket.emit('prompt-updated-in-queue', {
        success,
        message: success ? 'キューを更新しました' : '処理中または完了済みのアイテムは更新できません',
        itemId,
      });
    } catch (error) {
      socket.emit('prompt-updated-in-queue', {
        success: false,
        message: `更新に失敗しました: ${error}`,
        itemId,
      });
    }
  });

  socket.on('get-prompt-queue', (data) => {
    const { rid, provider } = data;
    const repositoryPath = tryResolvePath(rid);
    if (!repositoryPath) return;

    try {
      const queueState = processManager.getPromptQueueState(
        repositoryPath,
        provider
      );
      socket.emit('prompt-queue-updated', {
        rid,
        provider,
        queue: queueState?.queue || [],
        isProcessing: queueState?.isProcessing || false,
        isPaused: queueState?.isPaused || false,
        currentItemId: queueState?.currentItemId,
      });
    } catch {
      // ignore
    }
  });

  socket.on('clear-prompt-queue', async (data) => {
    const { rid, provider } = data;
    const repositoryPath = tryResolvePath(rid);
    if (!repositoryPath) return;

    try {
      await processManager.clearPromptQueue(repositoryPath, provider);
      socket.emit('prompt-queue-updated', {
        rid,
        provider,
        queue: [],
        isProcessing: false,
        isPaused: false,
      });
    } catch {
      // ignore
    }
  });

  socket.on('pause-prompt-queue', async (data) => {
    const { rid, provider } = data;
    const repositoryPath = tryResolvePath(rid);
    if (!repositoryPath) return;
    try {
      await processManager.pausePromptQueue(repositoryPath, provider);
    } catch {
      // ignore
    }
  });

  socket.on('resume-prompt-queue', async (data) => {
    const { rid, provider } = data;
    const repositoryPath = tryResolvePath(rid);
    if (!repositoryPath) return;
    try {
      await processManager.resumePromptQueue(repositoryPath, provider);
    } catch {
      // ignore
    }
  });

  socket.on('reorder-prompt-queue', async (data) => {
    const { rid, provider, queue } = data;
    const repositoryPath = tryResolvePath(rid);
    if (!repositoryPath) return;
    try {
      await processManager.reorderPromptQueue(repositoryPath, provider, queue);
    } catch {
      // ignore
    }
  });

  socket.on('requeue-prompt-item', async (data) => {
    const { rid, provider, itemId } = data;
    const repositoryPath = tryResolvePath(rid);
    if (!repositoryPath) return;

    try {
      const success = await processManager.requeuePromptItem(
        repositoryPath,
        provider,
        itemId
      );
      socket.emit('prompt-requeued', {
        success,
        message: success ? 'キューに再追加しました' : '再キューできないステータスです',
        itemId,
      });
    } catch (error) {
      socket.emit('prompt-requeued', {
        success: false,
        message: `再キューに失敗しました: ${error}`,
        itemId,
      });
    }
  });

  socket.on('force-send-prompt-queue-item', async (data) => {
    const { rid, provider, itemId } = data;
    const repositoryPath = tryResolvePath(rid);
    if (!repositoryPath) return;

    try {
      const success = await processManager.forceSendPromptItem(
        repositoryPath,
        provider,
        itemId
      );
      socket.emit('prompt-force-sent', {
        success,
        message: success
          ? '強制送信を開始しました'
          : '強制送信できません（処理中のアイテムがあるか、待機中ではありません）',
        itemId,
      });
    } catch (error) {
      socket.emit('prompt-force-sent', {
        success: false,
        message: `強制送信に失敗しました: ${error}`,
        itemId,
      });
    }
  });

  socket.on('reset-prompt-queue', async (data) => {
    const { rid, provider } = data;
    const repositoryPath = tryResolvePath(rid);
    if (!repositoryPath) return;

    try {
      await processManager.resetPromptQueue(repositoryPath, provider);
      socket.emit('prompt-queue-reset', {
        success: true,
        message: 'キューをリセットしました',
      });
    } catch (error) {
      socket.emit('prompt-queue-reset', {
        success: false,
        message: `リセットに失敗しました: ${error}`,
      });
    }
  });

  socket.on('cancel-current-queue-item', async (data) => {
    const { rid, provider } = data;
    const repositoryPath = tryResolvePath(rid);
    if (!repositoryPath) return;

    try {
      const success = await processManager.cancelCurrentQueueItem(
        repositoryPath,
        provider
      );
      socket.emit('queue-item-cancelled', {
        success,
        message: success
          ? '処理中のアイテムをキャンセルしました'
          : '処理中のアイテムがありません',
      });
    } catch (error) {
      socket.emit('queue-item-cancelled', {
        success: false,
        message: `キャンセルに失敗しました: ${error}`,
      });
    }
  });
}
