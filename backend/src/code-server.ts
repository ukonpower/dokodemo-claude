import { spawn, ChildProcess } from 'child_process';
import type { CodeServer } from './types';

// 単一のcode-serverインスタンス
let codeServerInstance: CodeServer | null = null;
let codeServerProcess: ChildProcess | null = null;

// code-serverのポート番号(固定)
const CODE_SERVER_PORT = 8080;

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

  const url = `http://localhost:${CODE_SERVER_PORT}`;

  // code-serverインスタンスを初期化
  codeServerInstance = {
    repositoryPath: '', // 単一インスタンスなので特定のリポジトリに紐づかない
    port: CODE_SERVER_PORT,
    status: 'starting',
    url,
    startedAt: Date.now(),
  };

  try {
    // code-serverプロセスを起動
    // --auth none: 認証なし(ローカル環境のみ)
    // --disable-telemetry: テレメトリ無効化
    // --bind-addr 0.0.0.0: 外部からのアクセスを許可
    // 起動時にはフォルダを指定せず、空の状態で起動
    codeServerProcess = spawn(
      'code-server',
      ['--auth', 'none', '--disable-telemetry', '--bind-addr', `0.0.0.0:${CODE_SERVER_PORT}`],
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
    console.error(`Failed to start code-server:`, error);
    if (codeServerInstance) {
      codeServerInstance.status = 'error';
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
