import { useState, useEffect, useCallback } from 'react';
import { Socket } from 'socket.io-client';
import type { ServerToClientEvents, ClientToServerEvents } from '../types';

/**
 * useWebPush フックの戻り値
 */
export interface UseWebPushReturn {
  // 状態
  isSupported: boolean;
  permissionState: NotificationPermission | 'unknown';
  isSubscribed: boolean;
  loading: boolean;
  testLoading: boolean;
  message: { type: 'success' | 'error'; text: string } | null;

  // アクション
  subscribe: () => void;
  unsubscribe: () => void;
  testNotification: () => void;
}

/**
 * Service Workerの準備完了をタイムアウト付きで待つ
 */
function waitForServiceWorker(timeoutMs = 10000): Promise<ServiceWorkerRegistration> {
  return Promise.race([
    navigator.serviceWorker.ready,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('Service Workerが利用できません。ページをリロードしてください。')), timeoutMs)
    ),
  ]);
}

/**
 * Web Push通知を管理するカスタムフック
 */
export function useWebPush(
  socket: Socket<ServerToClientEvents, ClientToServerEvents> | null,
  isActive: boolean,
  currentRepo?: string
): UseWebPushReturn {
  const [isSupported] = useState(
    () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window
  );
  const [permissionState, setPermissionState] = useState<NotificationPermission | 'unknown'>(
    () => (typeof Notification !== 'undefined' ? Notification.permission : 'unknown')
  );
  const [isSubscribed, setIsSubscribed] = useState(false);
  const [loading, setLoading] = useState(false);
  const [testLoading, setTestLoading] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [vapidPublicKey, setVapidPublicKey] = useState<string | null>(null);

  const showMessage = useCallback((type: 'success' | 'error', text: string) => {
    setMessage({ type, text });
    setTimeout(() => setMessage(null), 3000);
  }, []);

  // 既存のサブスクリプションを確認
  useEffect(() => {
    if (!isSupported || !isActive) return;

    waitForServiceWorker().then((registration) => {
      registration.pushManager.getSubscription().then((sub) => {
        setIsSubscribed(!!sub);
      });
    }).catch(() => {
      // Service Worker未対応環境（開発環境等）では無視
    });
  }, [isSupported, isActive]);

  // VAPIDキー取得 & Socketイベントリスナー
  useEffect(() => {
    if (!socket || !isActive) return;

    socket.emit('get-vapid-public-key');

    const handleVapidKey = (data: { key: string }) => {
      setVapidPublicKey(data.key);
    };

    const handleSubscribed = (data: { success: boolean }) => {
      setLoading(false);
      if (data.success) {
        setIsSubscribed(true);
        showMessage('success', 'Web Push通知を有効にしました');
      } else {
        showMessage('error', 'サブスクリプションの登録に失敗しました');
      }
    };

    const handleUnsubscribed = (data: { success: boolean }) => {
      setLoading(false);
      if (data.success) {
        setIsSubscribed(false);
        showMessage('success', 'Web Push通知を無効にしました');
      } else {
        showMessage('error', 'サブスクリプションの解除に失敗しました');
      }
    };

    const handleTestSent = (data: { success: boolean; error?: string }) => {
      setTestLoading(false);
      if (data.success) {
        showMessage('success', 'テスト通知を送信しました');
      } else {
        showMessage('error', `テスト送信に失敗: ${data.error || '不明なエラー'}`);
      }
    };

    socket.on('vapid-public-key', handleVapidKey);
    socket.on('push-subscribed', handleSubscribed);
    socket.on('push-unsubscribed', handleUnsubscribed);
    socket.on('push-test-sent', handleTestSent);

    return () => {
      socket.off('vapid-public-key', handleVapidKey);
      socket.off('push-subscribed', handleSubscribed);
      socket.off('push-unsubscribed', handleUnsubscribed);
      socket.off('push-test-sent', handleTestSent);
    };
  }, [socket, isActive, showMessage]);

  // サブスクライブ
  const subscribe = useCallback(async () => {
    if (!socket || !vapidPublicKey || !isSupported) return;

    setLoading(true);
    setMessage(null);

    try {
      const permission = await Notification.requestPermission();
      setPermissionState(permission);

      if (permission !== 'granted') {
        setLoading(false);
        showMessage('error', '通知の許可が必要です。ブラウザの設定を確認してください。');
        return;
      }

      const registration = await waitForServiceWorker();

      // Base64 URL → Uint8Array
      const padding = '='.repeat((4 - (vapidPublicKey.length % 4)) % 4);
      const base64 = (vapidPublicKey + padding).replace(/-/g, '+').replace(/_/g, '/');
      const raw = atob(base64);
      const applicationServerKey = new Uint8Array(raw.length);
      for (let i = 0; i < raw.length; i++) {
        applicationServerKey[i] = raw.charCodeAt(i);
      }

      const subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey,
      });

      const json = subscription.toJSON();
      if (!json.endpoint || !json.keys) {
        throw new Error('サブスクリプション情報が不完全です');
      }

      socket.emit('subscribe-push', {
        subscription: {
          endpoint: json.endpoint,
          keys: {
            p256dh: json.keys.p256dh!,
            auth: json.keys.auth!,
          },
        },
      });
    } catch (err) {
      setLoading(false);
      showMessage('error', `登録に失敗しました: ${err instanceof Error ? err.message : '不明なエラー'}`);
    }
  }, [socket, vapidPublicKey, isSupported, showMessage]);

  // アンサブスクライブ
  const unsubscribe = useCallback(async () => {
    if (!socket) return;

    setLoading(true);
    setMessage(null);

    try {
      const registration = await waitForServiceWorker();
      const subscription = await registration.pushManager.getSubscription();

      if (subscription) {
        const endpoint = subscription.endpoint;
        await subscription.unsubscribe();
        socket.emit('unsubscribe-push', { endpoint });
      } else {
        setLoading(false);
        setIsSubscribed(false);
        showMessage('success', 'Web Push通知を無効にしました');
      }
    } catch (err) {
      setLoading(false);
      showMessage('error', `解除に失敗しました: ${err instanceof Error ? err.message : '不明なエラー'}`);
    }
  }, [socket, showMessage]);

  // テスト通知送信
  const testNotification = useCallback(() => {
    if (!socket) return;
    setTestLoading(true);
    setMessage(null);
    socket.emit('test-push-notification', { repositoryPath: currentRepo });
  }, [socket, currentRepo]);

  return {
    isSupported,
    permissionState,
    isSubscribed,
    loading,
    testLoading,
    message,
    subscribe,
    unsubscribe,
    testNotification,
  };
}
