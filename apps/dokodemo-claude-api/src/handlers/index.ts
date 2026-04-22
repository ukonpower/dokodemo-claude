import type { Server } from 'socket.io';
import type {
  ServerToClientEvents,
  ClientToServerEvents,
  GitRepository,
} from '../types/index.js';
import { ProcessManager } from '../process-manager.js';
import type { HandlerContext, TypedSocket } from './types.js';
import { registerRepositoryHandlers } from './repository-handlers.js';
import { registerAiSessionHandlers } from './ai-session-handlers.js';
import { registerTerminalHandlers } from './terminal-handlers.js';
import { registerBranchHandlers } from './branch-handlers.js';
import { registerPromptQueueHandlers } from './prompt-queue-handlers.js';
import { registerMiscHandlers } from './misc-handlers.js';
import { registerFileHandlers } from './file-upload-handlers.js';
import { registerDiffHandlers } from './diff-handlers.js';
import { registerHooksHandlers } from './hooks-handlers.js';
import { registerPluginHandlers } from './plugin-handlers.js';
import { registerFileViewerHandlers } from './file-viewer-handlers.js';
import { registerWebPushHandlers } from './web-push-handlers.js';
import { registerCustomAiButtonHandlers } from './custom-ai-button-handlers.js';
import { emitIdMappingTo } from './id-mapping-helpers.js';

export type { HandlerContext, TypedSocket, TypedServer } from './types.js';

/**
 * ハンドラー登録オプション
 */
export interface RegisterHandlersOptions {
  io: Server<ClientToServerEvents, ServerToClientEvents>;
  processManager: ProcessManager;
  repositories: GitRepository[];
  reposDir: string;
  projectRoot: string;
  clientActiveRepositories: Map<string, string>;
  loadExistingRepos: () => Promise<void>;
  // 逆インデックス対応のヘルパー関数
  setClientActiveRepository: (socketId: string, repositoryPath: string) => void;
  removeClientActiveRepository: (socketId: string) => void;
}

/**
 * 全てのSocket.IOイベントハンドラーを登録
 */
export function registerAllHandlers(
  socket: TypedSocket,
  options: RegisterHandlersOptions
): void {
  const {
    io,
    processManager,
    repositories,
    reposDir,
    projectRoot,
    clientActiveRepositories,
    loadExistingRepos,
    setClientActiveRepository,
    removeClientActiveRepository,
  } = options;

  // ハンドラーコンテキストを作成
  const ctx: HandlerContext = {
    io,
    socket,
    processManager,
    repositories,
    reposDir,
    clientActiveRepositories,
    loadExistingRepos,
    setClientActiveRepository,
    removeClientActiveRepository,
  };

  // クライアントの初期化
  setClientActiveRepository(socket.id, '');

  // 全リポジトリ・worktree から id-mapping を構築して送信
  void emitIdMappingTo(socket, repositories);

  // 各ハンドラーを登録
  registerRepositoryHandlers(ctx);
  registerAiSessionHandlers(ctx);
  registerTerminalHandlers(ctx);
  registerBranchHandlers(ctx);
  registerPromptQueueHandlers(ctx);
  registerMiscHandlers(ctx, projectRoot);
  registerFileHandlers(ctx);
  registerDiffHandlers(ctx);
  registerHooksHandlers(ctx);
  registerPluginHandlers(ctx, projectRoot);
  registerFileViewerHandlers(ctx);
  registerWebPushHandlers(ctx);
  registerCustomAiButtonHandlers(ctx);

  // 切断時のクリーンアップ
  socket.on('disconnect', () => {
    removeClientActiveRepository(socket.id);
  });
}
