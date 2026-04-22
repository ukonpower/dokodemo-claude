import { clientsClaim } from 'workbox-core';
import { precacheAndRoute, cleanupOutdatedCaches } from 'workbox-precaching';

declare const self: ServiceWorkerGlobalScope;

// プリキャッシュ（ビルド時にvite-plugin-pwaが自動注入）
precacheAndRoute(self.__WB_MANIFEST);
// 古いキャッシュを自動削除
cleanupOutdatedCaches();

self.skipWaiting();
clientsClaim();

// Web Push通知の受信
self.addEventListener('push', (event) => {
  if (!event.data) return;

  try {
    let payload: { title?: string; body?: string; icon?: string; badge?: string; url?: string };
    try {
      payload = event.data.json() as typeof payload;
    } catch {
      // プレーンテキスト（DevToolsのテスト送信など）の場合はフォールバック
      payload = { title: 'dokodemo-claude', body: event.data.text() };
    }

    const options = {
      body: payload.body || '',
      icon: payload.icon || '/icon-192.png',
      badge: payload.badge || '/icon-192.png',
      data: { url: payload.url || '/' },
    };

    event.waitUntil(self.registration.showNotification(payload.title || 'dokodemo-claude', options));
  } catch (e) {
    console.error('Service Worker: push通知の処理に失敗', e);
  }
});

// 通知クリック時の処理
self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  const targetUrl = (event.notification.data as { url?: string })?.url || '/';

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      // 既存のウィンドウがあればURLへ移動してフォーカス
      for (const client of clientList) {
        if (client.url.includes(self.location.origin) && 'focus' in client) {
          const windowClient = client as WindowClient;
          return windowClient.navigate(targetUrl).then((c) => c?.focus());
        }
      }
      // なければ新しいウィンドウを開く（PWAインストール済みの場合は自動的にPWAで開く）
      return self.clients.openWindow(targetUrl);
    })
  );
});
