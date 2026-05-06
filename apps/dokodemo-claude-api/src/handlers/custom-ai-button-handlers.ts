/**
 * カスタム送信ボタン関連ハンドラ
 * 全クライアントに同じリストをブロードキャストし、表示時のフィルタは
 * クライアント側で（ボタンの scope と現在のリポジトリパスに従って）行う。
 */

import type { HandlerContext } from './types.js';

export function registerCustomAiButtonHandlers(ctx: HandlerContext): void {
  const { socket, io, processManager } = ctx;
  const mgr = processManager.customAiButtonManager;

  socket.on('list-custom-ai-buttons', () => {
    socket.emit('custom-ai-buttons-list', { buttons: mgr.list() });
  });

  socket.on('create-custom-ai-button', async (data) => {
    const result = await mgr.create(
      data.name,
      data.command,
      data.scope,
      data.repositoryPath
    );
    if (result.ok) {
      io.emit('custom-ai-buttons-list', { buttons: mgr.list() });
      socket.emit('custom-ai-button-saved', {
        success: true,
        message: `ボタン「${result.value.name}」を追加しました`,
        button: result.value,
      });
    } else {
      socket.emit('custom-ai-button-saved', {
        success: false,
        message: result.error.message,
      });
    }
  });

  socket.on('update-custom-ai-button', async (data) => {
    const result = await mgr.update(
      data.id,
      data.name,
      data.command,
      data.scope,
      data.repositoryPath
    );
    if (result.ok) {
      io.emit('custom-ai-buttons-list', { buttons: mgr.list() });
      socket.emit('custom-ai-button-saved', {
        success: true,
        message: `ボタン「${result.value.name}」を更新しました`,
        button: result.value,
      });
    } else {
      socket.emit('custom-ai-button-saved', {
        success: false,
        message: result.error.message,
      });
    }
  });

  socket.on('delete-custom-ai-button', async (data) => {
    const result = await mgr.delete(data.id);
    if (result.ok) {
      io.emit('custom-ai-buttons-list', { buttons: mgr.list() });
      socket.emit('custom-ai-button-deleted', {
        success: true,
        message: 'ボタンを削除しました',
        buttonId: data.id,
      });
    } else {
      socket.emit('custom-ai-button-deleted', {
        success: false,
        message: result.error.message,
        buttonId: data.id,
      });
    }
  });

  socket.on('reorder-custom-ai-buttons', async (data) => {
    const result = await mgr.reorder(data.orderedIds);
    if (result.ok) {
      io.emit('custom-ai-buttons-list', { buttons: mgr.list() });
    }
  });
}
