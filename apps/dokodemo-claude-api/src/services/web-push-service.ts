/**
 * Web Push通知サービス
 * Claude Codeのイベント（Stop, AskUserQuestion等）でブラウザにプッシュ通知を送信する
 */

import webpush from 'web-push';
import type { PushSubscriptionJSON } from '../types/index.js';
import { PersistenceService } from './persistence-service.js';

const VAPID_FILE = 'web-push-vapid.json';
const SUBSCRIPTIONS_FILE = 'web-push-subscriptions.json';

export type WebPushEventType =
  | 'Stop'
  | 'AskUserQuestion'
  | 'PlanApprovalWaiting'
  | 'PermissionRequest';

export interface WebPushPayload {
  title: string;
  body: string;
  url?: string;
  eventType: WebPushEventType;
}

interface VapidKeys {
  publicKey: string;
  privateKey: string;
}

/**
 * Web Push通知サービス
 */
export class WebPushService {
  private persistenceService: PersistenceService;
  private vapidKeys: VapidKeys | null = null;
  private subscriptions: PushSubscriptionJSON[] = [];

  constructor(persistenceService: PersistenceService) {
    this.persistenceService = persistenceService;
  }

  /**
   * サービスを初期化（VAPID鍵の読み込みor生成、subscription読み込み）
   */
  async initialize(): Promise<void> {
    await this.loadOrGenerateVapidKeys();
    await this.loadSubscriptions();
  }

  /**
   * VAPID鍵を読み込む。なければ生成して保存する。
   */
  private async loadOrGenerateVapidKeys(): Promise<void> {
    const result = await this.persistenceService.load<VapidKeys>(VAPID_FILE);

    if (result.ok && result.value) {
      this.vapidKeys = result.value;
    } else {
      // 新規生成
      const keys = webpush.generateVAPIDKeys();
      this.vapidKeys = {
        publicKey: keys.publicKey,
        privateKey: keys.privateKey,
      };
      await this.persistenceService.save(VAPID_FILE, this.vapidKeys);
      console.log('🔔 VAPID鍵を生成しました');
    }

    // web-pushライブラリにVAPID情報を設定
    // DC_VAPID_CONTACT: 実際のメールアドレス推奨（Safari等で必須）例: mailto:your@email.com
    const vapidContact = process.env.DC_VAPID_CONTACT || 'mailto:dokodemo-claude@localhost';
    webpush.setVapidDetails(vapidContact, this.vapidKeys.publicKey, this.vapidKeys.privateKey);
  }

  /**
   * 保存済みsubscriptionを読み込む
   */
  private async loadSubscriptions(): Promise<void> {
    const result = await this.persistenceService.load<PushSubscriptionJSON[]>(
      SUBSCRIPTIONS_FILE
    );

    if (result.ok && result.value) {
      this.subscriptions = result.value;
    } else {
      this.subscriptions = [];
    }
  }

  /**
   * subscriptionリストを保存する
   */
  private async saveSubscriptions(): Promise<void> {
    await this.persistenceService.save(SUBSCRIPTIONS_FILE, this.subscriptions);
  }

  /**
   * VAPIDパブリックキーを取得
   */
  getVapidPublicKey(): string | null {
    return this.vapidKeys?.publicKey ?? null;
  }

  /**
   * subscriptionを保存
   */
  async saveSubscription(subscription: PushSubscriptionJSON): Promise<void> {
    // 重複チェック
    const exists = this.subscriptions.some(
      (s) => s.endpoint === subscription.endpoint
    );
    if (!exists) {
      this.subscriptions.push(subscription);
      await this.saveSubscriptions();
    }
  }

  /**
   * subscriptionを削除
   */
  async removeSubscription(endpoint: string): Promise<void> {
    this.subscriptions = this.subscriptions.filter(
      (s) => s.endpoint !== endpoint
    );
    await this.saveSubscriptions();
  }

  /**
   * 全subscriptionに通知を送信
   */
  async sendNotification(payload: WebPushPayload): Promise<void> {
    if (this.subscriptions.length === 0) {
      return;
    }

    const payloadStr = JSON.stringify(payload);
    const expiredEndpoints: string[] = [];

    for (const subscription of this.subscriptions) {
      try {
        await webpush.sendNotification(
          {
            endpoint: subscription.endpoint,
            keys: subscription.keys,
          },
          payloadStr
        );
      } catch (error) {
        const statusCode = (error as { statusCode?: number }).statusCode;
        if (statusCode === 410 || statusCode === 404) {
          // subscription期限切れ
          expiredEndpoints.push(subscription.endpoint);
        } else {
          console.error('Web Push送信エラー:', error);
        }
      }
    }

    // 期限切れsubscriptionを削除
    if (expiredEndpoints.length > 0) {
      this.subscriptions = this.subscriptions.filter(
        (s) => !expiredEndpoints.includes(s.endpoint)
      );
      await this.saveSubscriptions();
    }
  }
}

// シングルトンインスタンス
let webPushService: WebPushService | null = null;

/**
 * WebPushサービスを初期化
 */
export function initWebPushService(
  persistenceService: PersistenceService
): WebPushService {
  webPushService = new WebPushService(persistenceService);
  return webPushService;
}

/**
 * WebPushサービスを取得
 */
export function getWebPushService(): WebPushService | null {
  return webPushService;
}
