/**
 * AI のターンが終わったことを central（プロジェクトの文脈をまとめる別アプリ）へ知らせるサービス
 *
 * central は合図を受けると、リポジトリが静かになったところでコミットと会話ログを読み、
 * プロジェクトの文書へ作業の内容を書く。会話ログの場所は hook でしか分からないので、ここから渡す。
 *
 * DC_CENTRAL_URL が未設定なら何も送らない（central を使わない環境では無効）。
 * 本文の形は central の src/lib/workSignal.ts（parseWorkSignal）と揃える。
 */

import http from 'http';
import https from 'https';

// central が止まっていても hook の処理を待たせないための上限
const REQUEST_TIMEOUT_MS = 3000;

// central 側の受け口（central の server/index.ts の POST /work-signal）
const SIGNAL_PATH = '/work-signal';

export interface CentralWorkSignal {
  // ターンが終わったリポジトリ（本体かワークツリー）の絶対パス
  cwd: string;
  // そのターンの会話ログ（jsonl）の絶対パス。hook に付いていなければ null
  transcriptPath: string | null;
}

/**
 * central の URL（未設定・空なら null）
 */
function getCentralUrl(): string | null {
  const value = process.env.DC_CENTRAL_URL;
  if (!value) {
    return null;
  }
  return value;
}

/**
 * ターン終了の合図を central へ送る。
 * 送れなくても作業は止めたくないので、失敗は例外にせずログだけ残す
 */
export function sendCentralWorkSignal(signal: CentralWorkSignal): Promise<void> {
  const baseUrl = getCentralUrl();
  if (baseUrl === null) {
    return Promise.resolve();
  }

  let url: URL;
  try {
    url = new URL(SIGNAL_PATH, baseUrl);
  } catch {
    console.error(`central への合図: DC_CENTRAL_URL が URL として読めません: ${baseUrl}`);
    return Promise.resolve();
  }

  let client: typeof http | typeof https = http;
  if (url.protocol === 'https:') {
    client = https;
  }
  const payload = JSON.stringify(signal);

  return new Promise((resolve) => {
    const request = client.request(
      url,
      {
        method: 'POST',
        // central は同じホストで自己署名証明書を使うことがあるので、証明書の検証はしない
        rejectUnauthorized: false,
        timeout: REQUEST_TIMEOUT_MS,
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(payload),
        },
      },
      (response) => {
        // 本文は使わないが、読み切らないと接続が閉じない
        response.resume();
        response.on('end', () => {
          const status = response.statusCode ?? 0;
          if (status < 200 || status >= 300) {
            console.error(`central への合図: 受け取られませんでした（status ${status}）`);
          }
          resolve();
        });
      }
    );
    request.on('timeout', () => {
      request.destroy(new Error('timeout'));
    });
    request.on('error', (error) => {
      console.error(`central への合図: 送れませんでした（${error.message}）`);
      resolve();
    });
    request.end(payload);
  });
}
