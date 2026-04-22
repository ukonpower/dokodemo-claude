import { Server, Socket } from 'socket.io';
import type {
  ServerToClientEvents,
  ClientToServerEvents,
  GitRepository,
} from '../types/index.js';
import { ProcessManager } from '../process-manager.js';

/**
 * Socket.IO サーバーの型
 */
export type TypedServer = Server<ClientToServerEvents, ServerToClientEvents>;

/**
 * Socket.IO ソケットの型
 */
export type TypedSocket = Socket<ClientToServerEvents, ServerToClientEvents>;

/**
 * ハンドラーコンテキスト
 */
export interface HandlerContext {
  io: TypedServer;
  socket: TypedSocket;
  processManager: ProcessManager;
  repositories: GitRepository[];
  reposDir: string;
  clientActiveRepositories: Map<string, string>;
  loadExistingRepos: () => Promise<void>;
  // 逆インデックス対応のヘルパー関数
  setClientActiveRepository: (socketId: string, repositoryPath: string) => void;
  removeClientActiveRepository: (socketId: string) => void;
}
