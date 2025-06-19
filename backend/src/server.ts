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
  Terminal,
  TerminalMessage
} from './types/index.js';
import { ProcessManager } from './process-manager.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const server = createServer(app);

// Socket.IOサーバーの設定
const io = new Server<ClientToServerEvents, ServerToClientEvents>(server, {
  cors: {
    origin: "*", // すべてのオリジンを許可
    methods: ["GET", "POST"],
    credentials: true
  }
});

// グローバル状態
let repositories: GitRepository[] = [];
const REPOS_DIR = path.join(process.cwd(), 'repositories');
const PROCESSES_DIR = path.join(process.cwd(), 'processes');

// プロセス管理インスタンス
const processManager = new ProcessManager(PROCESSES_DIR);

// Expressの設定
app.use(cors({
  origin: "*", // すべてのオリジンを許可
  credentials: true
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

// ProcessManagerのイベントハンドラー設定
processManager.on('claude-output', (data) => {
  io.emit('claude-raw-output', {
    type: data.type,
    content: data.content,
    sessionId: data.sessionId,
    repositoryPath: data.repositoryPath
  });
});

processManager.on('claude-exit', (data) => {
  io.emit('claude-raw-output', {
    type: 'system',
    content: `\n=== Claude Code CLI 終了 (code: ${data.exitCode}, signal: ${data.signal}) ===\n`,
    sessionId: data.sessionId,
    repositoryPath: data.repositoryPath
  });
});

processManager.on('claude-session-created', (session) => {
  io.emit('claude-session-created', {
    sessionId: session.id,
    repositoryPath: session.repositoryPath,
    repositoryName: session.repositoryName
  });
});

processManager.on('terminal-created', (terminal) => {
  io.emit('terminal-created', {
    id: terminal.id,
    name: terminal.name,
    cwd: terminal.repositoryPath,
    status: terminal.status,
    pid: terminal.pid,
    createdAt: terminal.createdAt
  });
});

processManager.on('terminal-output', (data) => {
  io.emit('terminal-output', {
    terminalId: data.terminalId,
    type: data.type,
    data: data.data,
    timestamp: data.timestamp
  });
});

processManager.on('terminal-exit', (data) => {
  io.emit('terminal-closed', { terminalId: data.terminalId });
});


// Socket.IOイベントハンドラ
io.on('connection', (socket) => {

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
  socket.on('switch-repo', async (data) => {
    const { path: repoPath } = data;
    
    try {
      // リポジトリ名を取得
      const repoName = path.basename(repoPath);
      
      // Claude CLIセッションを取得または作成
      const session = await processManager.getOrCreateClaudeSession(repoPath, repoName);
      
      socket.emit('repo-switched', {
        success: true,
        message: `リポジトリを切り替えました: ${repoPath}`,
        currentPath: repoPath,
        sessionId: session.id
      });

      // 出力履歴を送信
      const outputHistory = processManager.getOutputHistory(repoPath);
      socket.emit('claude-output-history', {
        repositoryPath: repoPath,
        history: outputHistory
      });

    } catch (error) {
      socket.emit('repo-switched', {
        success: false,
        message: `リポジトリの切り替えに失敗しました: ${error}`,
        currentPath: ''
      });
    }
  });

  // Claude CLIへのコマンド送信
  socket.on('send-command', (data) => {
    const { command, sessionId, repositoryPath } = data;

    let targetSessionId = sessionId;
    
    // sessionIdが指定されていない場合、repositoryPathから取得
    if (!targetSessionId && repositoryPath) {
      const session = processManager.getClaudeSessionByRepository(repositoryPath);
      if (session) {
        targetSessionId = session.id;
      }
    }

    if (!targetSessionId) {
      socket.emit('claude-raw-output', {
        type: 'system',
        content: 'Claude CLIセッションが開始されていません。リポジトリを選択してください。\n'
      });
      return;
    }
    
    // ProcessManagerを通じてコマンドを送信
    let commandToSend = command;
    
    // 方向キー（ANSIエスケープシーケンス）の場合は直接送信
    if (command.startsWith('\x1b[')) {
      // 方向キーはそのまま送信
    } else if (command === '\r') {
      // 単独のエンターキーの場合
    } else if (command === '\x1b') {
      // ESCキーの場合は直接送信
    } else {
      // 通常のコマンドの場合はエンターキーも送信
      commandToSend = command + '\r';
      
      // Claude CLIでは実行確定のためもう一度エンターキーが必要
      setTimeout(() => {
        processManager.sendToClaudeSession(targetSessionId, '\r');
      }, 100); // 100ms後に実行確定
    }
    
    const success = processManager.sendToClaudeSession(targetSessionId, commandToSend);
    if (!success) {
      socket.emit('claude-raw-output', {
        type: 'system',
        content: `Claude CLIセッションエラー: セッション ${targetSessionId} が見つかりません\n`
      });
    }
  });

  // Claude CLIへのCtrl+C中断送信
  socket.on('claude-interrupt', (data) => {
    const { sessionId, repositoryPath } = data || {};
    
    let targetSessionId = sessionId;
    
    // sessionIdが指定されていない場合、repositoryPathから取得
    if (!targetSessionId && repositoryPath) {
      const session = processManager.getClaudeSessionByRepository(repositoryPath);
      if (session) {
        targetSessionId = session.id;
      }
    }

    if (!targetSessionId) {
      socket.emit('claude-raw-output', {
        type: 'system',
        content: 'Claude CLIセッションが開始されていません。\n'
      });
      return;
    }
    
    // Ctrl+C (SIGINT)を送信
    const success = processManager.sendToClaudeSession(targetSessionId, '\x03');
    if (!success) {
      socket.emit('claude-raw-output', {
        type: 'system',
        content: `Claude CLIセッションエラー: セッション ${targetSessionId} が見つかりません\n`
      });
    }
  });

  // ターミナル関連のイベントハンドラ

  // ターミナル一覧の送信
  socket.on('list-terminals', (data) => {
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
      terminals: terminals.map(terminal => ({
        id: terminal.id,
        name: terminal.name,
        cwd: terminal.repositoryPath,
        status: terminal.status,
        pid: terminal.pid,
        createdAt: terminal.createdAt
      }))
    });
  });

  // 新しいターミナルの作成
  socket.on('create-terminal', async (data) => {
    const { cwd, name } = data;
    try {
      const repoName = path.basename(cwd);
      const terminal = await processManager.createTerminal(cwd, repoName, name);
      // terminal-createdイベントは ProcessManager から自動的に発火される
    } catch (error) {
      socket.emit('terminal-output', {
        terminalId: 'system',
        type: 'stderr',
        data: `ターミナル作成エラー: ${error}\n`,
        timestamp: Date.now()
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
        timestamp: Date.now()
      });
    }
  });

  // ターミナルのリサイズ
  socket.on('terminal-resize', (data) => {
    const { terminalId, cols, rows } = data;
    processManager.resizeTerminal(terminalId, cols, rows);
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

  socket.on('disconnect', () => {
    // クライアント切断時の処理
  });
});

// サーバー起動
const PORT = parseInt(process.env.PORT || '8001', 10);

async function startServer(): Promise<void> {
  await ensureReposDir();
  await loadExistingRepos();
  
  // ProcessManagerの初期化
  await processManager.initialize();
  
  server.listen(PORT, '0.0.0.0', () => {
    console.log(`バックエンドサーバーがポート${PORT}で起動しました (0.0.0.0:${PORT})`);
  });
}

// プロセス終了時のクリーンアップ
process.on('SIGTERM', async () => {
  console.log('Received SIGTERM, shutting down gracefully...');
  await processManager.shutdown();
  process.exit(0);
});

process.on('SIGINT', async () => {
  console.log('Received SIGINT, shutting down gracefully...');
  await processManager.shutdown();
  process.exit(0);
});

startServer().catch(console.error);