import { useState, useEffect, useCallback } from 'react';
import { Socket } from 'socket.io-client';
import type {
  ServerToClientEvents,
  ClientToServerEvents,
  HookWebhook,
} from '@/types';

// 操作の結果を出しておく時間
const MESSAGE_VISIBLE_MS = 3000;

export interface HookWebhookMessage {
  type: 'success' | 'error';
  text: string;
}

/**
 * useHookWebhooks フックの戻り値
 */
export interface UseHookWebhooksReturn {
  webhooks: HookWebhook[];
  // 追加・削除の結果
  message: HookWebhookMessage | null;
  // テスト送信の結果（送り先の id ごと）
  testMessages: Record<string, HookWebhookMessage>;
  // テスト送信の返事を待っている送り先の id
  testingId: string | null;

  addWebhook: (url: string) => void;
  deleteWebhook: (id: string) => void;
  testWebhook: (id: string) => void;
}

/**
 * Webhook の送り先（AI の hook イベントを外へ知らせる URL）を管理するカスタムフック
 */
export function useHookWebhooks(
  socket: Socket<ServerToClientEvents, ClientToServerEvents> | null
): UseHookWebhooksReturn {
  const [webhooks, setWebhooks] = useState<HookWebhook[]>([]);
  const [message, setMessage] = useState<HookWebhookMessage | null>(null);
  const [testMessages, setTestMessages] = useState<Record<string, HookWebhookMessage>>({});
  const [testingId, setTestingId] = useState<string | null>(null);

  useEffect(() => {
    if (!socket) return;

    socket.emit('list-hook-webhooks');

    const handleList = (data: { webhooks: HookWebhook[] }) => {
      setWebhooks(data.webhooks);
    };

    const handleSaved = (data: { success: boolean; message: string }) => {
      let type: HookWebhookMessage['type'] = 'error';
      if (data.success) {
        type = 'success';
      }
      setMessage({ type, text: data.message });
      setTimeout(() => setMessage(null), MESSAGE_VISIBLE_MS);
    };

    const handleTested = (data: { id: string; success: boolean; message: string }) => {
      let type: HookWebhookMessage['type'] = 'error';
      if (data.success) {
        type = 'success';
      }
      setTestingId(null);
      setTestMessages((prev) => ({ ...prev, [data.id]: { type, text: data.message } }));
      setTimeout(() => {
        setTestMessages((prev) => {
          const next = { ...prev };
          delete next[data.id];
          return next;
        });
      }, MESSAGE_VISIBLE_MS);
    };

    socket.on('hook-webhooks-list', handleList);
    socket.on('hook-webhook-saved', handleSaved);
    socket.on('hook-webhook-tested', handleTested);

    return () => {
      socket.off('hook-webhooks-list', handleList);
      socket.off('hook-webhook-saved', handleSaved);
      socket.off('hook-webhook-tested', handleTested);
    };
  }, [socket]);

  const addWebhook = useCallback(
    (url: string) => {
      if (!socket) return;
      socket.emit('add-hook-webhook', { url });
    },
    [socket]
  );

  const deleteWebhook = useCallback(
    (id: string) => {
      if (!socket) return;
      socket.emit('delete-hook-webhook', { id });
    },
    [socket]
  );

  const testWebhook = useCallback(
    (id: string) => {
      if (!socket) return;
      setTestingId(id);
      socket.emit('test-hook-webhook', { id });
    },
    [socket]
  );

  return {
    webhooks,
    message,
    testMessages,
    testingId,
    addWebhook,
    deleteWebhook,
    testWebhook,
  };
}
