import type { HandlerContext } from './types.js';
import { pluginManagerService } from '../services/plugin-manager-service.js';

export function registerPluginHandlers(
  ctx: HandlerContext,
  projectRoot: string
): void {
  const { socket } = ctx;

  socket.on('check-plugin-status', async () => {
    try {
      const installed = await pluginManagerService.isInstalled();
      socket.emit('plugin-status', { installed });
    } catch (error) {
      console.error('プラグイン状態の確認に失敗:', error);
      socket.emit('plugin-status', { installed: false });
    }
  });

  socket.on('install-plugin', async () => {
    try {
      await pluginManagerService.install(projectRoot);
      socket.emit('plugin-updated', {
        success: true,
        message: 'dokodemo-claude-tools をインストールしました',
        installed: true,
      });
    } catch (error) {
      console.error('プラグインのインストールに失敗:', error);
      socket.emit('plugin-updated', {
        success: false,
        message:
          error instanceof Error
            ? error.message
            : 'プラグインのインストールに失敗しました',
        installed: false,
      });
    }
  });

  socket.on('uninstall-plugin', async () => {
    try {
      await pluginManagerService.uninstall();
      socket.emit('plugin-updated', {
        success: true,
        message: 'dokodemo-claude-tools をアンインストールしました',
        installed: false,
      });
    } catch (error) {
      console.error('プラグインのアンインストールに失敗:', error);
      socket.emit('plugin-updated', {
        success: false,
        message:
          error instanceof Error
            ? error.message
            : 'プラグインのアンインストールに失敗しました',
        installed: true,
      });
    }
  });
}
