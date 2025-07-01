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

// フェッチイベントをリッスンするが、何も特別な処理は行わない
self.addEventListener('fetch', (event) => {
  // ネットワークファーストで、何もキャッシュしない
  event.respondWith(fetch(event.request));
});