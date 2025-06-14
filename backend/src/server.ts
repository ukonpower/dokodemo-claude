import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import { spawn } from 'child_process';
import { promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

import type {
  ClaudeMessage,
  GitRepository,
  ServerToClientEvents,
  ClientToServerEvents,
  ClaudeSession
} from './types/index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const server = createServer(app);

// Socket.IOサーバーの設定
const io = new Server<ClientToServerEvents, ServerToClientEvents>(server, {
  cors: {
    origin: "http://localhost:5173",
    methods: ["GET", "POST"]
  }
});

// グローバル状態
let repositories: GitRepository[] = [];
let claudeSession: ClaudeSession | null = null;
const REPOS_DIR = path.join(process.cwd(), 'repositories');

// Expressの設定
app.use(cors({
  origin: "http://localhost:5173"
}));
app.use(express.json());

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
      .filter(entry => entry.isDirectory())
      .map(entry => ({
        name: entry.name,
        path: path.join(REPOS_DIR, entry.name),
        url: '',
        status: 'ready' as const
      }));
  } catch {
    repositories = [];
  }
}

// Claude Code CLIセッションの開始
function startClaudeSession(workingDir: string): ClaudeSession {
  if (claudeSession?.isActive) {
    claudeSession.process.kill();
  }

  const claudeProcess = spawn('claude', [], {
    cwd: workingDir,
    stdio: ['pipe', 'pipe', 'pipe']
  });

  claudeSession = {
    process: claudeProcess,
    isActive: true,
    workingDirectory: workingDir
  };

  // Claude CLIの出力をクライアントに送信
  claudeProcess.stdout?.on('data', (data: Buffer) => {
    const message: ClaudeMessage = {
      id: Date.now().toString(),
      type: 'claude',
      content: data.toString(),
      timestamp: Date.now()
    };
    io.emit('claude-output', message);
  });

  claudeProcess.stderr?.on('data', (data: Buffer) => {
    const message: ClaudeMessage = {
      id: Date.now().toString(),
      type: 'system',
      content: `エラー: ${data.toString()}`,
      timestamp: Date.now()
    };
    io.emit('claude-output', message);
  });

  claudeProcess.on('exit', (code) => {
    const message: ClaudeMessage = {
      id: Date.now().toString(),
      type: 'system',
      content: `Claude CLIが終了しました (code: ${code})`,
      timestamp: Date.now()
    };
    io.emit('claude-output', message);
    
    if (claudeSession) {
      claudeSession.isActive = false;
    }
  });

  return claudeSession;
}

// Socket.IOイベントハンドラ
io.on('connection', (socket) => {
  console.log('クライアントが接続しました');

  // リポジトリ一覧の送信
  socket.on('list-repos', () => {
    socket.emit('repos-list', { repos: repositories });
  });

  // リポジトリのクローン
  socket.on('clone-repo', async (data) => {
    const { url, name } = data;
    const repoPath = path.join(REPOS_DIR, name);

    try {
      // 既存のリポジトリチェック
      const existingRepo = repositories.find(r => r.name === name);
      if (existingRepo) {
        socket.emit('repo-cloned', {
          success: false,
          message: `リポジトリ「${name}」は既に存在します`
        });
        return;
      }

      // 新しいリポジトリをリストに追加
      const newRepo: GitRepository = {
        name,
        url,
        path: repoPath,
        status: 'cloning'
      };
      repositories.push(newRepo);
      socket.emit('repos-list', { repos: repositories });

      // gitクローン実行
      const gitProcess = spawn('git', ['clone', url, repoPath]);

      gitProcess.on('exit', (code) => {
        const repo = repositories.find(r => r.name === name);
        if (repo) {
          if (code === 0) {
            repo.status = 'ready';
            socket.emit('repo-cloned', {
              success: true,
              message: `リポジトリ「${name}」のクローンが完了しました`,
              repo
            });
          } else {
            repo.status = 'error';
            socket.emit('repo-cloned', {
              success: false,
              message: `リポジトリ「${name}」のクローンに失敗しました`
            });
          }
          socket.emit('repos-list', { repos: repositories });
        }
      });

    } catch (error) {
      socket.emit('repo-cloned', {
        success: false,
        message: `クローンエラー: ${error}`
      });
    }
  });

  // リポジトリの切り替え
  socket.on('switch-repo', (data) => {
    const { path: repoPath } = data;
    
    try {
      // Claude CLIセッションを新しいディレクトリで開始
      startClaudeSession(repoPath);
      
      socket.emit('repo-switched', {
        success: true,
        message: `リポジトリを切り替えました: ${repoPath}`,
        currentPath: repoPath
      });

      // 初期メッセージの送信
      const message: ClaudeMessage = {
        id: Date.now().toString(),
        type: 'system',
        content: `Claude CLIが開始されました\n作業ディレクトリ: ${repoPath}`,
        timestamp: Date.now()
      };
      socket.emit('claude-output', message);

    } catch (error) {
      socket.emit('repo-switched', {
        success: false,
        message: `リポジトリの切り替えに失敗しました: ${error}`,
        currentPath: claudeSession?.workingDirectory || ''
      });
    }
  });

  // Claude CLIへのコマンド送信
  socket.on('send-command', (data) => {
    const { command } = data;

    if (!claudeSession?.isActive) {
      const message: ClaudeMessage = {
        id: Date.now().toString(),
        type: 'system',
        content: 'Claude CLIセッションが開始されていません。リポジトリを選択してください。',
        timestamp: Date.now()
      };
      socket.emit('claude-output', message);
      return;
    }

    // ユーザーの入力をエコー
    const userMessage: ClaudeMessage = {
      id: Date.now().toString(),
      type: 'user',
      content: command,
      timestamp: Date.now()
    };
    socket.emit('claude-output', userMessage);

    // Claude CLIにコマンドを送信
    claudeSession.process.stdin?.write(`${command}\n`);
  });

  socket.on('disconnect', () => {
    console.log('クライアントが切断されました');
  });
});

// サーバー起動
const PORT = process.env.PORT || 3001;

async function startServer(): Promise<void> {
  await ensureReposDir();
  await loadExistingRepos();
  
  server.listen(PORT, () => {
    console.log(`バックエンドサーバーがポート${PORT}で起動しました`);
    console.log(`リポジトリディレクトリ: ${REPOS_DIR}`);
  });
}

startServer().catch(console.error);