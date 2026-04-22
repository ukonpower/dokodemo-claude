import type { HandlerContext } from './types.js';
import { resolveRepositoryPath } from '../utils/resolve-repository-path.js';
import { repositoryIdManager } from '../services/repository-id-manager.js';

/**
 * プロンプトキュー関連のSocket.IOイベントハンドラーを登録
 */
export function registerPromptQueueHandlers(ctx: HandlerContext): void {
  const { socket, processManager } = ctx;

  // プロンプトをキューに追加
  socket.on('add-to-prompt-queue', async (data) => {
    const {
      rid,
      repositoryPath: rawPath,
      provider,
      prompt,
      sendClearBefore,
      isAutoCommit,
      isCodexReview,
      model,
    } = data;
    const repositoryPath = resolveRepositoryPath({
      rid,
      repositoryPath: rawPath,
    });
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

  // キューからアイテムを削除
  socket.on('remove-from-prompt-queue', async (data) => {
    const { rid, repositoryPath: rawPath, provider, itemId } = data;
    const repositoryPath = resolveRepositoryPath({
      rid,
      repositoryPath: rawPath,
    });
    if (!repositoryPath) return;

    try {
      const success = await processManager.removeFromPromptQueue(
        repositoryPath,
        provider,
        itemId
      );
      if (success) {
        socket.emit('prompt-removed-from-queue', {
          success: true,
          message: 'キューから削除しました',
          itemId,
        });
      } else {
        socket.emit('prompt-removed-from-queue', {
          success: false,
          message: '処理中のアイテムは削除できません',
          itemId,
        });
      }
    } catch (error) {
      socket.emit('prompt-removed-from-queue', {
        success: false,
        message: `削除に失敗しました: ${error}`,
        itemId,
      });
    }
  });

  // キューアイテムを更新
  socket.on('update-prompt-queue', async (data) => {
    const {
      rid,
      repositoryPath: rawPath,
      provider,
      itemId,
      prompt,
      sendClearBefore,
      isAutoCommit,
      isCodexReview,
      model,
    } = data;
    const repositoryPath = resolveRepositoryPath({
      rid,
      repositoryPath: rawPath,
    });
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
      if (success) {
        socket.emit('prompt-updated-in-queue', {
          success: true,
          message: 'キューを更新しました',
          itemId,
        });
      } else {
        socket.emit('prompt-updated-in-queue', {
          success: false,
          message: '処理中または完了済みのアイテムは更新できません',
          itemId,
        });
      }
    } catch (error) {
      socket.emit('prompt-updated-in-queue', {
        success: false,
        message: `更新に失敗しました: ${error}`,
        itemId,
      });
    }
  });

  // プロンプトキューを取得
  socket.on('get-prompt-queue', async (data) => {
    const { rid, repositoryPath: rawPath, provider } = data;
    const repositoryPath = resolveRepositoryPath({
      rid,
      repositoryPath: rawPath,
    });
    if (!repositoryPath) return;
    const resolvedRid = repositoryIdManager.tryGetId(repositoryPath);

    try {
      const queueState = processManager.getPromptQueueState(
        repositoryPath,
        provider
      );
      socket.emit('prompt-queue-updated', {
        rid: resolvedRid,
        provider,
        queue: queueState?.queue || [],
        isProcessing: queueState?.isProcessing || false,
        isPaused: queueState?.isPaused || false,
        currentItemId: queueState?.currentItemId,
      });
    } catch {
      // Failed to get prompt queue
    }
  });

  // プロンプトキューをクリア
  socket.on('clear-prompt-queue', async (data) => {
    const { rid, repositoryPath: rawPath, provider } = data;
    const repositoryPath = resolveRepositoryPath({
      rid,
      repositoryPath: rawPath,
    });
    if (!repositoryPath) return;
    const resolvedRid = repositoryIdManager.tryGetId(repositoryPath);

    try {
      await processManager.clearPromptQueue(repositoryPath, provider);
      socket.emit('prompt-queue-updated', {
        rid: resolvedRid,
        provider,
        queue: [],
        isProcessing: false,
        isPaused: false,
      });
    } catch {
      // Failed to clear prompt queue
    }
  });

  // プロンプトキューを一時停止
  socket.on('pause-prompt-queue', async (data) => {
    const { rid, repositoryPath: rawPath, provider } = data;
    const repositoryPath = resolveRepositoryPath({
      rid,
      repositoryPath: rawPath,
    });
    if (!repositoryPath) return;

    try {
      await processManager.pausePromptQueue(repositoryPath, provider);
    } catch {
      // Failed to pause prompt queue
    }
  });

  // プロンプトキューを再開
  socket.on('resume-prompt-queue', async (data) => {
    const { rid, repositoryPath: rawPath, provider } = data;
    const repositoryPath = resolveRepositoryPath({
      rid,
      repositoryPath: rawPath,
    });
    if (!repositoryPath) return;

    try {
      await processManager.resumePromptQueue(repositoryPath, provider);
    } catch {
      // Failed to resume prompt queue
    }
  });

  // プロンプトキューを並び替え
  socket.on('reorder-prompt-queue', async (data) => {
    const { rid, repositoryPath: rawPath, provider, queue } = data;
    const repositoryPath = resolveRepositoryPath({
      rid,
      repositoryPath: rawPath,
    });
    if (!repositoryPath) return;

    try {
      await processManager.reorderPromptQueue(repositoryPath, provider, queue);
    } catch {
      // Failed to reorder prompt queue
    }
  });

  // 完了/失敗したキューアイテムを待機中に戻す
  socket.on('requeue-prompt-item', async (data) => {
    const { rid, repositoryPath: rawPath, provider, itemId } = data;
    const repositoryPath = resolveRepositoryPath({
      rid,
      repositoryPath: rawPath,
    });
    if (!repositoryPath) return;

    try {
      const success = await processManager.requeuePromptItem(
        repositoryPath,
        provider,
        itemId
      );
      if (success) {
        socket.emit('prompt-requeued', {
          success: true,
          message: 'キューに再追加しました',
          itemId,
        });
      } else {
        socket.emit('prompt-requeued', {
          success: false,
          message: '再キューできないステータスです',
          itemId,
        });
      }
    } catch (error) {
      socket.emit('prompt-requeued', {
        success: false,
        message: `再キューに失敗しました: ${error}`,
        itemId,
      });
    }
  });

  // キューアイテムを強制送信（順番を無視して即座に処理）
  socket.on('force-send-prompt-queue-item', async (data) => {
    const { rid, repositoryPath: rawPath, provider, itemId } = data;
    const repositoryPath = resolveRepositoryPath({
      rid,
      repositoryPath: rawPath,
    });
    if (!repositoryPath) return;

    try {
      const success = await processManager.forceSendPromptItem(
        repositoryPath,
        provider,
        itemId
      );
      if (success) {
        socket.emit('prompt-force-sent', {
          success: true,
          message: '強制送信を開始しました',
          itemId,
        });
      } else {
        socket.emit('prompt-force-sent', {
          success: false,
          message:
            '強制送信できません（処理中のアイテムがあるか、待機中ではありません）',
          itemId,
        });
      }
    } catch (error) {
      socket.emit('prompt-force-sent', {
        success: false,
        message: `強制送信に失敗しました: ${error}`,
        itemId,
      });
    }
  });

  // プロンプトキューをリセット（全停止して進行中のアイテムもpendingに戻す）
  socket.on('reset-prompt-queue', async (data) => {
    const { rid, repositoryPath: rawPath, provider } = data;
    const repositoryPath = resolveRepositoryPath({
      rid,
      repositoryPath: rawPath,
    });
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

  // 現在処理中のキューアイテムをキャンセルして未送信に戻す
  socket.on('cancel-current-queue-item', async (data) => {
    const { rid, repositoryPath: rawPath, provider } = data;
    const repositoryPath = resolveRepositoryPath({
      rid,
      repositoryPath: rawPath,
    });
    if (!repositoryPath) return;

    try {
      const success = await processManager.cancelCurrentQueueItem(
        repositoryPath,
        provider
      );
      if (success) {
        socket.emit('queue-item-cancelled', {
          success: true,
          message: '処理中のアイテムをキャンセルしました',
        });
      } else {
        socket.emit('queue-item-cancelled', {
          success: false,
          message: '処理中のアイテムがありません',
        });
      }
    } catch (error) {
      socket.emit('queue-item-cancelled', {
        success: false,
        message: `キャンセルに失敗しました: ${error}`,
      });
    }
  });
}
