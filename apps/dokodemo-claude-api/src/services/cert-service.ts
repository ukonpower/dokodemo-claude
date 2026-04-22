/**
 * 証明書読み込みサービス
 * 環境変数で指定されたパスから証明書を読み込む
 *   - DC_HTTPS_CERT_PATH: サーバー証明書（必須）
 *   - DC_HTTPS_KEY_PATH: 秘密鍵（必須）
 *   - DC_HTTPS_ROOT_CA_PATH: ルートCA証明書（任意、/api/cert で配信）
 */

import * as crypto from 'node:crypto';
import * as fs from 'fs/promises';
import * as fsSync from 'fs';

export interface CertificateInfo {
  cert: string;
  key: string;
  certPath: string;
  rootCaPath: string | null;
}

function isCertificateExpired(certPem: string): boolean {
  try {
    const cert = new crypto.X509Certificate(certPem);
    return new Date() >= new Date(cert.validTo);
  } catch {
    return true;
  }
}

export async function getCertificates(): Promise<CertificateInfo | null> {
  const certPath = process.env.DC_HTTPS_CERT_PATH;
  const keyPath = process.env.DC_HTTPS_KEY_PATH;
  const rootCaEnvPath = process.env.DC_HTTPS_ROOT_CA_PATH;

  if (!certPath || !keyPath) {
    console.log(
      '⚠️  DC_HTTPS_CERT_PATH と DC_HTTPS_KEY_PATH が .env で設定されていません。'
    );
    return null;
  }

  try {
    const cert = await fs.readFile(certPath, 'utf-8');
    const key = await fs.readFile(keyPath, 'utf-8');

    if (isCertificateExpired(cert)) {
      console.log(
        `⚠️  証明書の有効期限が切れています: ${certPath}。新しい証明書を用意し直してください。`
      );
      return null;
    }

    let rootCaPath: string | null = null;
    if (rootCaEnvPath) {
      if (fsSync.existsSync(rootCaEnvPath)) {
        rootCaPath = rootCaEnvPath;
      } else {
        console.log(
          `⚠️  DC_HTTPS_ROOT_CA_PATH で指定されたファイルが存在しません: ${rootCaEnvPath}`
        );
      }
    }

    return { cert, key, certPath, rootCaPath };
  } catch (err) {
    console.log(
      `⚠️  証明書の読み込みに失敗しました。(certPath: ${certPath}, keyPath: ${keyPath}, error: ${err})`
    );
    return null;
  }
}
