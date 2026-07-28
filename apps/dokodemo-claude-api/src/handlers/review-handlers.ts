/**
 * 評価リクエスト（受信箱）のハンドラ。
 * - Socket: 一覧取得・応答・削除
 * - REST: 添付画像の配信（恒久 URL）
 * 応答時のキュー注入などビジネスロジックは services/mcp-actions.ts に集約。
 */

import type { Express, RequestHandler } from 'express';
import type { HandlerContext } from './types.js';
import type { ActionDeps } from '../services/mcp-actions.js';
import {
  respondReviewRequest,
  deleteReviewRequest,
} from '../services/mcp-actions.js';
import { getReviewMediaPath } from '../services/review-media.js';
import { repositoryIdManager } from '../services/repository-id-manager.js';
import { getMainRepoPath } from '../utils/git-utils.js';

/**
 * GET /api/review-media/:rid/:filename
 * 評価リクエスト添付画像の配信。uploads/<rid>/review/ 配下から返す。
 */
export const getReviewMediaHandler: RequestHandler = (req, res) => {
  const { rid, filename } = req.params;
  const filePath = getReviewMediaPath(rid, filename);
  if (!filePath) {
    res.status(404).json({ success: false, message: 'ファイルが見つかりません' });
    return;
  }
  res.sendFile(filePath, (err) => {
    if (err && !res.headersSent) {
      res
        .status(404)
        .json({ success: false, message: 'ファイルが見つかりません' });
    }
  });
};

export function registerReviewRoutes(app: Express): void {
  app.get('/api/review-media/:rid/:filename', getReviewMediaHandler);
}

export function registerReviewHandlers(ctx: HandlerContext): void {
  const { socket, io, processManager } = ctx;
  const deps: ActionDeps = {
    processManager,
    io,
    getRepositories: () => ctx.repositories,
  };

  // 受信箱は親リポジトリ単位。worktree の rid で購読されても親へ正規化する
  const resolveInboxRid = (rid: string): string => {
    const path = repositoryIdManager.getPath(rid);
    if (!path) return rid;
    return repositoryIdManager.tryGetId(getMainRepoPath(path)) ?? rid;
  };

  socket.on('review-get-requests', (data) => {
    const { rid } = data;
    const inboxRid = resolveInboxRid(rid);
    socket.emit('review-requests-list', {
      rid,
      inboxRid,
      requests: processManager.reviewRequestManager.list(inboxRid),
    });
  });

  socket.on('review-respond', async (data) => {
    const { rid, requestId, kind, choice, comment } = data;
    try {
      await respondReviewRequest(rid, requestId, { kind, choice, comment }, deps);
    } catch (e) {
      console.error('評価リクエストへの応答に失敗:', e);
      // クライアント側の表示をサーバ状態に合わせ直す
      socket.emit('review-requests-list', {
        rid,
        inboxRid: rid,
        requests: processManager.reviewRequestManager.list(rid),
      });
    }
  });

  socket.on('review-delete-request', async (data) => {
    const { rid, requestId } = data;
    try {
      await deleteReviewRequest(rid, requestId, deps);
    } catch (e) {
      console.error('評価リクエストの削除に失敗:', e);
      socket.emit('review-requests-list', {
        rid,
        inboxRid: rid,
        requests: processManager.reviewRequestManager.list(rid),
      });
    }
  });
}
