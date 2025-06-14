import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import { ClaudeCodeManager } from './claude.js';

const app = express();
const server = createServer(app);
const io = new Server(server, {
  cors: {
    origin: "http://localhost:5173",
    methods: ["GET", "POST"]
  }
});

const claudeManager = new ClaudeCodeManager();

app.use(cors());
app.use(express.json());

// 基本的なヘルスチェック
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

io.on('connection', (socket) => {
  console.log('クライアントが接続されました:', socket.id);

  // リポジトリ一覧取得
  socket.on('list-repos', async () => {
    try {
      const repos = await claudeManager.listRepositories();
      socket.emit('repos-list', { repos });
    } catch (error) {
      console.error('リポジトリ一覧取得エラー:', error);
      socket.emit('claude-output', {
        id: Date.now().toString(),
        type: 'system',
        content: `エラー: リポジトリ一覧の取得に失敗しました`,
        timestamp: Date.now()
      });
    }
  });

  // リポジトリクローン
  socket.on('clone-repo', async (data: { url: string; path: string }) => {
    try {
      socket.emit('claude-output', {
        id: Date.now().toString(),
        type: 'system',
        content: `リポジトリをクローン中: ${data.url}`,
        timestamp: Date.now()
      });

      await claudeManager.cloneRepository(data.url, data.path);
      
      socket.emit('claude-output', {
        id: Date.now().toString(),
        type: 'system',
        content: `クローン完了: ${data.path}`,
        timestamp: Date.now()
      });

      // リポジトリ一覧を更新
      const repos = await claudeManager.listRepositories();
      socket.emit('repos-list', { repos });
    } catch (error) {
      console.error('クローンエラー:', error);
      socket.emit('claude-output', {
        id: Date.now().toString(),
        type: 'system',
        content: `クローンエラー: ${error instanceof Error ? error.message : '不明なエラー'}`,
        timestamp: Date.now()
      });
    }
  });

  // リポジトリ切り替え
  socket.on('switch-repo', async (data: { path: string }) => {
    try {
      await claudeManager.switchRepository(data.path);
      socket.emit('claude-output', {
        id: Date.now().toString(),
        type: 'system',
        content: `リポジトリを切り替えました: ${data.path}`,
        timestamp: Date.now()
      });
    } catch (error) {
      console.error('リポジトリ切り替えエラー:', error);
      socket.emit('claude-output', {
        id: Date.now().toString(),
        type: 'system',
        content: `切り替えエラー: ${error instanceof Error ? error.message : '不明なエラー'}`,
        timestamp: Date.now()
      });
    }
  });

  // コマンド送信
  socket.on('send-command', async (data: { command: string }) => {
    try {
      const response = await claudeManager.sendCommand(data.command);
      socket.emit('claude-output', {
        id: Date.now().toString(),
        type: 'claude',
        content: response,
        timestamp: Date.now()
      });
    } catch (error) {
      console.error('コマンド実行エラー:', error);
      socket.emit('claude-output', {
        id: Date.now().toString(),
        type: 'system',
        content: `コマンド実行エラー: ${error instanceof Error ? error.message : '不明なエラー'}`,
        timestamp: Date.now()
      });
    }
  });

  socket.on('disconnect', () => {
    console.log('クライアントが切断されました:', socket.id);
  });
});

const PORT = process.env.PORT || 3001;

server.listen(PORT, () => {
  console.log(`サーバーがポート ${PORT} で起動しました`);
  console.log(`フロントエンド: http://localhost:5173`);
  console.log(`バックエンド: http://localhost:${PORT}`);
});