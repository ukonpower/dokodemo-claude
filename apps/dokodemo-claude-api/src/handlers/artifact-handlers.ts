import type { HandlerContext } from './types.js';
import { repositoryIdManager } from '../services/repository-id-manager.js';
import { listArtifacts } from '../services/artifact-list-service.js';

/**
 * Artifact 一覧関連の Socket.IO イベントハンドラーを登録
 */
export function registerArtifactHandlers(ctx: HandlerContext): void {
  const { socket } = ctx;

  // rid の作業ディレクトリ（リポジトリ / ワークツリーのパス）で作られた Artifact を返す
  socket.on('get-artifacts', async (data) => {
    const { rid } = data;
    const repoPath = repositoryIdManager.getPath(rid);
    try {
      const artifacts = await listArtifacts(repoPath);
      socket.emit('artifacts-list', { rid, artifacts });
    } catch (error) {
      console.error('Artifact 一覧の取得に失敗:', error);
      socket.emit('artifacts-list', { rid, artifacts: [] });
    }
  });
}
