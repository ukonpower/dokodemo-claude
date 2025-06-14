import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import { spawn } from 'child_process';
import * as pty from 'node-pty';
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

// Claude Code CLIセッションの開始（対話モードを維持）
function startClaudeSession(workingDir: string): ClaudeSession {
  if (claudeSession?.isActive) {
    try {
      if (claudeSession.isPty) {
        claudeSession.process.kill();
      } else {
        claudeSession.process.kill('SIGTERM');
        setTimeout(() => {
          if (claudeSession?.process && !claudeSession.process.killed) {
            claudeSession.process.kill('SIGKILL');
          }
        }, 1000);
      }
    } catch (error) {
      console.error('プロセス終了エラー:', error);
    }
  }

  console.log(`Claude CLIをPTYで開始します: ${workingDir}`);
  
  // npm版Claude CLIのパス（プロジェクトルートのnode_modules）
  const claudePath = path.join(__dirname, '../../node_modules/@anthropic-ai/claude-code/cli.js');
  console.log(`Claude CLIパス: ${claudePath}`);
  
  // PTYを使用してClaude CLIを対話モードで起動
  const claudeProcess = pty.spawn('node', [claudePath], {
    name: 'xterm-color',
    cols: 120,
    rows: 30,
    cwd: workingDir,
    env: {
      ...process.env,
      TERM: 'xterm-256color',
      COLORTERM: 'truecolor',
      FORCE_COLOR: '1'
    }
  });

  // プロセス開始の確認
  console.log(`Claude CLIプロセス開始: PID=${claudeProcess.pid}`);

  claudeSession = {
    process: claudeProcess,
    isActive: true,
    workingDirectory: workingDir,
    isPty: true
  };

  // PTYからの出力をそのまま送信（ANSI色コード含む）
  claudeProcess.onData((data: string) => {
    console.log('Claude raw output:', data);
    console.log('Connected clients:', io.sockets.sockets.size);
    console.log('Sending to clients via Socket.IO with event: claude-raw-output');
    io.emit('claude-raw-output', {
      type: 'stdout',
      content: data
    });
    console.log('Sent claude-raw-output event');
  });

  claudeProcess.onExit(({ exitCode, signal }) => {
    console.log(`Claude CLIプロセス終了: code=${exitCode}, signal=${signal}`);
    io.emit('claude-raw-output', {
      type: 'system',
      content: `\n=== Claude Code CLI 終了 (code: ${exitCode}, signal: ${signal}) ===\n`
    });
    
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
    console.log('=== switch-repo イベント受信 ===');
    console.log('切り替え先パス:', repoPath);
    
    try {
      // Claude CLIセッションを新しいディレクトリで開始
      console.log('Claude CLIセッションを開始します...');
      const newSession = startClaudeSession(repoPath);
      console.log('新しいセッション作成完了:', {
        isActive: newSession.isActive,
        isPty: newSession.isPty,
        workingDirectory: newSession.workingDirectory
      });
      
      socket.emit('repo-switched', {
        success: true,
        message: `リポジトリを切り替えました: ${repoPath}`,
        currentPath: repoPath
      });

    } catch (error) {
      console.error('リポジトリ切り替えエラー:', error);
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
    console.log('=== send-command イベント受信 ===');
    console.log('コマンド:', command);
    console.log('claudeSession exists:', !!claudeSession);
    console.log('claudeSession.isActive:', claudeSession?.isActive);
    console.log('claudeSession.isPty:', claudeSession?.isPty);
    console.log('claudeSession.process exists:', !!claudeSession?.process);

    if (!claudeSession?.isActive) {
      console.log('Claude CLIセッションが非アクティブです');
      socket.emit('claude-raw-output', {
        type: 'system',
        content: 'Claude CLIセッションが開始されていません。リポジトリを選択してください。\n'
      });
      return;
    }

    console.log('Claude CLIにコマンドを送信します:', command);
    
    // PTYに直接コマンドを送信
    if (claudeSession.isPty && claudeSession.process) {
      console.log('PTYにコマンドを書き込みます');
      
      // コマンドを入力してエンターキーを送信
      claudeSession.process.write(command);
      claudeSession.process.write('\r'); // Carriage Return (Enter key)
      
      console.log('コマンドとエンターキーを送信しました');
    } else {
      console.error('PTYセッションが利用できません');
      console.error('isPty:', claudeSession.isPty);
      console.error('process:', !!claudeSession.process);
      socket.emit('claude-raw-output', {
        type: 'system',
        content: 'Claude CLIセッションエラー: PTYが利用できません\n'
      });
    }
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

// プロセス終了時のクリーンアップ
process.on('SIGTERM', () => {
  console.log('SIGTERM受信、サーバーを終了します...');
  if (claudeSession?.isActive) {
    try {
      if (claudeSession.isPty) {
        claudeSession.process.kill();
      } else {
        claudeSession.process.kill('SIGTERM');
      }
    } catch (error) {
      console.error('Claude CLIプロセス終了エラー:', error);
    }
  }
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log('SIGINT受信、サーバーを終了します...');
  if (claudeSession?.isActive) {
    try {
      if (claudeSession.isPty) {
        claudeSession.process.kill();
      } else {
        claudeSession.process.kill('SIGTERM');
      }
    } catch (error) {
      console.error('Claude CLIプロセス終了エラー:', error);
    }
  }
  process.exit(0);
});

startServer().catch(console.error);