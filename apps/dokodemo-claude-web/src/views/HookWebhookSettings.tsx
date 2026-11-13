import React, { useState } from 'react';
import Button from '@/shared/components/Button';
import { useSocketContext } from '@/app/providers/SocketProvider';
import { useHookWebhooks } from '@/app/hooks/useHookWebhooks';
import type { HookWebhookMessage } from '@/app/hooks/useHookWebhooks';
import s from './settings-layout.module.scss';
import v from './SettingsView.module.scss';

/** 結果の文言の色 */
function messageClassName(message: HookWebhookMessage): string {
  if (message.type === 'success') {
    return s.messageSuccess;
  }
  return s.messageError;
}

/**
 * 設定画面の「連携」に置く Webhook の一覧と追加欄
 */
export function HookWebhookSettings() {
  const { socket } = useSocketContext();
  const hookWebhooks = useHookWebhooks(socket);
  const [url, setUrl] = useState('');

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    const trimmed = url.trim();
    if (trimmed === '') return;
    hookWebhooks.addWebhook(trimmed);
    setUrl('');
  };

  const rows: React.ReactNode[] = [];
  for (const webhook of hookWebhooks.webhooks) {
    const testMessage = hookWebhooks.testMessages[webhook.id];
    const testing = hookWebhooks.testingId === webhook.id;
    let testLabel = 'テスト送信';
    if (testing) {
      testLabel = '送信中...';
    }
    let testResult: React.ReactNode = null;
    if (testMessage) {
      testResult = <p className={messageClassName(testMessage)}>{testMessage.text}</p>;
    }
    rows.push(
      <div className={s.row} key={webhook.id}>
        <div className={s.rowInfo}>
          <span className={v.webhookUrl}>{webhook.url}</span>
          {testResult}
        </div>
        <div className={s.rowControl}>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => hookWebhooks.testWebhook(webhook.id)}
            disabled={testing}
          >
            {testLabel}
          </Button>
          <Button
            variant="danger"
            size="sm"
            onClick={() => hookWebhooks.deleteWebhook(webhook.id)}
          >
            削除
          </Button>
        </div>
      </div>
    );
  }

  let savedResult: React.ReactNode = null;
  if (hookWebhooks.message) {
    savedResult = (
      <p className={messageClassName(hookWebhooks.message)}>{hookWebhooks.message.text}</p>
    );
  }

  return (
    <>
      <div className={s.groupHeader}>
        <span className={s.groupTitle}>Webhook</span>
        <p className={s.groupDesc}>
          AI の応答の終了・プロンプトの送信・入力待ちが起きるたびに、登録した URL へ POST で知らせます。
          本文は event / provider / repositoryPath / transcriptPath / timestamp の JSON です（AI Hooks の設定が必要です）
        </p>
      </div>
      {rows}
      <div className={s.rowStack}>
        <form className={v.webhookForm} onSubmit={handleSubmit}>
          <input
            type="url"
            className={v.webhookInput}
            value={url}
            onChange={(event) => setUrl(event.target.value)}
            placeholder="https://example.com/webhook"
            aria-label="Webhook の URL"
          />
          <Button variant="primary" size="sm" type="submit" disabled={url.trim() === ''}>
            追加
          </Button>
        </form>
        {savedResult}
      </div>
    </>
  );
}
