/**
 * 評価リクエストの添付画像の恒久置き場。
 *
 * 通常のプレビュー（uploads/<rid>/ 直下）は UI の一括削除で消えるため、
 * 評価リクエストから参照される画像はサブディレクトリ uploads/<rid>/review/ に
 * 分離して保存する（fileManager.getFiles はディレクトリを列挙しないので
 * ファイルタブには現れず、一括削除の対象にもならない）。
 * 配信は GET /api/review-media/:rid/:filename（review-handlers.ts）。
 */

import { promises as fs } from 'fs';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { fileManager } from './file-manager.js';

const REVIEW_DIR = 'review';

const IMAGE_EXTENSIONS = new Set([
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.webp',
  '.svg',
]);

function getReviewMediaDir(rid: string): string {
  return path.join(fileManager.getRepositoryUploadsPath(rid), REVIEW_DIR);
}

/**
 * ローカルの画像ファイルを review 領域へコピーし、配信用の相対 URL を返す。
 */
export async function saveReviewImage(
  rid: string,
  srcPath: string
): Promise<{ filename: string; url: string }> {
  const ext = path.extname(srcPath).toLowerCase();
  if (!IMAGE_EXTENSIONS.has(ext)) {
    throw new Error(`画像ではないファイルです: ${srcPath}`);
  }

  const dir = getReviewMediaDir(rid);
  await fs.mkdir(dir, { recursive: true });

  const filename = `${uuidv4().substring(0, 8)}${ext}`;
  await fs.copyFile(srcPath, path.join(dir, filename));

  return {
    filename,
    url: `/api/review-media/${encodeURIComponent(rid)}/${encodeURIComponent(filename)}`,
  };
}

/**
 * 配信用の実ファイルパス。パストラバーサルは basename 検査で弾く。
 */
export function getReviewMediaPath(
  rid: string,
  filename: string
): string | null {
  if (!rid) return null;
  const sanitized = path.basename(filename);
  if (sanitized !== filename) return null;
  return path.join(getReviewMediaDir(rid), sanitized);
}

/**
 * 評価リクエスト削除時に添付画像も削除する。
 * url は saveReviewImage が返した相対 URL を想定し、末尾のファイル名だけ使う。
 */
export async function deleteReviewImages(
  rid: string,
  urls: string[]
): Promise<void> {
  for (const url of urls) {
    const filename = decodeURIComponent(url.split('/').pop() ?? '');
    const filePath = getReviewMediaPath(rid, filename);
    if (!filePath) continue;
    await fs.unlink(filePath).catch(() => {});
  }
}
