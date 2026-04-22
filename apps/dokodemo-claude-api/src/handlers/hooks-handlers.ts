import type { HandlerContext } from './types.js';
import type { AiProvider } from '../types/index.js';
import { aiHooksService } from '../services/claude-hooks-service.js';

export function registerHooksHandlers(ctx: HandlerContext): void {
  const { socket } = ctx;

  socket.on('check-hooks-status', async (data: { port: number; provider: AiProvider }) => {
    try {
      const configured = await aiHooksService.isHooksConfigured(data.port, data.provider);
      socket.emit('hooks-status', {
        configured,
        port: data.port,
        provider: data.provider,
      });
    } catch (error) {
      console.error('hooks設定状況の確認に失敗:', error);
      socket.emit('hooks-status', {
        configured: false,
        port: data.port,
        provider: data.provider,
      });
    }
  });

  socket.on('add-dokodemo-hooks', async (data: { port: number; provider: AiProvider }) => {
    try {
      await aiHooksService.addHooks(data.port, data.provider);
      socket.emit('hooks-updated', {
        success: true,
        message: `${data.provider === 'claude' ? 'Claude Code' : 'Codex'} の hooks 設定を追加しました`,
        configured: true,
        provider: data.provider,
      });
    } catch (error) {
      console.error('hooks設定の追加に失敗:', error);
      socket.emit('hooks-updated', {
        success: false,
        message: error instanceof Error ? error.message : 'hooks 設定の追加に失敗しました',
        configured: false,
        provider: data.provider,
      });
    }
  });

  socket.on('remove-dokodemo-hooks', async (data: { port: number; provider: AiProvider }) => {
    try {
      await aiHooksService.removeHooks(data.port, data.provider);
      socket.emit('hooks-updated', {
        success: true,
        message: `${data.provider === 'claude' ? 'Claude Code' : 'Codex'} の hooks 設定を削除しました`,
        configured: false,
        provider: data.provider,
      });
    } catch (error) {
      console.error('hooks設定の削除に失敗:', error);
      socket.emit('hooks-updated', {
        success: false,
        message: error instanceof Error ? error.message : 'hooks 設定の削除に失敗しました',
        configured: true,
        provider: data.provider,
      });
    }
  });
}
