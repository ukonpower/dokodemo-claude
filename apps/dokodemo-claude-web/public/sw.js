// Service Worker for dokodemo-claude PWA
// キャッシュは行わない最小限の実装

self.addEventListener('install', (event) => {
  console.log('Service Worker: インストール中');
  // すぐにアクティブにする
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  console.log('Service Worker: アクティベート中');
  // すべてのクライアントを制御下に置く
  event.waitUntil(self.clients.claim());
});

// フェッチイベントをリッスンするが、ブラウザのデフォルト動作に任せる
self.addEventListener('fetch', () => {
  // 何もしない - ブラウザのデフォルトのネットワーク処理を使用
});

// Push通知の受信
self.addEventListener('push', (event) => {
  const data = event.data ? event.data.json() : {};
  const title = data.title || 'dokodemo-claude';
  const options = {
    body: data.body || '',
    icon: '/icon-192.png',
    badge: '/icon-192.png',
    data: { url: data.url || '/' },
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

// 通知クリック時の処理
self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  const targetUrl = (event.notification.data && event.notification.data.url) || '/';

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      // 既存のウィンドウがあればURLへ移動してフォーカス
      for (const client of clientList) {
        if (client.url && client.url.includes(self.location.origin) && 'focus' in client) {
          return client.navigate(targetUrl).then((c) => c && c.focus());
        }
      }
      // なければ新しいウィンドウを開く（PWAインストール済みの場合は自動的にPWAで開く）
      if (self.clients.openWindow) {
        return self.clients.openWindow(targetUrl);
      }
    })
  );
});
