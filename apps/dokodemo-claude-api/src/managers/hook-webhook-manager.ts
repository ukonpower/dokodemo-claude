/**
 * Webhook 管理マネージャー
 * AI の hook イベント（応答の終了・入力待ちなど）を、設定画面で登録した URL へ POST で知らせる。
 * 外のツールが dokodemo-claude の作業の進みをきっかけに動けるようにするための仕組み。
 */

import http from 'http';
import https from 'https';
import type { HookWebhook, HookWebhookPayload } from '../types/index.js';
import { PersistenceService } from '../services/persistence-service.js';

const FILE = 'hook-webhooks.json';

// 送り先が止まっていても送信を溜め込まないための上限
const REQUEST_TIMEOUT_MS = 3000;

// 証明書の検証を省いてよいホスト（自分のマシンで動く自己署名証明書のサーバー）
const LOOPBACK_HOSTS = ['localhost', '127.0.0.1', '[::1]'];

/** 操作の結果（失敗なら message に理由が入る） */
export interface HookWebhookResult {
  success: boolean;
  message: string;
}

/**
 * 入力を送り先の URL として読む（http / https 以外・読めないものは null）
 */
function parseWebhookUrl(value: string): URL | null {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return null;
  }
  return url;
}

/**
 * 1 つの URL へ本文を POST する
 */
function postJson(target: string, payload: HookWebhookPayload): Promise<HookWebhookResult> {
  const url = parseWebhookUrl(target);
  if (url === null) {
    return Promise.resolve({ success: false, message: 'URL を読めません' });
  }

  let client: typeof http | typeof https = http;
  if (url.protocol === 'https:') {
    client = https;
  }
  const body = JSON.stringify(payload);
  const isLoopback = LOOPBACK_HOSTS.includes(url.hostname);

  return new Promise((resolve) => {
    const request = client.request(
      url,
      {
        method: 'POST',
        rejectUnauthorized: !isLoopback,
        timeout: REQUEST_TIMEOUT_MS,
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body),
        },
      },
      (response) => {
        // 本文は使わないが、読み切らないと接続が閉じない
        response.resume();
        response.on('end', () => {
          const status = response.statusCode ?? 0;
          if (status < 200 || status >= 300) {
            resolve({ success: false, message: `status ${status} が返りました` });
            return;
          }
          resolve({ success: true, message: `送信しました（status ${status}）` });
        });
      }
    );
    request.on('timeout', () => {
      request.destroy(new Error('タイムアウト'));
    });
    request.on('error', (error) => {
      resolve({ success: false, message: `送れませんでした（${error.message}）` });
    });
    request.end(body);
  });
}

export class HookWebhookManager {
  private webhooks: HookWebhook[] = [];
  private counter = 0;

  constructor(private readonly persistenceService: PersistenceService) {}

  /**
   * 保存してある送り先を読み込む
   */
  async initialize(): Promise<void> {
    const result = await this.persistenceService.load<HookWebhook[]>(FILE);
    if (!result.ok) {
      console.error('[HookWebhookManager] 復元に失敗:', result.error.message);
      return;
    }
    if (result.value === null) {
      return;
    }
    this.webhooks = result.value;
  }

  list(): HookWebhook[] {
    return [...this.webhooks];
  }

  /**
   * 送り先を足す
   */
  async add(value: string): Promise<HookWebhookResult> {
    const url = parseWebhookUrl(value.trim());
    if (url === null) {
      return { success: false, message: 'http:// か https:// で始まる URL を入力してください' };
    }
    const normalized = url.toString();
    for (const webhook of this.webhooks) {
      if (webhook.url === normalized) {
        return { success: false, message: 'この URL はすでに登録されています' };
      }
    }

    this.counter += 1;
    const webhook: HookWebhook = {
      id: `webhook-${Date.now()}-${this.counter}`,
      url: normalized,
      createdAt: Date.now(),
    };
    const next = [...this.webhooks, webhook];
    const saved = await this.persistenceService.save(FILE, next);
    if (!saved.ok) {
      return { success: false, message: '保存に失敗しました' };
    }
    this.webhooks = next;
    return { success: true, message: 'Webhook を追加しました' };
  }

  /**
   * 送り先を消す
   */
  async delete(id: string): Promise<HookWebhookResult> {
    const next: HookWebhook[] = [];
    for (const webhook of this.webhooks) {
      if (webhook.id !== id) {
        next.push(webhook);
      }
    }
    if (next.length === this.webhooks.length) {
      return { success: false, message: 'Webhook が見つかりません' };
    }
    const saved = await this.persistenceService.save(FILE, next);
    if (!saved.ok) {
      return { success: false, message: '保存に失敗しました' };
    }
    this.webhooks = next;
    return { success: true, message: 'Webhook を削除しました' };
  }

  /**
   * 登録してあるすべての送り先へ知らせる。
   * 送れなくても AI の作業は止めたくないので、失敗は例外にせずログだけ残す
   */
  async sendToAll(payload: HookWebhookPayload): Promise<void> {
    const targets = this.list();
    const sends: Promise<void>[] = [];
    for (const webhook of targets) {
      sends.push(this.sendAndLog(webhook, payload));
    }
    await Promise.all(sends);
  }

  /**
   * 設定画面から、1 つの送り先へ試しに送る
   */
  async sendTest(id: string): Promise<HookWebhookResult> {
    let target: HookWebhook | null = null;
    for (const webhook of this.webhooks) {
      if (webhook.id === id) {
        target = webhook;
      }
    }
    if (target === null) {
      return { success: false, message: 'Webhook が見つかりません' };
    }
    return postJson(target.url, {
      event: 'Test',
      provider: 'claude',
      repositoryPath: '',
      transcriptPath: null,
      timestamp: Date.now(),
    });
  }

  private async sendAndLog(webhook: HookWebhook, payload: HookWebhookPayload): Promise<void> {
    const result = await postJson(webhook.url, payload);
    if (!result.success) {
      console.error(`[HookWebhookManager] ${webhook.url}: ${result.message}`);
    }
  }
}
