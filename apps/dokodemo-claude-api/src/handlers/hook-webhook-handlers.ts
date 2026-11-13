/**
 * Webhook（AI の hook イベントを外へ知らせる送り先）関連ハンドラ
 * 送り先は全クライアント共通なので、変わったら一覧を全員に配る。
 */

import type { HandlerContext } from './types.js';

export function registerHookWebhookHandlers(ctx: HandlerContext): void {
  const { socket, io, processManager } = ctx;
  const manager = processManager.hookWebhookManager;

  socket.on('list-hook-webhooks', () => {
    socket.emit('hook-webhooks-list', { webhooks: manager.list() });
  });

  socket.on('add-hook-webhook', async (data) => {
    const result = await manager.add(data.url);
    if (result.success) {
      io.emit('hook-webhooks-list', { webhooks: manager.list() });
    }
    socket.emit('hook-webhook-saved', result);
  });

  socket.on('delete-hook-webhook', async (data) => {
    const result = await manager.delete(data.id);
    if (result.success) {
      io.emit('hook-webhooks-list', { webhooks: manager.list() });
    }
    socket.emit('hook-webhook-saved', result);
  });

  socket.on('test-hook-webhook', async (data) => {
    const result = await manager.sendTest(data.id);
    socket.emit('hook-webhook-tested', {
      id: data.id,
      success: result.success,
      message: result.message,
    });
  });
}
