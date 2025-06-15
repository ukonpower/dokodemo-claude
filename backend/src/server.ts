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
  ClaudeSession,
  Terminal,
  TerminalMessage
} from './types/index.js';
import { TerminalManager } from './terminal.js';

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

// ターミナル管理インスタンス
const terminalManager = new TerminalManager();

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
      // プロセス終了エラーは無視
    }
  }

  // npm版Claude CLIのパス（プロジェクトルートのnode_modules）
  const claudePath = path.join(__dirname, '../../node_modules/@anthropic-ai/claude-code/cli.js');
  
  // PTYを使用してClaude CLIを対話モードで起動
  const claudeProcess = pty.spawn('node', [claudePath, '--dangerously-skip-permissions'], {
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


  claudeSession = {
    process: claudeProcess,
    isActive: true,
    workingDirectory: workingDir,
    isPty: true
  };

  // PTYからの出力をそのまま送信（ANSI色コード含む）
  claudeProcess.onData((data: string) => {
    io.emit('claude-raw-output', {
      type: 'stdout',
      content: data
    });
  });

  claudeProcess.onExit(({ exitCode, signal }) => {
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

// ターミナル管理イベントの設定
terminalManager.on('terminal-created', (terminal: Terminal) => {
  io.emit('terminal-created', terminal);
});

terminalManager.on('terminal-output', (message: TerminalMessage) => {
  io.emit('terminal-output', message);
});

terminalManager.on('terminal-closed', (data: { terminalId: string }) => {
  io.emit('terminal-closed', data);
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
  socket.on('switch-repo', (data) => {
    const { path: repoPath } = data;
    
    try {
      // Claude CLIセッションを新しいディレクトリで開始
      const newSession = startClaudeSession(repoPath);
      
      socket.emit('repo-switched', {
        success: true,
        message: `リポジトリを切り替えました: ${repoPath}`,
        currentPath: repoPath
      });

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
      socket.emit('claude-raw-output', {
        type: 'system',
        content: 'Claude CLIセッションが開始されていません。リポジトリを選択してください。\n'
      });
      return;
    }
    
    // PTYに直接コマンドを送信
    if (claudeSession.isPty && claudeSession.process) {
      // 方向キー（ANSIエスケープシーケンス）の場合は直接送信
      if (command.startsWith('\x1b[')) {
        claudeSession.process.write(command);
      } else if (command === '\r') {
        // 単独のエンターキーの場合
        claudeSession.process.write('\r');
      } else {
        // 通常のコマンドの場合はエンターキーも送信
        claudeSession.process.write(command);
        claudeSession.process.write('\r'); // Carriage Return (Enter key)
        
        // Claude CLIでは実行確定のためもう一度エンターキーが必要
        setTimeout(() => {
          if (claudeSession?.process) {
            claudeSession.process.write('\r'); // 実行確定のエンター
          }
        }, 100); // 100ms後に実行確定
      }
    } else {
      socket.emit('claude-raw-output', {
        type: 'system',
        content: 'Claude CLIセッションエラー: PTYが利用できません\n'
      });
    }
  });

  // ターミナル関連のイベントハンドラ

  // ターミナル一覧の送信
  socket.on('list-terminals', () => {
    const terminals = terminalManager.getTerminals();
    socket.emit('terminals-list', { terminals });
  });

  // 新しいターミナルの作成
  socket.on('create-terminal', (data) => {
    const { cwd, name } = data;
    try {
      const terminal = terminalManager.createTerminal(cwd, name);
      // terminal-createdイベントは TerminalManager から自動的に発火される
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
    const success = terminalManager.sendInput(terminalId, input);
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
    terminalManager.resizeTerminal(terminalId, cols, rows);
  });

  // ターミナルへのシグナル送信（Ctrl+C, Ctrl+Z等）
  socket.on('terminal-signal', (data) => {
    const { terminalId, signal } = data;
    const success = terminalManager.sendSignal(terminalId, signal);
    socket.emit('terminal-signal-sent', { terminalId, signal, success });
  });

  // ターミナルの終了
  socket.on('close-terminal', (data) => {
    const { terminalId } = data;
    terminalManager.closeTerminal(terminalId);
    // terminal-closedイベントは TerminalManager から自動的に発火される
  });

  socket.on('disconnect', () => {
    // クライアント切断時の処理
  });
});

// サーバー起動
const PORT = process.env.PORT || 3001;

async function startServer(): Promise<void> {
  await ensureReposDir();
  await loadExistingRepos();
  
  server.listen(PORT, () => {
    console.log(`バックエンドサーバーがポート${PORT}で起動しました`);
  });
}

// プロセス終了時のクリーンアップ
process.on('SIGTERM', () => {
  // Claude CLIセッションの終了
  if (claudeSession?.isActive) {
    try {
      if (claudeSession.isPty) {
        claudeSession.process.kill();
      } else {
        claudeSession.process.kill('SIGTERM');
      }
    } catch (error) {
      // プロセス終了エラーは無視
    }
  }

  // 全ターミナルの終了
  terminalManager.closeAllTerminals();
  
  process.exit(0);
});

process.on('SIGINT', () => {
  // Claude CLIセッションの終了
  if (claudeSession?.isActive) {
    try {
      if (claudeSession.isPty) {
        claudeSession.process.kill();
      } else {
        claudeSession.process.kill('SIGTERM');
      }
    } catch (error) {
      // プロセス終了エラーは無視
    }
  }

  // 全ターミナルの終了
  terminalManager.closeAllTerminals();
  
  process.exit(0);
});

startServer().catch(console.error);