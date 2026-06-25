import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { ensureSpawnHelperExecutable } from './utils/node-pty-repair.js';

// プロジェクトルートの.envファイルを読み込み
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '../../..');
dotenv.config({ path: path.join(projectRoot, '.env'), override: true });

// node-pty の spawn-helper が x ビット欠落で配布されている問題への対策。
// postinstall でも当てるが、ここでも自己修復しておく（別 Node で再 install された場合や
// CI で postinstall がスキップされた場合に備える）。node-pty を import する前に実行する。
for (const fixed of ensureSpawnHelperExecutable()) {
  console.log(`[node-pty] chmod 0755: ${fixed}`);
}

import express from 'express';
import { createServer } from 'http';
import { createServer as createHttpsServer } from 'https';
import { Server } from 'socket.io';
import cors from 'cors';
import { promises as fs } from 'fs';
import type { Server as HttpServer } from 'http';
import type { Server as HttpsServer } from 'https';

import type {
  AiProvider,
  AiOutputLine,
  GitRepository,
  ServerToClientEvents,
  ClientToServerEvents,
} from './types/index.js';
import { ProcessManager } from './process-manager.js';
import * as CodeServerManager from './code-server.js';
import { registerAllHandlers } from './handlers/index.js';
import { isPathSafe } from './handlers/file-viewer-handlers.js';
import {
  findRepositoryRoot,
  getWorktreeInfo,
  getMainRepoPath,
} from './utils/git-utils.js';
import {
  setWorktreeSortOrderManager,
  setWorktreeMemoManager,
} from './handlers/branch-handlers.js';
import { registerTerminalRoutes } from './handlers/terminal-handlers.js';
import { registerMcpRoutes } from './handlers/mcp-handlers.js';
import * as mcpActions from './services/mcp-actions.js';
import { ActionError } from './services/mcp-actions.js';
import { getMcpPort } from './utils/clean-env.js';
import { stripAnsi } from './utils/strip-ansi.js';
import {
  repositoryIdManager,
  initRepositoryIdManager,
} from './services/repository-id-manager.js';
import { fileManager } from './services/file-manager.js';
import { registerFileRoutes } from './handlers/file-upload-handlers.js';
import { PersistenceService } from './services/persistence-service.js';
import { getCertificates } from './services/cert-service.js';
import {
  initWebPushService,
  getWebPushService,
} from './services/web-push-service.js';

const app = express();

// サーバーインスタンス（startServerで初期化）
let server: HttpServer | HttpsServer = createServer(app);
let isHttps = false;
let rootCaFilePath: string | null = null;

// CORS設定: 全オリジン許可（リクエスト元をそのまま反映）
const CORS_ORIGIN = true;

// Socket.IOサーバーの設定（サーバーは後からattach）
const io = new Server<ClientToServerEvents, ServerToClientEvents>({
  cors: {
    origin: CORS_ORIGIN,
    methods: ['GET', 'POST'],
    credentials: true,
  },
  pingTimeout: 60000,
  pingInterval: 25000,
  perMessageDeflate: {
    threshold: 0,
  },
});

// クライアントのアクティブリポジトリを追跡
const clientActiveRepositories = new Map<string, string>(); // socketId -> repositoryPath
// 逆インデックス: repositoryPath -> Set<socketId> (O(1)ルックアップ用)
const repositoryToSocketIds = new Map<string, Set<string>>();

// クライアントのアクティブリポジトリを設定（両方のマップを更新）
function setClientActiveRepository(
  socketId: string,
  repositoryPath: string
): void {
  // 以前のリポジトリがあれば逆インデックスから削除
  const previousRepo = clientActiveRepositories.get(socketId);
  if (previousRepo) {
    const socketIds = repositoryToSocketIds.get(previousRepo);
    if (socketIds) {
      socketIds.delete(socketId);
      if (socketIds.size === 0) {
        repositoryToSocketIds.delete(previousRepo);
      }
    }
  }

  // 新しいリポジトリを設定
  clientActiveRepositories.set(socketId, repositoryPath);

  // 逆インデックスに追加
  let socketIds = repositoryToSocketIds.get(repositoryPath);
  if (!socketIds) {
    socketIds = new Set();
    repositoryToSocketIds.set(repositoryPath, socketIds);
  }
  socketIds.add(socketId);
}

// クライアントのアクティブリポジトリを削除（両方のマップを更新）
function removeClientActiveRepository(socketId: string): void {
  const repositoryPath = clientActiveRepositories.get(socketId);
  if (repositoryPath) {
    const socketIds = repositoryToSocketIds.get(repositoryPath);
    if (socketIds) {
      socketIds.delete(socketId);
      if (socketIds.size === 0) {
        repositoryToSocketIds.delete(repositoryPath);
      }
    }
  }
  clientActiveRepositories.delete(socketId);
}

// リポジトリに関連するクライアントにのみイベントを送信するヘルパー関数
// O(k): kはリポジトリに関連するクライアント数
function emitToRepositoryClients<K extends keyof ServerToClientEvents>(
  repositoryPath: string,
  eventName: K,
  data: Parameters<ServerToClientEvents[K]>[0]
): void {
  const socketIds = repositoryToSocketIds.get(repositoryPath);
  if (!socketIds) {
    return;
  }

  for (const socketId of socketIds) {
    const targetSocket = io.sockets.sockets.get(socketId);
    if (targetSocket) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (targetSocket.emit as any)(eventName, data);
    }
  }
}

// 親リポジトリを共有する全クライアント（親自身＋配下の全worktree）にイベントを送信
// 開発サーバーポートのように「どのworktreeを開いていても全worktree分を見せたい」用途に使う
function emitToParentScopedClients<K extends keyof ServerToClientEvents>(
  repositoryPath: string,
  eventName: K,
  data: Parameters<ServerToClientEvents[K]>[0]
): void {
  const parent = getMainRepoPath(repositoryPath);
  for (const [repoPath, socketIds] of repositoryToSocketIds) {
    if (getMainRepoPath(repoPath) !== parent) continue;
    for (const socketId of socketIds) {
      const targetSocket = io.sockets.sockets.get(socketId);
      if (targetSocket) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (targetSocket.emit as any)(eventName, data);
      }
    }
  }
}

function broadcastRepoProcessStatuses(): void {
  const repositoryData = repositories.map((repo) => ({
    path: repo.path,
    rid: repositoryIdManager.getId(repo.path),
  }));
  const statuses = processManager.getAllRepositoriesProcessStatus(repositoryData);
  io.emit('repos-process-status', { statuses });
}

// グローバル状態
let repositories: GitRepository[] = [];

// HTTPS/HTTP 切り替えフラグ
const USE_HTTPS = process.env.DC_USE_HTTPS !== 'false';

// 環境変数からリポジトリディレクトリを取得（デフォルト: repositories）
const repositoriesDir = process.env.DC_REPOSITORIES_DIR || 'repositories';
const REPOS_DIR = path.isAbsolute(repositoriesDir)
  ? repositoriesDir
  : path.join(process.cwd(), repositoriesDir);
const WORKTREES_DIR = path.resolve(REPOS_DIR, '..', '.dokodemo-worktrees');
const PROCESSES_DIR = path.join(projectRoot, 'processes');

// repositoryIdManager をモジュール読み込み時点で初期化（他モジュールが import 直後に使えるように）
initRepositoryIdManager(REPOS_DIR, WORKTREES_DIR);

// プロセス管理インスタンス
const processManager = new ProcessManager(PROCESSES_DIR);
// ワークツリータブの並び順を addWorktreeIds が適用できるよう注入
setWorktreeSortOrderManager(processManager.worktreeSortOrderManager);
// ワークツリーのメモを addWorktreeIds が同梱できるよう注入
setWorktreeMemoManager(processManager.worktreeMemoManager);

const persistenceService = new PersistenceService(PROCESSES_DIR);

// Web Push通知サービスの初期化
const webPushService = initWebPushService(persistenceService);
webPushService.initialize().catch((err) => {
  console.error('Web Push通知サービスの初期化に失敗:', err);
});

// Expressの設定
app.use(
  cors({
    origin: CORS_ORIGIN,
    credentials: true,
  })
);
app.use(express.json());

// ファイルアップロードREST APIルートを登録
registerFileRoutes(app, io);

// 証明書配信エンドポイント（端末で証明書インストール用）
// ルートCA証明書を配信（端末の信頼ストアに登録することで全サイト信頼可能）
// HTTPSモード時のみ登録
if (USE_HTTPS) {
  app.get('/api/cert', (_req, res) => {
    if (!rootCaFilePath) {
      res.status(404).json({
        error:
          'ルートCA証明書が設定されていません。.env で DC_HTTPS_ROOT_CA_PATH を設定してください。',
      });
      return;
    }
    res.setHeader('Content-Type', 'application/x-x509-ca-cert');
    res.setHeader('Content-Disposition', 'attachment; filename="rootCA.crt"');
    res.sendFile(rootCaFilePath);
  });
}

// 拡張子→Content-Typeマッピング（メディアファイル用）
const MEDIA_CONTENT_TYPES: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.bmp': 'image/bmp',
  '.ico': 'image/x-icon',
  '.svg': 'image/svg+xml',
  '.avif': 'image/avif',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mov': 'video/quicktime',
  '.ogg': 'video/ogg',
};

// ファイルビュワー: メディアファイル配信REST APIエンドポイント
app.get('/api/repos/:rid/raw/:filePath(*)', (req, res) => {
  const { rid, filePath } = req.params;

  if (!filePath) {
    res.status(400).json({ error: 'ファイルパスが必要です' });
    return;
  }

  const repoPath = repositoryIdManager.getPath(rid);
  if (!repoPath) {
    res.status(404).json({ error: 'リポジトリが見つかりません' });
    return;
  }

  // パストラバーサル防止
  if (!isPathSafe(repoPath, filePath)) {
    res.status(403).json({ error: '無効なパスです' });
    return;
  }

  const fullPath = path.resolve(repoPath, filePath);
  const ext = path.extname(filePath).toLowerCase();
  const contentType = MEDIA_CONTENT_TYPES[ext] || 'application/octet-stream';

  res.setHeader('Content-Type', contentType);
  res.sendFile(fullPath, (err: Error | undefined) => {
    if (err && !res.headersSent) {
      res.status(404).json({ error: 'ファイルが見つかりません' });
    }
  });
});

// リポジトリ一覧REST API
app.get('/api/repositories', async (req, res) => {
  await loadExistingRepos();
  const reposWithRid = repositories.map((repo) => ({
    ...repo,
    rid: repositoryIdManager.getId(repo.path),
  }));
  res.json({ repositories: reposWithRid });
});

// パスからridを取得するREST API
app.get('/api/repository-id', (req, res) => {
  const repoPath = req.query.path as string;

  if (!repoPath) {
    res.status(400).json({ error: 'path parameter is required' });
    return;
  }

  const rid = repositoryIdManager.tryGetId(repoPath);

  if (rid) {
    res.json({ path: repoPath, rid });
  } else {
    res.status(404).json({ error: 'Repository not found', path: repoPath });
  }
});

/**
 * transcriptファイル（JSONL形式）から会話サマリーを抽出する
 * @param transcriptPath transcriptファイルのパス
 * @returns lastUserCommand: 最後のユーザー指示, lastOutput: 最後のClaude出力
 */
async function extractSummaryFromTranscript(transcriptPath: string): Promise<{
  lastUserCommand: string | undefined;
  lastOutput: string | undefined;
}> {
  let content: string;
  try {
    content = await fs.readFile(transcriptPath, 'utf-8');
  } catch (error) {
    // フック発火時点で transcript 書き込みがまだ完了していないケースがあるため、短い待機後に一度だけリトライ
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      await new Promise((resolve) => setTimeout(resolve, 300));
      try {
        content = await fs.readFile(transcriptPath, 'utf-8');
      } catch (retryError) {
        if ((retryError as NodeJS.ErrnoException).code !== 'ENOENT') {
          console.error('transcriptファイルの読み込みに失敗:', retryError);
        }
        return { lastUserCommand: undefined, lastOutput: undefined };
      }
    } else {
      console.error('transcriptファイルの読み込みに失敗:', error);
      return { lastUserCommand: undefined, lastOutput: undefined };
    }
  }

  const lines = content.trim().split('\n');

  let lastUserCommand: string | undefined;
  let lastOutput: string | undefined;

  // 各行をパースして、userとassistantのテキストメッセージを収集
  for (const line of lines) {
    if (!line.trim()) continue;

    try {
      const entry = JSON.parse(line);

      // userタイプのメッセージからテキストを抽出
      if (entry.type === 'user' && entry.message?.content) {
        const textContent = entry.message.content
          .filter(
            (c: { type: string; text?: string }) =>
              c.type === 'text' && c.text
          )
          .map((c: { type: string; text: string }) => c.text)
          .join('\n');
        if (textContent) {
          lastUserCommand = textContent;
        }
      }

      // assistantタイプのメッセージからテキストを抽出
      if (entry.type === 'assistant' && entry.message?.content) {
        const textContent = entry.message.content
          .filter(
            (c: { type: string; text?: string }) =>
              c.type === 'text' && c.text
          )
          .map((c: { type: string; text: string }) => c.text)
          .join('\n');
        if (textContent) {
          lastOutput = textContent;
        }
      }
    } catch {
      // 無効なJSON行はスキップ
      continue;
    }
  }

  if (lastOutput && lastOutput.length > 500) {
    lastOutput = lastOutput.slice(0, 500) + '...';
  }

  return { lastUserCommand, lastOutput };
}

/**
 * AI出力履歴からセッションのやりとりを抽出する
 * @param history AI出力履歴
 * @returns lastUserCommand: 最後のユーザー指示, lastOutput: 最後のClaude出力
 */
function extractConversationSummary(history: AiOutputLine[]): {
  lastUserCommand: string | undefined;
  lastOutput: string | undefined;
} {
  if (!history || history.length === 0) {
    return { lastUserCommand: undefined, lastOutput: undefined };
  }

  // 履歴を逆順でスキャン
  let lastOutput: string | undefined;
  let lastUserCommand: string | undefined;

  // 最後の数十行からClaudeの出力とユーザーコマンドを抽出
  const recentHistory = history.slice(-100);

  // 履歴を結合してコンテキストを分析
  const combinedContent = recentHistory
    .map((line) => stripAnsi(line.content))
    .join('\n');

  // ユーザー入力を検出するパターン（Claude CLIの典型的なプロンプト）
  // 「> 」で始まる行や、明らかなユーザー入力を検出
  const userInputPatterns = [
    /^>\s+(.+)$/gm, // "> " で始まる行（Claude CLIのプロンプト）
    /^User:\s*(.+)$/gim, // "User:" で始まる行
    /^Human:\s*(.+)$/gim, // "Human:" で始まる行
  ];

  // 最後のユーザー入力を探す
  for (const pattern of userInputPatterns) {
    const matches = [...combinedContent.matchAll(pattern)];
    if (matches.length > 0) {
      const lastMatch = matches[matches.length - 1];
      lastUserCommand = lastMatch[1]?.trim();
      break;
    }
  }

  // 最後の出力（最新の内容から意味のあるテキストを抽出）
  // 空白行やシステムメッセージを除外
  const meaningfulLines = recentHistory
    .filter((line) => {
      const content = stripAnsi(line.content).trim();
      // 空行、プロンプト行、システムメッセージを除外
      return (
        content.length > 0 &&
        !content.startsWith('>') &&
        !content.startsWith('$') &&
        !content.match(/^=== .+ ===$/) &&
        line.type !== 'system'
      );
    })
    .map((line) => stripAnsi(line.content).trim());

  if (meaningfulLines.length > 0) {
    // 最後の数行を取得して応答サマリーとする
    const lastLines = meaningfulLines.slice(-5);
    lastOutput = lastLines.join('\n');
  }

  return { lastUserCommand, lastOutput };
}

// Hook統計情報
const hookStats = {
  received: 0,
  processed: 0,
  ignored: 0,
  errors: 0,
  lastReceived: null as Date | null,
  lastProcessed: null as Date | null,
};

// Web Push 通知対象イベントの絵文字定義。
// ここに載っていないイベントは通知しない（UserPromptSubmit など内部ステータス遷移専用のイベントが
// 誤って通知されるのを防ぐためのホワイトリスト）。
const NOTIFICATION_EVENT_EMOJIS: Record<string, string> = {
  Stop: '✅',
  AskUserQuestion: '❓',
  PlanApprovalWaiting: '📋',
  PermissionRequest: '🔐',
};

// AI Hook共通処理関数
async function handleAiHookEvent(
  hookProvider: AiProvider,
  body: { event?: string; metadata?: Record<string, unknown>; transcript_path?: string; cwd?: string; session_id?: string }
): Promise<void> {
  try {
    const { event, metadata, transcript_path, cwd, session_id } = body;

    if (!event || typeof event !== 'string') return;

    const supportedEvents = ['Stop', 'UserPromptSubmit', 'AskUserQuestion', 'PlanApprovalWaiting', 'PermissionRequest'];
    if (!supportedEvents.includes(event)) {
      hookStats.ignored++;
      return;
    }

    // session_id から instance / repositoryPath を解決
    let instance = session_id
      ? processManager.aiSessionManager.getInstanceBySessionId(session_id)
      : undefined;
    let repositoryPath: string | null = instance?.repositoryPath ?? null;

    // フォールバック: cwd からリポジトリルートを探索（インスタンス特定不可の hook）
    if (!repositoryPath) {
      const workingDir = cwd || (metadata?.cwd as string | undefined);
      if (!workingDir) {
        hookStats.ignored++;
        return;
      }
      repositoryPath = await findRepositoryRoot(workingDir);

      // 解決できた場合はプライマリインスタンスを引っ張ってフォールバック扱い
      if (repositoryPath) {
        const primary = processManager.aiSessionManager.getPrimaryInstance(repositoryPath);
        if (primary && primary.provider === hookProvider) {
          instance = primary;
        }
      }
    }

    if (!repositoryPath || (!repositoryPath.startsWith(REPOS_DIR) && !repositoryPath.startsWith(WORKTREES_DIR))) {
      hookStats.ignored++;
      return;
    }

    if (instance) {
      processManager.setAiExecutionStatus(
        instance.instanceId,
        event === 'Stop' ? 'completed' : 'running'
      );
    }

    const repositoryName = path.basename(repositoryPath);
    const instanceLabel = instance?.displayName
      ? ` - ${instance.displayName}`
      : '';

    let lastUserCommand: string | undefined;
    let lastOutput: string | undefined;

    if (transcript_path) {
      const summary = await extractSummaryFromTranscript(transcript_path);
      lastUserCommand = summary.lastUserCommand;
      lastOutput = summary.lastOutput;
    } else if (instance) {
      const outputHistory = processManager.aiSessionManager.getOutputHistory(instance.instanceId);
      const summary = extractConversationSummary(outputHistory);
      lastUserCommand = summary.lastUserCommand;
      lastOutput = summary.lastOutput;
    }

    // Web Push通知を送信（ホワイトリストに載っているイベントのみ）
    const wpService = getWebPushService();
    const shouldNotify = event in NOTIFICATION_EVENT_EMOJIS;
    if (wpService && shouldNotify) {
      const emoji = NOTIFICATION_EVENT_EMOJIS[event];
      const title = repositoryName
        ? `${emoji} [${repositoryName}${instanceLabel}]`
        : emoji;

      const bodyParts: string[] = [];
      if (lastUserCommand) bodyParts.push(`🔧 ${lastUserCommand.slice(0, 150)}`);
      if (lastOutput) bodyParts.push(`💬 ${lastOutput.slice(0, 150)}`);
      const notificationBody = bodyParts.join('\n\n');

      const notificationUrl = repositoryPath
        ? `/?repo=${encodeURIComponent(repositoryPath)}`
        : '/';

      wpService
        .sendNotification({
          title,
          body: notificationBody,
          url: notificationUrl,
          eventType: event as 'Stop' | 'AskUserQuestion' | 'PlanApprovalWaiting' | 'PermissionRequest',
        })
        .catch((err) => {
          console.error('Web Push通知の送信に失敗:', err);
        });
    }

    // Stop イベントは「プライマリのインスタンス」のみキューを進める
    if (event === 'Stop' && instance?.isPrimary) {
      await processManager.triggerQueueFromHook(repositoryPath, instance.provider);
    }

    hookStats.processed++;
    hookStats.lastProcessed = new Date();
  } catch (error) {
    hookStats.errors++;
    console.error(`❌ Hook処理エラー:`, error);
    console.error(`❌ スタックトレース:`, error instanceof Error ? error.stack : 'N/A');
  }
}

// Hook APIリクエストのバリデーション
function validateHookRequest(req: express.Request, res: express.Response): boolean {
  const contentType = req.headers['content-type'];
  if (!contentType || !contentType.includes('application/json')) {
    hookStats.errors++;
    res.status(415).json({ status: 'error', message: 'Invalid Content-Type: application/json is required' });
    return false;
  }
  if (!req.body || typeof req.body !== 'object') {
    hookStats.errors++;
    res.status(400).json({ status: 'error', message: 'Invalid request: body is required' });
    return false;
  }
  const { event, metadata } = req.body;
  if (!event || typeof event !== 'string' || event.trim().length === 0) {
    hookStats.errors++;
    res.status(400).json({ status: 'error', message: 'Invalid request: event field is required and must be a non-empty string' });
    return false;
  }
  if (metadata !== undefined && (typeof metadata !== 'object' || metadata === null)) {
    hookStats.errors++;
    res.status(400).json({ status: 'error', message: 'Invalid request: metadata must be an object if provided' });
    return false;
  }
  return true;
}

// Claude Code Hook API エンドポイント
app.post('/hook/claude-event', (req, res) => {
  hookStats.received++;
  hookStats.lastReceived = new Date();
  if (!validateHookRequest(req, res)) return;
  res.status(202).json({ status: 'accepted', message: 'Hook received, processing in background' });
  setImmediate(() => handleAiHookEvent('claude', req.body));
});

// Codex Hook API エンドポイント
app.post('/hook/codex-event', (req, res) => {
  hookStats.received++;
  hookStats.lastReceived = new Date();
  if (!validateHookRequest(req, res)) return;
  res.status(202).json({ status: 'accepted', message: 'Hook received, processing in background' });
  setImmediate(() => handleAiHookEvent('codex', req.body));
});

// GETメソッドや他の許可されていないメソッドでのエラーハンドリング
for (const hookPath of ['/hook/claude-event', '/hook/codex-event']) {
  app.get(hookPath, (_req, res) => {
    res.status(405).json({ status: 'error', message: 'Method Not Allowed: Only POST method is supported', allowedMethods: ['POST'] });
  });
  app.all(hookPath, (req, res) => {
    if (req.method !== 'POST' && req.method !== 'GET') {
      res.status(405).json({ status: 'error', message: `Method Not Allowed: ${req.method} method is not supported`, allowedMethods: ['POST'] });
    }
  });
}

// Hook統計情報取得エンドポイント
app.get('/api/hook-stats', (req, res) => {
  res.json({
    ...hookStats,
    lastReceived: hookStats.lastReceived?.toISOString() || null,
    lastProcessed: hookStats.lastProcessed?.toISOString() || null,
  });
});

// ============================================
// プロンプトキュー REST API エンドポイント
// ============================================

// キューに単一アイテム追加
app.post('/api/queue/add', async (req, res) => {
  try {
    const { repositoryPath, provider, prompt, sendClearBefore, isAutoCommit, model } = req.body;
    if (!repositoryPath || !provider || !prompt) {
      res.status(400).json({ success: false, message: 'repositoryPath, provider, prompt は必須です' });
      return;
    }
    const item = await processManager.addToPromptQueue(repositoryPath, provider, prompt, sendClearBefore, isAutoCommit, model);
    res.json({ success: true, item });
  } catch (error) {
    console.error('[REST API] キュー追加エラー:', error);
    res.status(500).json({ success: false, message: String(error) });
  }
});

// キューに複数アイテム一括追加
app.post('/api/queue/add-batch', async (req, res) => {
  try {
    const { repositoryPath, provider, items } = req.body;
    if (!repositoryPath || !provider || !Array.isArray(items)) {
      res.status(400).json({ success: false, message: 'repositoryPath, provider, items（配列）は必須です' });
      return;
    }
    const addedItems = [];
    for (const item of items) {
      const added = await processManager.addToPromptQueue(
        repositoryPath, provider, item.prompt,
        item.sendClearBefore, item.isAutoCommit, item.model
      );
      addedItems.push(added);
    }
    res.json({ success: true, items: addedItems });
  } catch (error) {
    console.error('[REST API] キュー一括追加エラー:', error);
    res.status(500).json({ success: false, message: String(error) });
  }
});

// キュー状態取得
app.get('/api/queue/status', (req, res) => {
  try {
    const repositoryPath = req.query.repositoryPath as string;
    const provider = req.query.provider as string;
    if (!repositoryPath || !provider) {
      res.status(400).json({ success: false, message: 'repositoryPath, provider クエリパラメータは必須です' });
      return;
    }
    const state = processManager.getPromptQueueState(repositoryPath, provider as AiProvider);
    if (!state) {
      res.json({ success: true, queue: [], isProcessing: false, isPaused: false });
      return;
    }
    res.json({ success: true, ...state });
  } catch (error) {
    console.error('[REST API] キュー状態取得エラー:', error);
    res.status(500).json({ success: false, message: String(error) });
  }
});

// キューアイテム更新
app.put('/api/queue/:itemId', async (req, res) => {
  try {
    const { itemId } = req.params;
    const { repositoryPath, provider, prompt, sendClearBefore, isAutoCommit, model } = req.body;
    if (!repositoryPath || !provider) {
      res.status(400).json({ success: false, message: 'repositoryPath, provider は必須です' });
      return;
    }
    const success = await processManager.updatePromptQueue(
      repositoryPath, provider as AiProvider, itemId, prompt, sendClearBefore, isAutoCommit, model
    );
    res.json({ success });
  } catch (error) {
    console.error('[REST API] キューアイテム更新エラー:', error);
    res.status(500).json({ success: false, message: String(error) });
  }
});

// キューアイテム削除（DELETEのbody問題回避のためPOST）
app.post('/api/queue/remove/:itemId', async (req, res) => {
  try {
    const { itemId } = req.params;
    const { repositoryPath, provider } = req.body;
    if (!repositoryPath || !provider) {
      res.status(400).json({ success: false, message: 'repositoryPath, provider は必須です' });
      return;
    }
    const success = await processManager.removeFromPromptQueue(repositoryPath, provider as AiProvider, itemId);
    res.json({ success });
  } catch (error) {
    console.error('[REST API] キューアイテム削除エラー:', error);
    res.status(500).json({ success: false, message: String(error) });
  }
});

// キュー全クリア
app.post('/api/queue/clear-all', async (req, res) => {
  try {
    const { repositoryPath, provider } = req.body;
    if (!repositoryPath || !provider) {
      res.status(400).json({ success: false, message: 'repositoryPath, provider は必須です' });
      return;
    }
    await processManager.clearPromptQueue(repositoryPath, provider as AiProvider);
    res.json({ success: true });
  } catch (error) {
    console.error('[REST API] キュークリアエラー:', error);
    res.status(500).json({ success: false, message: String(error) });
  }
});

// キュー並べ替え
app.post('/api/queue/reorder', async (req, res) => {
  try {
    const { repositoryPath, provider, queue } = req.body;
    if (!repositoryPath || !provider || !Array.isArray(queue)) {
      res.status(400).json({ success: false, message: 'repositoryPath, provider, queue（配列）は必須です' });
      return;
    }
    await processManager.reorderPromptQueue(repositoryPath, provider as AiProvider, queue);
    res.json({ success: true });
  } catch (error) {
    console.error('[REST API] キュー並べ替えエラー:', error);
    res.status(500).json({ success: false, message: String(error) });
  }
});

// キュー一時停止
app.post('/api/queue/pause', async (req, res) => {
  try {
    const { repositoryPath, provider } = req.body;
    if (!repositoryPath || !provider) {
      res.status(400).json({ success: false, message: 'repositoryPath, provider は必須です' });
      return;
    }
    await processManager.pausePromptQueue(repositoryPath, provider as AiProvider);
    res.json({ success: true });
  } catch (error) {
    console.error('[REST API] キュー一時停止エラー:', error);
    res.status(500).json({ success: false, message: String(error) });
  }
});

// キュー再開
app.post('/api/queue/resume', async (req, res) => {
  try {
    const { repositoryPath, provider } = req.body;
    if (!repositoryPath || !provider) {
      res.status(400).json({ success: false, message: 'repositoryPath, provider は必須です' });
      return;
    }
    await processManager.resumePromptQueue(repositoryPath, provider as AiProvider);
    res.json({ success: true });
  } catch (error) {
    console.error('[REST API] キュー再開エラー:', error);
    res.status(500).json({ success: false, message: String(error) });
  }
});

// ============================================
// ワークツリー REST API エンドポイント
// ============================================

// MCP ツールと共有するアクション層への依存。repositories は再代入されるため getter で渡す。
const actionDeps: mcpActions.ActionDeps = {
  processManager,
  io,
  getRepositories: () => repositories,
};

// アクション層の ActionError を HTTP レスポンスへ変換する。
// 想定外の例外は 500 で包む（REST 既存挙動の踏襲）。
function handleActionError(res: express.Response, error: unknown): void {
  if (error instanceof ActionError) {
    res.status(error.status).json({ success: false, message: error.message });
    return;
  }
  console.error('[REST API] アクション実行エラー:', error);
  res.status(500).json({ success: false, message: String(error) });
}

// ワークツリー一覧を取得（:rid は親 or worktree。getMainRepoPath で親へ正規化）
app.get('/api/worktrees/:rid', async (req, res) => {
  try {
    res.json(await mcpActions.listWorktrees(req.params.rid));
  } catch (error) {
    handleActionError(res, error);
  }
});

// ワークツリーを作成（:rid は親 or worktree。getMainRepoPath で親へ正規化）
app.post('/api/worktree/:rid', async (req, res) => {
  try {
    const { branchName, description, baseBranch, useExistingBranch, syncEntries } =
      req.body ?? {};
    const result = await mcpActions.createWorktreeAction(
      req.params.rid,
      { branchName, description, baseBranch, useExistingBranch, syncEntries },
      actionDeps
    );
    res.status(201).json(result);
  } catch (error) {
    handleActionError(res, error);
  }
});

// ワークツリーを削除（:rid は削除対象 worktree の wtid）
app.delete('/api/worktree/:rid', async (req, res) => {
  try {
    const result = await mcpActions.deleteWorktreeAction(
      req.params.rid,
      { deleteBranch: req.body?.deleteBranch === true },
      actionDeps
    );
    res.json(result);
  } catch (error) {
    handleActionError(res, error);
  }
});

// ワークツリーのメモを取得（:rid は worktree の wtid）
app.get('/api/worktree/:rid/memo', async (req, res) => {
  try {
    res.json(await mcpActions.getWorktreeMemo(req.params.rid, actionDeps));
  } catch (error) {
    handleActionError(res, error);
  }
});

// ワークツリーのメモを更新（:rid は worktree の wtid、body は { memo: string }）
app.put('/api/worktree/:rid/memo', async (req, res) => {
  try {
    const { memo } = req.body ?? {};
    res.json(await mcpActions.setWorktreeMemo(req.params.rid, memo, actionDeps));
  } catch (error) {
    handleActionError(res, error);
  }
});

// プロンプト一斉送信（親 rid 配下の全 or 指定ワークツリーへ同一プロンプトを投入）
app.post('/api/prompt/broadcast', async (req, res) => {
  try {
    const { rid, provider, prompt, targets, includeMain, sendClearBefore, isAutoCommit, model } =
      req.body ?? {};
    const result = await mcpActions.broadcastPrompt(
      { rid, provider, prompt, targets, includeMain, sendClearBefore, isAutoCommit, model },
      actionDeps
    );
    res.json(result);
  } catch (error) {
    handleActionError(res, error);
  }
});

// ターミナル操作 REST API ルートを登録
registerTerminalRoutes(app, processManager);

// ============================================
// フロントエンド (dist) 配信 — DC_MODE=prod のときだけ有効
// ============================================
// 本番運用 (npm run start) では Express が apps/dokodemo-claude-web/dist を静的配信する。
// vite build --watch が dist を継続再生成するので、API と同一プロセス・同一ポートで完結する。
// dev (npm run dev) では Vite dev server が dist を経由せず HMR つきで配信するため、ここでは無効化。
if (process.env.DC_MODE === 'prod') {
  const WEB_DIST_PATH = path.join(projectRoot, 'apps/dokodemo-claude-web/dist');

  app.use(
    express.static(WEB_DIST_PATH, {
      setHeaders: (res, filePath) => {
        if (filePath.endsWith('index.html')) {
          res.setHeader('Cache-Control', 'no-cache');
        } else if (filePath.includes(`${path.sep}assets${path.sep}`)) {
          res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
        }
      },
    })
  );

  // SPA フォールバック: index.html を返す（/api, /hook, /socket.io は前段で処理済み）
  app.get('*', (req, res, next) => {
    if (
      req.path.startsWith('/api') ||
      req.path.startsWith('/hook') ||
      req.path.startsWith('/socket.io')
    ) {
      return next();
    }
    const indexPath = path.join(WEB_DIST_PATH, 'index.html');
    fs.access(indexPath).then(
      () => {
        res.setHeader('Cache-Control', 'no-cache');
        res.sendFile(indexPath);
      },
      () => {
        // dist 未生成時の暫定ページ（5 秒後に自動リロード）
        res
          .status(503)
          .setHeader('Cache-Control', 'no-store')
          .setHeader('Content-Type', 'text/html; charset=utf-8')
          .send(
            '<!doctype html><html lang="ja"><head><meta charset="utf-8">' +
              '<title>dokodemo-claude (起動中)</title>' +
              '<meta http-equiv="refresh" content="5">' +
              '<style>body{font-family:system-ui;background:#0a0a0a;color:#eee;display:flex;align-items:center;justify-content:center;height:100vh;margin:0}p{font-size:1.1rem}</style>' +
              '</head><body><p>ビルド中… 5 秒後に自動でリロードします。</p></body></html>'
          );
      }
    );
  });
}

// リポジトリディレクトリの作成
async function ensureReposDir(): Promise<void> {
  try {
    await fs.access(REPOS_DIR);
  } catch {
    await fs.mkdir(REPOS_DIR, { recursive: true });
  }
}

// 既存リポジトリの読み込み
async function loadExistingRepos(): Promise<void> {
  try {
    const entries = await fs.readdir(REPOS_DIR, { withFileTypes: true });
    repositories = entries
      .filter(
        (entry) => entry.isDirectory() && entry.name !== '.dokodemo-worktrees'
      )
      .map((entry) => {
        const repoPath = path.join(REPOS_DIR, entry.name);
        const worktreeInfo = getWorktreeInfo(repoPath);
        return {
          name: entry.name,
          path: repoPath,
          url: '',
          status: 'ready' as const,
          ...worktreeInfo,
        };
      });
  } catch {
    repositories = [];
  }
}

// ProcessManagerのイベントハンドラー設定
processManager.on('ai-output', (data) => {
  const rid = repositoryIdManager.tryGetId(data.repositoryPath) || '';

  // ダッシュボードは複数 worktree の出力を同時に購読する必要があるため、
  // 親リポジトリを共有する全クライアントへ配信する（通常表示側は rid で
  // フィルタするので無関係な worktree の出力は無視される）。
  emitToParentScopedClients(data.repositoryPath, 'ai-output-line', {
    rid,
    instanceId: data.instanceId,
    provider: data.provider,
    outputLine: data.outputLine,
  });
});

processManager.on('ai-exit', (data) => {
  const providerName =
    data.provider === 'claude' ? 'Claude Code CLI' : 'Codex CLI';
  const rid = repositoryIdManager.tryGetId(data.repositoryPath) || '';
  const exitMessage = `\n=== ${providerName} 終了 (code: ${data.exitCode}, signal: ${data.signal}) ===\n`;

  emitToParentScopedClients(data.repositoryPath, 'ai-output-line', {
    rid,
    instanceId: data.instanceId,
    provider: data.provider,
    outputLine: {
      id: `exit-${data.sessionId}-${Date.now()}`,
      content: exitMessage,
      timestamp: Date.now(),
      type: 'system',
      provider: data.provider,
    },
  });
});

// AI インスタンス系イベント: 全クライアントに broadcast（タブ構成共有）
processManager.on('ai-instance-created', (data) => {
  const rid = repositoryIdManager.tryGetId(data.instance.repositoryPath) || '';
  io.emit('ai-instance-created', { rid, instance: data.instance });
});

processManager.on('ai-instance-updated', (data) => {
  const rid = repositoryIdManager.tryGetId(data.instance.repositoryPath) || '';
  io.emit('ai-instance-updated', { rid, instance: data.instance });
});

processManager.on('ai-instance-closed', (data: { instanceId: string; repositoryPath: string }) => {
  const rid = repositoryIdManager.tryGetId(data.repositoryPath) || '';
  io.emit('ai-instance-closed', { rid, instanceId: data.instanceId });
});

processManager.on('prompt-queue-updated', (data) => {
  const rid = repositoryIdManager.tryGetId(data.repositoryPath);
  emitToRepositoryClients(data.repositoryPath, 'prompt-queue-updated', {
    ...data,
    rid,
  });
});

processManager.on('prompt-queue-processing-started', (data) => {
  const rid = repositoryIdManager.tryGetId(data.repositoryPath);
  emitToRepositoryClients(
    data.repositoryPath,
    'prompt-queue-processing-started',
    { ...data, rid }
  );
});

processManager.on('prompt-queue-processing-completed', (data) => {
  if (!data.success) {
    const primary = processManager.aiSessionManager.getPrimaryInstance(
      data.repositoryPath
    );
    if (primary) {
      processManager.setAiExecutionStatus(primary.instanceId, 'idle');
    }
  }
  const rid = repositoryIdManager.tryGetId(data.repositoryPath);
  emitToRepositoryClients(
    data.repositoryPath,
    'prompt-queue-processing-completed',
    { ...data, rid }
  );
});

processManager.on('ai-execution-status-changed', () => {
  broadcastRepoProcessStatuses();
});

processManager.on('selected-provider-changed', () => {
  broadcastRepoProcessStatuses();
});

processManager.on('ai-session-created', (session) => {
  const rid = repositoryIdManager.tryGetId(session.repositoryPath) || '';
  emitToRepositoryClients(session.repositoryPath, 'ai-session-created', {
    rid,
    instanceId: session.instanceId,
    sessionId: session.sessionId,
    provider: session.provider,
  });
});

processManager.on('terminal-created', (terminal) => {
  const rid = repositoryIdManager.tryGetId(terminal.repositoryPath);
  emitToRepositoryClients(terminal.repositoryPath, 'terminal-created', {
    id: terminal.id,
    name: terminal.name,
    cwd: terminal.repositoryPath,
    rid,
    status: terminal.status,
    pid: terminal.pid,
    createdAt: terminal.createdAt,
  });
});

processManager.on('terminal-output', (data) => {
  emitToRepositoryClients(data.repositoryPath, 'terminal-output', {
    terminalId: data.terminalId,
    type: data.type,
    data: data.data,
    timestamp: data.timestamp,
  });
});

processManager.on('terminal-exit', (data) => {
  emitToRepositoryClients(data.repositoryPath, 'terminal-closed', {
    terminalId: data.terminalId,
  });
});

processManager.on('terminal-ports', (data) => {
  // 親リポジトリを共有する全クライアントへ配信（worktree を切り替えずに全worktree分を見せる）
  emitToParentScopedClients(data.repositoryPath, 'terminal-ports', {
    repositoryPath: data.repositoryPath,
    rid: repositoryIdManager.tryGetId(data.repositoryPath),
    ports: data.ports,
  });
});

// Socket.IOイベントハンドラ
io.on('connection', (socket) => {
  // イベントハンドラー登録を非同期で実行（接続応答を高速化）
  setImmediate(() => {
    registerAllHandlers(socket, {
      io,
      processManager,
      repositories,
      reposDir: REPOS_DIR,
      projectRoot,
      clientActiveRepositories,
      loadExistingRepos,
      setClientActiveRepository,
      removeClientActiveRepository,
    });
  });
});

// サーバー起動
// DC_MODE=prod のとき: Web (dist) + API + WebSocket を 1 ポート (DC_PROD_PORT) で統合配信
// それ以外: dev 用に DC_API_PORT のみで listen し、Web は Vite dev server が別ポートで配信
const IS_PROD = process.env.DC_MODE === 'prod';
const PORT = IS_PROD
  ? parseInt(process.env.DC_PROD_PORT || '8000', 10)
  : parseInt(process.env.DC_API_PORT || '8001', 10);
const HOST = process.env.DC_HOST || '0.0.0.0';

async function startServer(): Promise<void> {
  await ensureReposDir();
  await loadExistingRepos();

  // HTTPSフラグに応じてサーバーを作成
  if (USE_HTTPS) {
    const certInfo = await getCertificates();
    if (!certInfo) {
      console.error('❌ HTTPSモードですが証明書が読み込めませんでした。');
      console.error('   .env で以下の環境変数を設定してください:');
      console.error('     DC_HTTPS_CERT_PATH=/絶対パス/server.crt');
      console.error('     DC_HTTPS_KEY_PATH=/絶対パス/server.key');
      console.error(
        '   または .env で DC_USE_HTTPS=false に設定して HTTPモードで起動してください。'
      );
      process.exit(1);
    }
    server = createHttpsServer({ cert: certInfo.cert, key: certInfo.key }, app);
    isHttps = true;
    rootCaFilePath = certInfo.rootCaPath;
  } else {
    server = createServer(app);
    isHttps = false;
  }

  // Socket.IOサーバーをアタッチ
  io.attach(server);

  // ProcessManagerの初期化
  await processManager.initialize();

  // FileManagerの初期化
  await fileManager.initialize();

  // code-serverの自動起動
  try {
    await CodeServerManager.startCodeServer();
  } catch (error) {
    console.error('⚠️  code-serverの起動に失敗しました:', error);
  }

  server.listen(PORT, HOST, () => {
    const protocol = isHttps ? 'https' : 'http';
    const mode = IS_PROD ? 'prod (web+api)' : 'dev (api only)';
    console.log(`Server started on ${protocol}://${HOST}:${PORT} [${mode}]`);
  });

  // MCP（Streamable HTTP）は loopback 限定の専用 HTTP サーバで提供する。
  // メインサーバが HTTPS（自己署名）でも MCP は常に http://127.0.0.1 で繋がるようにし、
  // クライアントの証明書検証問題を回避する。127.0.0.1 バインドで外部からは到達不能。
  const mcpApp = express();
  mcpApp.use(express.json());
  registerMcpRoutes(mcpApp, actionDeps);
  const mcpPort = getMcpPort();
  createServer(mcpApp).listen(mcpPort, '127.0.0.1', () => {
    console.log(`MCP server started on http://127.0.0.1:${mcpPort}/mcp`);
  });
}

// プロセス終了時のクリーンアップ
const gracefulShutdown = async (signal: string) => {
  console.log(`${signal} received. Shutting down server...`);

  try {
    await processManager.shutdown();
  } catch (err) {
    console.error('processManager shutdown error:', err);
  }

  try {
    await CodeServerManager.stopCodeServer();
    console.log('code-server stopped');
  } catch {
    // code-serverが起動していない場合は無視
  }

  process.exit(0);
};

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

startServer().catch(() => {
  // Startup error
});
