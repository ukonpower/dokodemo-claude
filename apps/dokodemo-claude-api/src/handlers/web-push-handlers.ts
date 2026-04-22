import type { HandlerContext } from './types.js';
import { getWebPushService } from '../services/web-push-service.js';

/**
 * Web Push通知関連のSocket.IOイベントハンドラーを登録
 */
export function registerWebPushHandlers(ctx: HandlerContext): void {
  const { socket } = ctx;

  // VAPIDパブリックキー取得
  socket.on('get-vapid-public-key', () => {
    const service = getWebPushService();
    if (!service) {
      return;
    }

    const key = service.getVapidPublicKey();
    if (key) {
      socket.emit('vapid-public-key', { key });
    }
  });

  // Push subscription登録
  socket.on('subscribe-push', async (data) => {
    const service = getWebPushService();
    if (!service) {
      socket.emit('push-subscribed', { success: false });
      return;
    }

    try {
      await service.saveSubscription(data.subscription);
      socket.emit('push-subscribed', { success: true });
    } catch (error) {
      console.error('Push subscription保存エラー:', error);
      socket.emit('push-subscribed', { success: false });
    }
  });

  // Push subscription解除
  socket.on('unsubscribe-push', async (data) => {
    const service = getWebPushService();
    if (!service) {
      socket.emit('push-unsubscribed', { success: false });
      return;
    }

    try {
      await service.removeSubscription(data.endpoint);
      socket.emit('push-unsubscribed', { success: true });
    } catch (error) {
      console.error('Push subscription削除エラー:', error);
      socket.emit('push-unsubscribed', { success: false });
    }
  });

  // テスト通知送信
  socket.on('test-push-notification', async (data?: { repositoryPath?: string }) => {
    const service = getWebPushService();
    if (!service) {
      socket.emit('push-test-sent', {
        success: false,
        error: 'Web Pushサービスが初期化されていません',
      });
      return;
    }

    const notificationUrl = data?.repositoryPath
      ? `/?repo=${encodeURIComponent(data.repositoryPath)}`
      : '/';

    try {
      await service.sendNotification({
        title: 'dokodemo-claude テスト通知',
        body: 'Web Push通知が正しく動作しています',
        url: notificationUrl,
        eventType: 'Stop',
      });
      socket.emit('push-test-sent', { success: true });
    } catch (error) {
      console.error('テスト通知送信エラー:', error);
      socket.emit('push-test-sent', {
        success: false,
        error: error instanceof Error ? error.message : '不明なエラー',
      });
    }
  });
}
