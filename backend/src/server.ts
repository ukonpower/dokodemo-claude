import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

// プロジェクトルートの.envファイルを読み込み
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '../..');
dotenv.config({ path: path.join(projectRoot, '.env'), override: true });

import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import { spawn } from 'child_process';
import { promises as fs } from 'fs';

import type {
  GitRepository,
  GitBranch,
  ServerToClientEvents,
  ClientToServerEvents,
} from './types/index.js';
import { ProcessManager } from './process-manager.js';

const app = express();
const server = createServer(app);

// CORS設定を環境変数から取得
const CORS_ORIGIN = process.env.DC_CORS_ORIGIN || '*';

// Socket.IOサーバーの設定
const io = new Server<ClientToServerEvents, ServerToClientEvents>(server, {
  cors: {
    origin: CORS_ORIGIN,
    methods: ['GET', 'POST'],
    credentials: true,
  },
});

// クライアントのアクティブリポジトリを追跡
const clientActiveRepositories = new Map<string, string>(); // socketId -> repositoryPath

// グローバル状態
let repositories: GitRepository[] = [];

// 環境変数からリポジトリディレクトリを取得（デフォルト: repositories）
const repositoriesDir = process.env.DC_REPOSITORIES_DIR || 'repositories';
const REPOS_DIR = path.isAbsolute(repositoriesDir)
  ? repositoriesDir
  : path.join(process.cwd(), repositoriesDir);
const PROCESSES_DIR = path.join(process.cwd(), 'processes');

// プロセス管理インスタンス
const processManager = new ProcessManager(PROCESSES_DIR);

// エディタの存在確認
type EditorType = 'vscode' | 'cursor';

interface EditorInfo {
  id: EditorType;
  name: string;
  command: string;
  available: boolean;
}

const EDITORS: Omit<EditorInfo, 'available'>[] = [
  { id: 'vscode', name: 'VSCode', command: 'code' },
  { id: 'cursor', name: 'Cursor', command: 'cursor' },
];

/**
 * コマンドが利用可能かチェック
 */
async function checkCommandAvailable(command: string): Promise<boolean> {
  return new Promise((resolve) => {
    const whichProcess = spawn('which', [command]);

    whichProcess.on('close', (code) => {
      resolve(code === 0);
    });

    whichProcess.on('error', () => {
      resolve(false);
    });
  });
}

/**
 * 利用可能なエディタリストを取得
 */
async function getAvailableEditors(): Promise<EditorInfo[]> {
  const results = await Promise.all(
    EDITORS.map(async (editor) => {
      const available = await checkCommandAvailable(editor.command);
      return { ...editor, available };
    })
  );
  return results;
}

// Expressの設定
app.use(
  cors({
    origin: CORS_ORIGIN,
    credentials: true,
  })
);
app.use(express.json());

// Claude Code Hook API エンドポイント
app.post('/hook/claude-event', async (req, res) => {
  // Hook event received

  try {
    const { event, metadata } = req.body;

    // 自走モードでサポートするイベントかチェック
    if (!['Stop'].includes(event)) {
      res.json({
        status: 'ignored',
        message: 'Event not supported for auto-mode',
      });
      return;
    }

    // metadataからリポジトリパスを特定
    const cwd = metadata?.cwd;
    if (!cwd || !cwd.startsWith(REPOS_DIR)) {
      res.json({
        status: 'ignored',
        message: 'Event not in managed repository',
      });
      return;
    }

    // 自走モードが有効かチェック
    const autoModeState = processManager.getAutoModeState(cwd);
    if (!autoModeState || !autoModeState.isRunning) {
      res.json({
        status: 'ignored',
        message: 'Auto-mode not running for this repository',
      });
      return;
    }

    // 自走モードの次のアクションをトリガー
    processManager.triggerAutoModeFromHook(cwd);

    res.json({
      status: 'success',
      message: 'Auto-mode triggered',
    });
  } catch (error) {
    // Hook processing error
    res.status(500).json({
      status: 'error',
      message: String(error),
    });
  }
});

// リポジトリディレクトリの作成
async function ensureReposDir(): Promise<void> {
  try {
    await fs.access(REPOS_DIR);
    console.log(`📁 リポジトリディレクトリを使用: ${REPOS_DIR}`);
  } catch {
    await fs.mkdir(REPOS_DIR, { recursive: true });
    console.log(`📁 リポジトリディレクトリを作成: ${REPOS_DIR}`);
  }
}

// 既存リポジトリの読み込み
async function loadExistingRepos(): Promise<void> {
  try {
    const entries = await fs.readdir(REPOS_DIR, { withFileTypes: true });
    repositories = entries
      .filter((entry) => entry.isDirectory())
      .map((entry) => ({
        name: entry.name,
        path: path.join(REPOS_DIR, entry.name),
        url: '',
        status: 'ready' as const,
      }));
  } catch {
    repositories = [];
  }
}

// package.jsonからnpmスクリプトを取得
async function getNpmScripts(
  repoPath: string
): Promise<Record<string, string>> {
  try {
    const packageJsonPath = path.join(repoPath, 'package.json');
    const packageJsonContent = await fs.readFile(packageJsonPath, 'utf-8');
    const packageJson = JSON.parse(packageJsonContent);
    return packageJson.scripts || {};
  } catch {
    // package.jsonが存在しない、または読み取れない場合は空のオブジェクトを返す
    return {};
  }
}

// ブランチ一覧を取得
async function getBranches(repoPath: string): Promise<GitBranch[]> {
  return new Promise((resolve) => {
    const gitProcess = spawn('git', ['branch', '-a'], { cwd: repoPath });
    let output = '';

    gitProcess.stdout.on('data', (data) => {
      output += data.toString();
    });

    gitProcess.on('exit', (code) => {
      if (code !== 0) {
        resolve([]);
        return;
      }

      const branches: GitBranch[] = [];
      const lines = output.split('\n').filter((line) => line.trim());

      lines.forEach((line) => {
        const trimmedLine = line.trim();
        const isCurrent = trimmedLine.startsWith('*');
        const branchName = trimmedLine
          .replace(/^\*?\s+/, '')
          .replace(/^remotes\//, '');

        // リモートブランチは remotes/origin/ で始まる
        if (branchName.startsWith('origin/')) {
          // リモートブランチ（origin/HEADは除外）
          if (!branchName.includes('HEAD')) {
            branches.push({
              name: branchName.replace('origin/', ''),
              current: false,
              remote: 'origin',
            });
          }
        } else {
          // ローカルブランチ
          branches.push({
            name: branchName,
            current: isCurrent,
            remote: undefined,
          });
        }
      });

      // 重複を除去（ローカルブランチを優先）
      const uniqueBranches: GitBranch[] = [];
      const branchNames = new Set<string>();

      // まずローカルブランチを追加
      branches
        .filter((b) => !b.remote)
        .forEach((branch) => {
          uniqueBranches.push(branch);
          branchNames.add(branch.name);
        });

      // リモートブランチのうち、ローカルに存在しないものを追加
      branches
        .filter((b) => b.remote && !branchNames.has(b.name))
        .forEach((branch) => {
          uniqueBranches.push(branch);
        });

      resolve(uniqueBranches);
    });
  });
}

// ブランチを切り替え
async function switchBranch(
  repoPath: string,
  branchName: string
): Promise<{ success: boolean; message: string }> {
  return new Promise((resolve) => {
    const gitProcess = spawn('git', ['checkout', branchName], {
      cwd: repoPath,
    });
    let output = '';
    let errorOutput = '';

    gitProcess.stdout.on('data', (data) => {
      output += data.toString();
    });

    gitProcess.stderr.on('data', (data) => {
      errorOutput += data.toString();
    });

    gitProcess.on('exit', (code) => {
      if (code === 0) {
        resolve({
          success: true,
          message: `ブランチ「${branchName}」に切り替えました`,
        });
      } else {
        resolve({
          success: false,
          message: `ブランチ切り替えエラー: ${errorOutput || output}`,
        });
      }
    });
  });
}

// ProcessManagerのイベントハンドラー設定
processManager.on('ai-output', (data) => {
  // アクティブリポジトリが一致するクライアントのみに送信
  for (const [socketId, activeRepo] of clientActiveRepositories.entries()) {
    if (activeRepo === data.repositoryPath) {
      const targetSocket = io.sockets.sockets.get(socketId);
      if (targetSocket) {
        targetSocket.emit('claude-raw-output', {
          type: data.type,
          content: data.content,
          sessionId: data.sessionId,
          repositoryPath: data.repositoryPath,
          provider: data.provider, // プロバイダー情報を追加
        });
      }
    }
  }
});

// 後方互換性用のClaude出力イベント
processManager.on('claude-output', (data) => {
  // アクティブリポジトリが一致するクライアントのみに送信
  for (const [socketId, activeRepo] of clientActiveRepositories.entries()) {
    if (activeRepo === data.repositoryPath) {
      const targetSocket = io.sockets.sockets.get(socketId);
      if (targetSocket) {
        targetSocket.emit('claude-raw-output', {
          type: data.type,
          content: data.content,
          sessionId: data.sessionId,
          repositoryPath: data.repositoryPath,
        });
      }
    }
  }
});

processManager.on('ai-exit', (data) => {
  // アクティブリポジトリが一致するクライアントのみに送信
  for (const [socketId, activeRepo] of clientActiveRepositories.entries()) {
    if (activeRepo === data.repositoryPath) {
      const targetSocket = io.sockets.sockets.get(socketId);
      if (targetSocket) {
        const providerName =
          data.provider === 'claude' ? 'Claude Code CLI' : 'Codex CLI';
        targetSocket.emit('claude-raw-output', {
          type: 'system',
          content: `\n=== ${providerName} 終了 (code: ${data.exitCode}, signal: ${data.signal}) ===\n`,
          sessionId: data.sessionId,
          repositoryPath: data.repositoryPath,
          provider: data.provider,
        });
      }
    }
  }
});

processManager.on('claude-exit', (data) => {
  // アクティブリポジトリが一致するクライアントのみに送信
  for (const [socketId, activeRepo] of clientActiveRepositories.entries()) {
    if (activeRepo === data.repositoryPath) {
      const targetSocket = io.sockets.sockets.get(socketId);
      if (targetSocket) {
        targetSocket.emit('claude-raw-output', {
          type: 'system',
          content: `\n=== Claude Code CLI 終了 (code: ${data.exitCode}, signal: ${data.signal}) ===\n`,
          sessionId: data.sessionId,
          repositoryPath: data.repositoryPath,
        });
      }
    }
  }
});

processManager.on('automode-waiting', (data) => {
  io.emit('automode-waiting', data);
});

processManager.on('ai-session-created', (session) => {
  io.emit('ai-session-created', {
    sessionId: session.sessionId,
    repositoryPath: session.repositoryPath,
    repositoryName: session.repositoryName,
    provider: session.provider,
  });
  // 後方互換性のため、Claude セッションの場合は既存のイベントも発行
  if (session.provider === 'claude') {
    io.emit('claude-session-created', {
      sessionId: session.sessionId,
      repositoryPath: session.repositoryPath,
      repositoryName: session.repositoryName,
    });
  }
});

processManager.on('claude-session-created', (session) => {
  io.emit('claude-session-created', {
    sessionId: session.id,
    repositoryPath: session.repositoryPath,
    repositoryName: session.repositoryName,
  });
});

processManager.on('terminal-created', (terminal) => {
  io.emit('terminal-created', {
    id: terminal.id,
    name: terminal.name,
    cwd: terminal.repositoryPath,
    status: terminal.status,
    pid: terminal.pid,
    createdAt: terminal.createdAt,
  });
});

processManager.on('terminal-output', (data) => {
  io.emit('terminal-output', {
    terminalId: data.terminalId,
    type: data.type,
    data: data.data,
    timestamp: data.timestamp,
  });
});

processManager.on('terminal-exit', (data) => {
  io.emit('terminal-closed', { terminalId: data.terminalId });
});

// ReviewServerStartedイベントのハンドラ
processManager.on('reviewServerStarted', (data) => {
  // 全てのクライアントに差分チェックサーバー開始を通知
  // ブラウザベースのURLに変換するため、localhostを現在のホストに置き換える
  const server = { ...data.server };
  if (server.url && server.url.includes('localhost')) {
    // フロントエンドでwindow.location.hostを使用してURLを構築するため、
    // ここではlocalhostのままにしておく（フロントエンドで動的に置換される）
  }

  io.emit('review-server-started', data);
});

// Socket.IOイベントハンドラ
io.on('connection', (socket) => {
  // クライアントの初期化（アクティブリポジトリなし）
  clientActiveRepositories.set(socket.id, '');

  // 利用可能なエディタリストの取得
  socket.on('get-available-editors', async () => {
    const editors = await getAvailableEditors();
    socket.emit('available-editors', { editors });
  });

  // リポジトリ一覧の送信
  socket.on('list-repos', () => {
    socket.emit('repos-list', { repos: repositories });
  });

  // リポジトリの削除
  socket.on('delete-repo', async (data) => {
    const { path: repoPath, name } = data;

    try {
      // リポジトリがリストに存在するかチェック
      const repoIndex = repositories.findIndex((r) => r.path === repoPath);
      if (repoIndex === -1) {
        socket.emit('repo-deleted', {
          success: false,
          message: `リポジトリ「${name}」が見つかりません`,
          path: repoPath,
        });
        return;
      }

      // ディレクトリの削除
      await fs.rm(repoPath, { recursive: true, force: true });

      // リストから削除
      repositories.splice(repoIndex, 1);

      // 関連するプロセスをクリーンアップ
      await processManager.cleanupRepositoryProcesses(repoPath);

      socket.emit('repo-deleted', {
        success: true,
        message: `リポジトリ「${name}」を削除しました`,
        path: repoPath,
      });

      // 更新されたリポジトリリストを送信
      socket.emit('repos-list', { repos: repositories });
    } catch {
      socket.emit('repo-deleted', {
        success: false,
        message: `リポジトリ削除エラー`,
        path: repoPath,
      });
    }
  });

  // リポジトリのクローン
  socket.on('clone-repo', async (data) => {
    const { url, name } = data;
    const repoPath = path.join(REPOS_DIR, name);

    try {
      // 既存のリポジトリチェック
      const existingRepo = repositories.find((r) => r.name === name);
      if (existingRepo) {
        socket.emit('repo-cloned', {
          success: false,
          message: `リポジトリ「${name}」は既に存在します`,
        });
        return;
      }

      // 新しいリポジトリをリストに追加
      const newRepo: GitRepository = {
        name,
        url,
        path: repoPath,
        status: 'cloning',
      };
      repositories.push(newRepo);
      socket.emit('repos-list', { repos: repositories });

      // gitクローン実行
      const gitProcess = spawn('git', ['clone', url, repoPath]);

      // タイムアウト設定（10分）
      const cloneTimeout = setTimeout(() => {
        gitProcess.kill('SIGTERM');
        const repo = repositories.find((r) => r.name === name);
        if (repo) {
          repo.status = 'error';
          socket.emit('repo-cloned', {
            success: false,
            message: `リポジトリ「${name}」のクローンがタイムアウトしました`,
          });
          socket.emit('repos-list', { repos: repositories });
        }
      }, 600000); // 10分

      gitProcess.on('exit', (code) => {
        clearTimeout(cloneTimeout);
        const repo = repositories.find((r) => r.name === name);
        if (repo) {
          if (code === 0) {
            repo.status = 'ready';
            socket.emit('repo-cloned', {
              success: true,
              message: `リポジトリ「${name}」のクローンが完了しました`,
              repo,
            });
          } else {
            repo.status = 'error';
            socket.emit('repo-cloned', {
              success: false,
              message: `リポジトリ「${name}」のクローンに失敗しました`,
            });
          }
          socket.emit('repos-list', { repos: repositories });
        }
      });
    } catch {
      socket.emit('repo-cloned', {
        success: false,
        message: `クローンエラー`,
      });
    }
  });

  // 新規リポジトリの作成 (git init)
  socket.on('create-repo', async (data) => {
    const { name } = data;
    const repoPath = path.join(REPOS_DIR, name);

    try {
      // 既存のリポジトリチェック
      const existingRepo = repositories.find((r) => r.name === name);
      if (existingRepo) {
        socket.emit('repo-created', {
          success: false,
          message: `リポジトリ「${name}」は既に存在します`,
        });
        return;
      }

      // ディレクトリ作成
      await fs.mkdir(repoPath, { recursive: true });

      // 新しいリポジトリをリストに追加
      const newRepo: GitRepository = {
        name,
        url: '',
        path: repoPath,
        status: 'creating',
      };
      repositories.push(newRepo);
      socket.emit('repos-list', { repos: repositories });

      // git init実行
      const gitInitProcess = spawn('git', ['init'], { cwd: repoPath });

      // タイムアウト設定（30秒）
      const initTimeout = setTimeout(() => {
        gitInitProcess.kill('SIGTERM');
        const repo = repositories.find((r) => r.name === name);
        if (repo) {
          repo.status = 'error';
          socket.emit('repo-created', {
            success: false,
            message: `リポジトリ「${name}」の作成がタイムアウトしました`,
          });
          socket.emit('repos-list', { repos: repositories });
        }
      }, 30000); // 30秒

      gitInitProcess.on('exit', (code) => {
        clearTimeout(initTimeout);
        const repo = repositories.find((r) => r.name === name);
        if (repo) {
          if (code === 0) {
            repo.status = 'ready';
            socket.emit('repo-created', {
              success: true,
              message: `リポジトリ「${name}」を作成しました`,
              repo,
            });
          } else {
            repo.status = 'error';
            socket.emit('repo-created', {
              success: false,
              message: `リポジトリ「${name}」の作成に失敗しました`,
            });
          }
          socket.emit('repos-list', { repos: repositories });
        }
      });
    } catch {
      socket.emit('repo-created', {
        success: false,
        message: `作成エラー`,
      });
    }
  });

  // リポジトリの切り替え
  socket.on('switch-repo', async (data) => {
    const { path: repoPath, provider = 'claude', initialSize } = data; // デフォルトはClaude

    // クライアントのアクティブリポジトリを更新
    clientActiveRepositories.set(socket.id, repoPath || '');

    // 空のpathの場合はリポジトリ選択モード（処理終了）
    if (!repoPath) {
      return;
    }

    try {
      // リポジトリ名を取得
      const repoName = path.basename(repoPath);

      // AI CLIセッションを取得または作成（初期サイズを渡す）
      const session = await processManager.getOrCreateAiSession(
        repoPath,
        repoName,
        provider,
        initialSize
      );

      socket.emit('repo-switched', {
        success: true,
        message: `リポジトリを切り替えました: ${repoPath} (${provider})`,
        currentPath: repoPath,
        sessionId: session.id,
      });

      // 出力履歴を送信
      try {
        const outputHistory = await processManager.getAiOutputHistory(
          repoPath,
          provider
        );
        socket.emit('ai-output-history', {
          repositoryPath: repoPath,
          history: outputHistory,
          provider: provider,
        });

        // 後方互換性のため、Claudeの場合は既存のイベントも送信
        if (provider === 'claude') {
          const claudeHistory = outputHistory.map((line) => ({
            id: line.id,
            content: line.content,
            timestamp: line.timestamp,
            type: line.type,
          }));
          socket.emit('claude-output-history', {
            repositoryPath: repoPath,
            history: claudeHistory,
          });
        }
      } catch {
        // Failed to get output history
      }
    } catch {
      socket.emit('repo-switched', {
        success: false,
        message: `リポジトリの切り替えに失敗しました`,
        currentPath: '',
      });
    }
  });

  // AI CLIへのコマンド送信
  socket.on('send-command', (data) => {
    const { command, sessionId, repositoryPath, provider = 'claude' } = data;

    let targetSessionId = sessionId;

    // sessionIdが指定されていない場合、repositoryPathから取得
    if (!targetSessionId && repositoryPath) {
      const session = processManager.getAiSessionByRepository(
        repositoryPath,
        provider
      );
      if (session) {
        targetSessionId = session.id;
      } else {
        // 後方互換性のためClaude セッションも確認
        const claudeSession =
          processManager.getClaudeSessionByRepository(repositoryPath);
        if (claudeSession) {
          targetSessionId = claudeSession.id;
        }
      }
    }

    if (!targetSessionId) {
      const providerName = provider === 'claude' ? 'Claude CLI' : 'Codex CLI';
      socket.emit('claude-raw-output', {
        type: 'system',
        content: `${providerName}セッションが開始されていません。リポジトリを選択してください。\n`,
        provider: provider,
      });
      return;
    }

    // ProcessManagerを通じてコマンドを送信
    let commandToSend = command;

    // 特殊キーや単一文字の場合はそのまま送信（改行を追加しない）
    if (
      command.startsWith('\x1b[') || // 方向キー（ANSIエスケープシーケンス）
      command === '\x1b' || // ESCキー
      command === '\r' || // Enterキー
      command === '\x03' || // Ctrl+C
      command === '\x7f' || // Backspace
      command === '\t' || // Tab
      (command.length === 1 && !command.match(/[\r\n]/))
    ) {
      // 単一文字（改行以外）
      // そのまま送信（改行を追加しない）
      commandToSend = command;
    } else {
      // 複数文字のコマンドの場合のみエンターキーを追加
      commandToSend = command + '\r';

      // Claude CLIでは実行確定のためもう一度エンターキーが必要（複数文字コマンドの場合のみ）
      // Codex CLIでは必要に応じて調整
      if (provider === 'claude') {
        setTimeout(() => {
          processManager.sendToAiSession(targetSessionId, '\r');
        }, 100); // 100ms後に実行確定
      }
    }

    // まずAI セッションで試行
    let success = processManager.sendToAiSession(
      targetSessionId,
      commandToSend
    );
    if (!success) {
      // 後方互換性のためClaude セッションでも試行
      success = processManager.sendToClaudeSession(
        targetSessionId,
        commandToSend
      );
    }

    if (!success) {
      socket.emit('claude-raw-output', {
        type: 'system',
        content: `CLIセッションエラー: セッション ${targetSessionId} が見つかりません\n`,
        provider: provider,
      });
    }
  });

  // AI CLIへのCtrl+C中断送信
  socket.on('ai-interrupt', (data) => {
    const { sessionId, repositoryPath, provider = 'claude' } = data || {};

    let targetSessionId = sessionId;

    // sessionIdが指定されていない場合、repositoryPathから取得
    if (!targetSessionId && repositoryPath) {
      const session = processManager.getAiSessionByRepository(
        repositoryPath,
        provider
      );
      if (session) {
        targetSessionId = session.id;
      }
    }

    if (!targetSessionId) {
      const providerName = provider === 'claude' ? 'Claude CLI' : 'Codex CLI';
      socket.emit('claude-raw-output', {
        type: 'system',
        content: `${providerName}セッションが開始されていません。\n`,
        provider: provider,
      });
      return;
    }

    // Ctrl+C (SIGINT)を送信
    const success = processManager.sendSignalToAiSession(
      targetSessionId,
      '\x03'
    );
    if (!success) {
      socket.emit('claude-raw-output', {
        type: 'system',
        content: `CLIセッションエラー: セッション ${targetSessionId} が見つかりません\n`,
        provider: provider,
      });
    }
  });

  // Claude CLIへのCtrl+C中断送信（後方互換性用）
  // ai-interruptロジックに委譲
  socket.on('claude-interrupt', (data) => {
    const { sessionId, repositoryPath } = data || {};

    let targetSessionId = sessionId;

    // sessionIdが指定されていない場合、repositoryPathから取得
    if (!targetSessionId && repositoryPath) {
      const session = processManager.getAiSessionByRepository(
        repositoryPath,
        'claude'
      );
      if (session) {
        targetSessionId = session.id;
      } else {
        // 後方互換性のためClaude セッションも確認
        const claudeSession =
          processManager.getClaudeSessionByRepository(repositoryPath);
        if (claudeSession) {
          targetSessionId = claudeSession.id;
        }
      }
    }

    if (!targetSessionId) {
      socket.emit('claude-raw-output', {
        type: 'system',
        content: 'Claude CLIセッションが開始されていません。\n',
      });
      return;
    }

    // Ctrl+C (SIGINT)を送信
    const success = processManager.sendSignalToAiSession(
      targetSessionId,
      '\x03'
    );
    if (!success) {
      socket.emit('claude-raw-output', {
        type: 'system',
        content: `Claude CLIセッションエラー: セッション ${targetSessionId} が見つかりません\n`,
      });
    }
  });

  // AI CLI履歴の取得
  socket.on('get-ai-history', async (data) => {
    const { repositoryPath, provider } = data;

    if (!repositoryPath || !provider) {
      return;
    }

    try {
      // 指定されたリポジトリとプロバイダーの出力履歴を取得
      const outputHistory = await processManager.getAiOutputHistory(
        repositoryPath,
        provider
      );

      socket.emit('ai-output-history', {
        repositoryPath,
        history: outputHistory,
        provider: provider,
      });
    } catch {
      socket.emit('ai-output-history', {
        repositoryPath,
        history: [],
        provider: provider,
      });
    }
  });

  // Claude CLI履歴の取得（後方互換性用）
  socket.on('get-claude-history', async (data) => {
    const { repositoryPath } = data;

    if (!repositoryPath) {
      return;
    }

    try {
      // 指定されたリポジトリの出力履歴を取得
      const outputHistory =
        await processManager.getOutputHistory(repositoryPath);

      socket.emit('claude-output-history', {
        repositoryPath,
        history: outputHistory,
      });
    } catch {
      socket.emit('claude-output-history', {
        repositoryPath,
        history: [],
      });
    }
  });

  // Claude CLI出力履歴のクリア
  socket.on('clear-claude-output', async (data) => {
    const { repositoryPath } = data;

    if (!repositoryPath) {
      return;
    }

    try {
      const success =
        await processManager.clearClaudeOutputHistory(repositoryPath);
      if (success) {
        // クリア完了を通知（オプション）
        socket.emit('claude-output-cleared', {
          repositoryPath,
          success: true,
        });
      }
    } catch {
      // エラーは無視（フロントエンド側ではすでに表示がクリアされている）
    }
  });

  // AI出力履歴のクリア（新形式）
  socket.on('clear-ai-output', async (data) => {
    const { repositoryPath, provider } = data;
    if (!repositoryPath || !provider) {
      return;
    }
    try {
      const success = await processManager.clearAiOutputHistory(
        repositoryPath,
        provider
      );
      if (success) {
        // クリア完了を通知
        socket.emit('ai-output-cleared', {
          repositoryPath,
          provider,
          success: true,
        });
      }
    } catch {
      // エラーは無視（フロントエンド側ではすでに表示がクリアされている）
    }
  });

  // AI CLIの再起動
  socket.on('restart-ai-cli', async (data) => {
    const { repositoryPath, provider, initialSize } = data;
    if (!repositoryPath || !provider) {
      return;
    }

    try {
      // リポジトリ名を取得
      const repoName = path.basename(repositoryPath);

      // 強制再起動でセッションを再作成（初期サイズも渡す）
      const session = await processManager.ensureAiSession(
        repositoryPath,
        repoName,
        provider,
        { forceRestart: true, initialSize }
      );

      const providerName = provider === 'claude' ? 'Claude CLI' : 'Codex CLI';

      // 再起動完了を通知（新しいセッションIDを含む）
      socket.emit('ai-restarted', {
        success: true,
        message: `${providerName}を再起動しました`,
        repositoryPath,
        provider,
        sessionId: session.id,
      });

      socket.emit('claude-raw-output', {
        type: 'system',
        content: `\n=== ${providerName}を再起動しました ===\n`,
        repositoryPath,
        provider,
      });
    } catch {
      const providerName = provider === 'claude' ? 'Claude CLI' : 'Codex CLI';

      socket.emit('ai-restarted', {
        success: false,
        message: `${providerName}の再起動に失敗しました`,
        repositoryPath,
        provider,
      });

      socket.emit('claude-raw-output', {
        type: 'system',
        content: `\n=== ${providerName}の再起動に失敗しました ===\n`,
        repositoryPath,
        provider,
      });
    }
  });

  // ターミナル関連のイベントハンドラ

  // ターミナル一覧の送信
  socket.on('list-terminals', async (data) => {
    const { repositoryPath } = data || {};
    let terminals;

    if (repositoryPath) {
      // 特定のリポジトリのターミナルのみ取得
      terminals = processManager.getTerminalsByRepository(repositoryPath);
    } else {
      // 全てのターミナルを取得
      terminals = processManager.getAllTerminals();
    }

    socket.emit('terminals-list', {
      terminals: terminals.map((terminal) => ({
        id: terminal.id,
        name: terminal.name,
        cwd: terminal.repositoryPath,
        status: terminal.status,
        pid: terminal.pid,
        createdAt: terminal.createdAt,
      })),
    });

    // 各ターミナルの出力履歴を順次送信（確実に送信するため）
    for (const terminal of terminals) {
      try {
        const history = await processManager.getTerminalOutputHistory(
          terminal.id
        );
        // 履歴が空でも送信（フロントエンド側で履歴が初期化される）
        socket.emit('terminal-output-history', {
          terminalId: terminal.id,
          history,
        });
      } catch {
        // エラーが発生しても空の履歴を送信
        socket.emit('terminal-output-history', {
          terminalId: terminal.id,
          history: [],
        });
      }
    }
  });

  // 新しいターミナルの作成
  socket.on('create-terminal', async (data) => {
    const { cwd, name, initialSize } = data;
    try {
      const repoName = path.basename(cwd);
      const terminal = await processManager.createTerminal(
        cwd,
        repoName,
        name,
        initialSize
      );

      // 新しいターミナルの出力履歴を送信（空の履歴）
      socket.emit('terminal-output-history', {
        terminalId: terminal.id,
        history: [],
      });

      // terminal-createdイベントは ProcessManager から自動的に発火される
    } catch {
      socket.emit('terminal-output', {
        terminalId: 'system',
        type: 'stderr',
        data: `ターミナル作成エラー\n`,
        timestamp: Date.now(),
      });
    }
  });

  // ターミナルへの入力送信
  socket.on('terminal-input', (data) => {
    const { terminalId, input } = data;
    const success = processManager.sendToTerminal(terminalId, input);
    if (!success) {
      socket.emit('terminal-output', {
        terminalId,
        type: 'stderr',
        data: `ターミナル入力エラー: ターミナル ${terminalId} が見つからないか、既に終了しています\n`,
        timestamp: Date.now(),
      });
    }
  });

  // ターミナルのリサイズ
  socket.on('terminal-resize', (data) => {
    const { terminalId, cols, rows } = data;
    processManager.resizeTerminal(terminalId, cols, rows);
  });

  // AI CLIのリサイズ
  socket.on('ai-resize', (data) => {
    const { repositoryPath, provider, cols, rows } = data;
    processManager.resizeAiSession(repositoryPath, provider, cols, rows);
  });

  // ターミナルへのシグナル送信（Ctrl+C, Ctrl+Z等）
  socket.on('terminal-signal', (data) => {
    const { terminalId, signal } = data;
    const success = processManager.sendSignalToTerminal(terminalId, signal);
    socket.emit('terminal-signal-sent', { terminalId, signal, success });
  });

  // ターミナルの終了
  socket.on('close-terminal', async (data) => {
    const { terminalId } = data;
    await processManager.closeTerminal(terminalId);
    // terminal-closedイベントは ProcessManager から自動的に発火される
  });

  // コマンドショートカット関連のイベントハンドラ

  // コマンドショートカット一覧の送信
  socket.on('list-shortcuts', (data) => {
    const { repositoryPath } = data;
    const shortcuts = processManager.getShortcutsByRepository(repositoryPath);
    socket.emit('shortcuts-list', { shortcuts });
  });

  // 新しいコマンドショートカットの作成
  socket.on('create-shortcut', async (data) => {
    const { name, command, repositoryPath } = data;

    try {
      const shortcut = await processManager.createShortcut(
        name,
        command,
        repositoryPath
      );
      const displayName = shortcut.name || shortcut.command;
      socket.emit('shortcut-created', {
        success: true,
        message: `コマンドショートカット「${displayName}」を作成しました`,
        shortcut,
      });

      // 更新されたショートカット一覧を送信
      const shortcuts = processManager.getShortcutsByRepository(repositoryPath);
      socket.emit('shortcuts-list', { shortcuts });
    } catch {
      socket.emit('shortcut-created', {
        success: false,
        message: `コマンドショートカット作成エラー`,
      });
    }
  });

  // コマンドショートカットの削除
  socket.on('delete-shortcut', async (data) => {
    const { shortcutId } = data;

    try {
      const success = await processManager.deleteShortcut(shortcutId);
      if (success) {
        socket.emit('shortcut-deleted', {
          success: true,
          message: 'コマンドショートカットを削除しました',
          shortcutId,
        });
      } else {
        socket.emit('shortcut-deleted', {
          success: false,
          message: 'コマンドショートカットが見つかりません',
          shortcutId,
        });
      }
    } catch {
      socket.emit('shortcut-deleted', {
        success: false,
        message: `コマンドショートカット削除エラー`,
        shortcutId,
      });
    }
  });

  // コマンドショートカットの実行
  socket.on('execute-shortcut', (data) => {
    const { shortcutId, terminalId } = data;

    const success = processManager.executeShortcut(shortcutId, terminalId);
    socket.emit('shortcut-executed', {
      success,
      message: success
        ? 'コマンドショートカットを実行しました'
        : 'コマンドショートカットの実行に失敗しました',
      shortcutId,
    });
  });

  // ブランチ関連のイベントハンドラ

  // ブランチ一覧の取得
  socket.on('list-branches', async (data) => {
    const { repositoryPath } = data;

    try {
      const branches = await getBranches(repositoryPath);
      socket.emit('branches-list', { branches, repositoryPath });
    } catch {
      socket.emit('branches-list', { branches: [], repositoryPath });
    }
  });

  // ブランチの切り替え
  socket.on('switch-branch', async (data) => {
    const { repositoryPath, branchName } = data;

    try {
      const result = await switchBranch(repositoryPath, branchName);

      if (result.success) {
        // 切り替え成功時は現在のブランチ情報も送信
        const branches = await getBranches(repositoryPath);
        const currentBranch =
          branches.find((b) => b.current)?.name || branchName;

        socket.emit('branch-switched', {
          success: true,
          message: result.message,
          currentBranch,
          repositoryPath,
        });

        // ブランチ一覧も更新して送信
        socket.emit('branches-list', { branches, repositoryPath });
      } else {
        socket.emit('branch-switched', {
          success: false,
          message: result.message,
          currentBranch: '',
          repositoryPath,
        });
      }
    } catch {
      socket.emit('branch-switched', {
        success: false,
        message: `ブランチ切り替えエラー`,
        currentBranch: '',
        repositoryPath,
      });
    }
  });

  // npmスクリプト関連のイベントハンドラ

  // npmスクリプト一覧の取得
  socket.on('get-npm-scripts', async (data) => {
    const { repositoryPath } = data;

    try {
      const scripts = await getNpmScripts(repositoryPath);
      socket.emit('npm-scripts-list', { scripts, repositoryPath });
    } catch {
      socket.emit('npm-scripts-list', { scripts: {}, repositoryPath });
    }
  });

  // npmスクリプトの実行
  socket.on('execute-npm-script', async (data) => {
    const { repositoryPath, scriptName, terminalId } = data;

    try {
      // terminalIdが指定されている場合は既存のターミナルで実行
      if (terminalId) {
        const command = `npm run ${scriptName}\r`;
        const success = processManager.sendToTerminal(terminalId, command);

        socket.emit('npm-script-executed', {
          success,
          message: success
            ? `npmスクリプト「${scriptName}」を実行しました`
            : 'ターミナルが見つかりませんでした',
          scriptName,
          terminalId,
        });
      } else {
        // 新しいターミナルを作成して実行
        const repoName = path.basename(repositoryPath);
        const terminal = await processManager.createTerminal(
          repositoryPath,
          repoName,
          `npm run ${scriptName}`
        );

        // スクリプトを実行
        setTimeout(() => {
          processManager.sendToTerminal(terminal.id, `npm run ${scriptName}\r`);
        }, 500); // ターミナル起動を待つ

        socket.emit('npm-script-executed', {
          success: true,
          message: `npmスクリプト「${scriptName}」を新しいターミナルで実行しました`,
          scriptName,
          terminalId: terminal.id,
        });
      }
    } catch {
      socket.emit('npm-script-executed', {
        success: false,
        message: `npmスクリプト実行エラー`,
        scriptName,
        terminalId,
      });
    }
  });

  // 自走モード関連のイベントハンドラ

  // 自走モード設定一覧の取得
  socket.on('get-automode-configs', (data) => {
    const { repositoryPath } = data;
    const configs =
      processManager.getAutoModeConfigsByRepository(repositoryPath);
    socket.emit('automode-configs-list', { configs });
  });

  // 新しい自走モード設定の作成
  socket.on('create-automode-config', async (data) => {
    const { name, prompt, repositoryPath, triggerMode, sendClearCommand } =
      data;

    try {
      const config = await processManager.createAutoModeConfig(
        name,
        prompt,
        repositoryPath,
        triggerMode,
        sendClearCommand
      );
      socket.emit('automode-config-created', {
        success: true,
        message: `自走モード設定「${name}」を作成しました`,
        config,
      });

      // 更新された設定一覧を送信
      const configs =
        processManager.getAutoModeConfigsByRepository(repositoryPath);
      socket.emit('automode-configs-list', { configs });
    } catch {
      socket.emit('automode-config-created', {
        success: false,
        message: `自走モード設定作成エラー`,
      });
    }
  });

  // 自走モード設定の更新
  socket.on('update-automode-config', async (data) => {
    const { id, name, prompt, isEnabled, triggerMode, sendClearCommand } = data;

    try {
      const config = await processManager.updateAutoModeConfig(id, {
        name,
        prompt,
        isEnabled,
        triggerMode,
        sendClearCommand,
      });
      if (config) {
        socket.emit('automode-config-updated', {
          success: true,
          message: `自走モード設定「${config.name}」を更新しました`,
          config,
        });

        // 更新された設定一覧を送信
        const configs = processManager.getAutoModeConfigsByRepository(
          config.repositoryPath
        );
        socket.emit('automode-configs-list', { configs });
      } else {
        socket.emit('automode-config-updated', {
          success: false,
          message: '自走モード設定が見つかりません',
        });
      }
    } catch {
      socket.emit('automode-config-updated', {
        success: false,
        message: `自走モード設定更新エラー`,
      });
    }
  });

  // 自走モード設定の削除
  socket.on('delete-automode-config', async (data) => {
    const { configId } = data;

    try {
      const success = await processManager.deleteAutoModeConfig(configId);
      if (success) {
        socket.emit('automode-config-deleted', {
          success: true,
          message: '自走モード設定を削除しました',
          configId,
        });
      } else {
        socket.emit('automode-config-deleted', {
          success: false,
          message: '自走モード設定が見つかりません',
          configId,
        });
      }
    } catch {
      socket.emit('automode-config-deleted', {
        success: false,
        message: `自走モード設定削除エラー`,
        configId,
      });
    }
  });

  // 自走モードの開始
  socket.on('start-automode', async (data) => {
    const { repositoryPath, configId } = data;

    try {
      const success = await processManager.startAutoMode(
        repositoryPath,
        configId
      );
      if (success) {
        socket.emit('automode-status-changed', {
          repositoryPath,
          isRunning: true,
          configId,
        });
      }
    } catch {
      // Failed to start automode
    }
  });

  // 自走モードの停止
  socket.on('stop-automode', async (data) => {
    const { repositoryPath } = data;

    try {
      const success = await processManager.stopAutoMode(repositoryPath);
      if (success) {
        socket.emit('automode-status-changed', {
          repositoryPath,
          isRunning: false,
        });
      }
    } catch {
      // Failed to stop automode
    }
  });

  // 自走モード状態の取得
  socket.on('get-automode-status', (data) => {
    const { repositoryPath } = data;
    const state = processManager.getAutoModeState(repositoryPath);
    const waitingStatus =
      processManager.getAutoModeWaitingStatus(repositoryPath);
    socket.emit('automode-status-changed', {
      repositoryPath,
      isRunning: state?.isRunning || false,
      configId: state?.currentConfigId,
      isWaiting: waitingStatus.isWaiting,
      remainingTime: waitingStatus.remainingTime,
    });
  });

  // 自走モードの強制実行
  socket.on('force-execute-automode', async (data) => {
    const { repositoryPath } = data;

    try {
      const success = await processManager.forceExecuteAutoMode(repositoryPath);
      if (success) {
        socket.emit('automode-force-executed', {
          repositoryPath,
          success: true,
          message: '自走モードを強制実行しました',
        });
      } else {
        socket.emit('automode-force-executed', {
          repositoryPath,
          success: false,
          message: '自走モードが実行中でないか、設定が無効です',
        });
      }
    } catch {
      socket.emit('automode-force-executed', {
        repositoryPath,
        success: false,
        message: '強制実行中にエラーが発生しました',
      });
    }
  });

  // 自走モードの手動プロンプト送信
  socket.on('send-manual-prompt', async (data) => {
    const { repositoryPath } = data;

    try {
      const success = await processManager.sendManualPrompt(repositoryPath);
      if (success) {
        socket.emit('manual-prompt-sent', {
          repositoryPath,
          success: true,
          message: 'プロンプトを送信しました',
        });
      } else {
        socket.emit('manual-prompt-sent', {
          repositoryPath,
          success: false,
          message: '自走モードが実行中でないか、設定が無効です',
        });
      }
    } catch {
      socket.emit('manual-prompt-sent', {
        repositoryPath,
        success: false,
        message: 'プロンプト送信中にエラーが発生しました',
      });
    }
  });

  // 差分チェックサーバー関連のイベントハンドラ

  // 差分チェックサーバーの開始
  socket.on('start-review-server', async (data) => {
    const { repositoryPath, diffConfig } = data;

    try {
      // startReviewServerは内部でイベントを発行するため、ここでは結果を待つだけ
      await processManager.startReviewServer(repositoryPath, diffConfig);
      // イベント送信はProcessManagerの内部で行われる（reviewServerStartedイベント）
    } catch (error) {
      socket.emit('review-server-started', {
        success: false,
        message: `差分チェックサーバーの開始に失敗しました: ${error}`,
      });
    }
  });

  // 差分チェックサーバーの停止
  socket.on('stop-review-server', async (data) => {
    const { repositoryPath } = data;

    try {
      const success = await processManager.stopReviewServer(repositoryPath);
      socket.emit('review-server-stopped', {
        success,
        message: success
          ? '差分チェックサーバーを停止しました'
          : '差分チェックサーバーが見つかりません',
        repositoryPath,
      });
    } catch (error) {
      socket.emit('review-server-stopped', {
        success: false,
        message: `差分チェックサーバーの停止に失敗しました: ${error}`,
        repositoryPath,
      });
    }
  });

  // 差分チェックサーバー一覧の取得
  socket.on('get-review-servers', () => {
    const servers = processManager.getAllReviewServers();
    socket.emit('review-servers-list', { servers });
  });

  // エディタ起動関連のイベントハンドラ
  socket.on('open-in-editor', (data) => {
    const { repositoryPath, editor } = data;

    const editorCommand = editor === 'vscode' ? 'code' : 'cursor';
    const editorName = editor === 'vscode' ? 'VSCode' : 'Cursor';

    try {
      // エディタを起動
      const editorProcess = spawn(editorCommand, [repositoryPath], {
        detached: true,
        stdio: 'ignore',
      });

      // エラーハンドリング（spawn実行後の非同期エラー）
      editorProcess.on('error', (error: NodeJS.ErrnoException) => {
        if (error.code === 'ENOENT') {
          socket.emit('editor-opened', {
            success: false,
            message: `${editorName}が見つかりません。${editorCommand}コマンドがインストールされているか確認してください。`,
            editor,
            repositoryPath,
          });
        } else {
          socket.emit('editor-opened', {
            success: false,
            message: `${editorName}の起動に失敗しました: ${error.message}`,
            editor,
            repositoryPath,
          });
        }
      });

      // プロセスを親から切り離す
      editorProcess.unref();

      socket.emit('editor-opened', {
        success: true,
        message: `${editorName}でリポジトリを開きました`,
        editor,
        repositoryPath,
      });
    } catch (error) {
      socket.emit('editor-opened', {
        success: false,
        message: `${editorName}の起動に失敗しました: ${error}`,
        editor,
        repositoryPath,
      });
    }
  });

  socket.on('disconnect', () => {
    // クライアント切断時のクリーンアップ
    clientActiveRepositories.delete(socket.id);
  });
});

// サーバー起動
const PORT = parseInt(process.env.VITE_BACKEND_PORT || '3200', 10);
const HOST = process.env.DC_HOST || '0.0.0.0';

async function startServer(): Promise<void> {
  await ensureReposDir();
  await loadExistingRepos();

  // ProcessManagerの初期化
  await processManager.initialize();

  server.listen(PORT, HOST, () => {
    console.log(`Server started on ${HOST}:${PORT}`);
  });
}

// プロセス終了時のクリーンアップ
process.on('SIGTERM', async () => {
  await processManager.shutdown();
  process.exit(0);
});

process.on('SIGINT', async () => {
  await processManager.shutdown();
  process.exit(0);
});

startServer().catch(() => {
  // Startup error
});
