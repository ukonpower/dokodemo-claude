import { spawn, ChildProcess } from 'child_process';
import * as net from 'net';
import type { CodeServer } from './types';

// 単一のcode-serverインスタンス
let codeServerInstance: CodeServer | null = null;
let codeServerProcess: ChildProcess | null = null;

// code-serverのポート設定
const CODE_SERVER_PORT_START = 8500; // 開始ポート
const CODE_SERVER_PORT_MAX = 8510; // 最大ポート番号

/**
 * 指定されたポートが使用可能かチェックする
 */
function isPortAvailable(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = net.createServer();

    server.once('error', (err: NodeJS.ErrnoException) => {
      if (err.code === 'EADDRINUSE') {
        resolve(false); // ポートは使用中
      } else {
        resolve(false); // その他のエラーも使用不可として扱う
      }
    });

    server.once('listening', () => {
      server.close();
      resolve(true); // ポートは使用可能
    });

    server.listen(port, '0.0.0.0');
  });
}

/**
 * 使用可能なポートを探す
 */
async function findAvailablePort(startPort: number, maxPort: number): Promise<number> {
  for (let port = startPort; port <= maxPort; port++) {
    if (await isPortAvailable(port)) {
      return port;
    }
  }
  throw new Error(`No available port found between ${startPort} and ${maxPort}`);
}

/**
 * code-serverを起動する(単一インスタンス)
 * 初回起動時のみ実際にプロセスを起動し、2回目以降は既存のインスタンス情報を返す
 */
export async function startCodeServer(): Promise<CodeServer> {
  // 既に起動している場合は既存のインスタンスを返す
  if (codeServerInstance && codeServerInstance.status === 'running') {
    console.log('[code-server] Already running, returning existing instance');
    return codeServerInstance;
  }

  try {
    // 8500から順に使用可能なポートを探す
    const availablePort = await findAvailablePort(CODE_SERVER_PORT_START, CODE_SERVER_PORT_MAX);
    console.log(`[code-server] Found available port: ${availablePort}`);

    const url = `http://localhost:${availablePort}`;

    // code-serverインスタンスを初期化
    codeServerInstance = {
      repositoryPath: '', // 単一インスタンスなので特定のリポジトリに紐づかない
      port: availablePort,
      status: 'starting',
      url,
      startedAt: Date.now(),
    };

    // code-serverプロセスを起動
    // --auth none: 認証なし(ローカル環境のみ)
    // --disable-telemetry: テレメトリ無効化
    // --bind-addr 0.0.0.0: 外部からのアクセスを許可
    // 起動時にはフォルダを指定せず、空の状態で起動
    codeServerProcess = spawn(
      'code-server',
      ['--auth', 'none', '--disable-telemetry', '--bind-addr', `0.0.0.0:${availablePort}`],
      {
        stdio: ['ignore', 'pipe', 'pipe'],
      }
    );

    codeServerInstance.pid = codeServerProcess.pid;

    // 標準出力をログ
    codeServerProcess.stdout?.on('data', (data) => {
      const output = data.toString();
      console.log(`[code-server] ${output}`);

      // 起動完了を検出
      if (output.includes('HTTP server listening on')) {
        if (codeServerInstance) {
          codeServerInstance.status = 'running';
        }
      }
    });

    // エラー出力をログ
    codeServerProcess.stderr?.on('data', (data) => {
      const error = data.toString();
      console.error(`[code-server] ERROR: ${error}`);
    });

    // プロセス終了時の処理
    codeServerProcess.on('exit', (code) => {
      console.log(`[code-server] Process exited with code ${code}`);
      if (codeServerInstance) {
        codeServerInstance.status = 'stopped';
      }
      codeServerProcess = null;
    });

    // プロセスエラー時の処理
    codeServerProcess.on('error', (err) => {
      console.error(`[code-server] Process error:`, err);
      if (codeServerInstance) {
        codeServerInstance.status = 'error';
      }
    });

    // 起動完了を待つ(最大10秒)
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('code-server startup timeout'));
      }, 10000);

      const checkInterval = setInterval(() => {
        if (codeServerInstance?.status === 'running') {
          clearTimeout(timeout);
          clearInterval(checkInterval);
          resolve();
        } else if (codeServerInstance?.status === 'error') {
          clearTimeout(timeout);
          clearInterval(checkInterval);
          reject(new Error('code-server startup failed'));
        }
      }, 500);
    });

    return codeServerInstance;
  } catch (error) {
    console.error(`[code-server] Failed to start:`, error);
    if (codeServerInstance) {
      codeServerInstance.status = 'error';
    }

    // ポートが見つからなかった場合のエラーメッセージを改善
    if (error instanceof Error && error.message.includes('No available port found')) {
      throw new Error(`Failed to start code-server: ${error.message}`);
    }

    throw error;
  }
}

/**
 * code-serverを停止する
 */
export async function stopCodeServer(): Promise<void> {
  if (!codeServerInstance) {
    throw new Error('No code-server instance found');
  }

  if (codeServerProcess && codeServerInstance.pid) {
    try {
      process.kill(codeServerInstance.pid, 'SIGTERM');
      codeServerInstance.status = 'stopped';
      codeServerProcess = null;
    } catch (error) {
      console.error(`Failed to stop code-server (PID: ${codeServerInstance.pid}):`, error);
      throw error;
    }
  }

  codeServerInstance = null;
}

/**
 * code-serverインスタンスを取得
 */
export function getCodeServer(): CodeServer | null {
  return codeServerInstance;
}

/**
 * 特定のリポジトリを開くためのURLを生成
 */
export function getCodeServerUrlForRepository(repositoryPath: string): string {
  if (!codeServerInstance || codeServerInstance.status !== 'running') {
    throw new Error('code-server is not running');
  }

  // VS Code / code-serverでは、URLの後に?folder=でフォルダパスを指定できる
  return `${codeServerInstance.url}/?folder=${encodeURIComponent(repositoryPath)}`;
}
