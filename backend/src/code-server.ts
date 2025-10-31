import { spawn, ChildProcess } from 'child_process';
import type { CodeServer } from './types';

// code-serverインスタンスを管理するMap
const codeServers = new Map<string, CodeServer>();

// 次に使用可能なポート番号を取得
let nextPort = 8080;
function getNextPort(): number {
  return nextPort++;
}

/**
 * code-serverを起動する
 */
export async function startCodeServer(
  repositoryPath: string
): Promise<CodeServer> {
  // 既に起動している場合は既存のインスタンスを返す
  const existing = codeServers.get(repositoryPath);
  if (existing && existing.status === 'running') {
    return existing;
  }

  const port = getNextPort();
  const url = `http://localhost:${port}`;

  // code-serverインスタンスを初期化
  const server: CodeServer = {
    repositoryPath,
    port,
    status: 'starting',
    url,
    startedAt: Date.now(),
  };

  codeServers.set(repositoryPath, server);

  try {
    // code-serverプロセスを起動
    // --auth none: 認証なし（ローカル環境のみ）
    // --disable-telemetry: テレメトリ無効化
    // --bind-addr 0.0.0.0: 外部からのアクセスを許可
    const codeServerProcess: ChildProcess = spawn(
      'code-server',
      [
        '--auth',
        'none',
        '--disable-telemetry',
        '--bind-addr',
        `0.0.0.0:${port}`,
        repositoryPath,
      ],
      {
        cwd: repositoryPath,
        stdio: ['ignore', 'pipe', 'pipe'],
      }
    );

    server.pid = codeServerProcess.pid;

    // 標準出力をログ
    codeServerProcess.stdout?.on('data', (data) => {
      const output = data.toString();
      console.log(`[code-server:${repositoryPath}] ${output}`);

      // 起動完了を検出
      if (output.includes('HTTP server listening on')) {
        server.status = 'running';
        codeServers.set(repositoryPath, { ...server });
      }
    });

    // エラー出力をログ
    codeServerProcess.stderr?.on('data', (data) => {
      const error = data.toString();
      console.error(`[code-server:${repositoryPath}] ERROR: ${error}`);
    });

    // プロセス終了時の処理
    codeServerProcess.on('exit', (code) => {
      console.log(
        `[code-server:${repositoryPath}] Process exited with code ${code}`
      );
      const current = codeServers.get(repositoryPath);
      if (current) {
        current.status = 'stopped';
        codeServers.set(repositoryPath, { ...current });
      }
    });

    // プロセスエラー時の処理
    codeServerProcess.on('error', (err) => {
      console.error(`[code-server:${repositoryPath}] Process error:`, err);
      const current = codeServers.get(repositoryPath);
      if (current) {
        current.status = 'error';
        codeServers.set(repositoryPath, { ...current });
      }
    });

    // 起動完了を待つ（最大10秒）
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('code-server startup timeout'));
      }, 10000);

      const checkInterval = setInterval(() => {
        const current = codeServers.get(repositoryPath);
        if (current?.status === 'running') {
          clearTimeout(timeout);
          clearInterval(checkInterval);
          resolve();
        } else if (current?.status === 'error') {
          clearTimeout(timeout);
          clearInterval(checkInterval);
          reject(new Error('code-server startup failed'));
        }
      }, 500);
    });

    return codeServers.get(repositoryPath)!;
  } catch (error) {
    console.error(
      `Failed to start code-server for ${repositoryPath}:`,
      error
    );
    server.status = 'error';
    codeServers.set(repositoryPath, server);
    throw error;
  }
}

/**
 * code-serverを停止する
 */
export async function stopCodeServer(repositoryPath: string): Promise<void> {
  const server = codeServers.get(repositoryPath);
  if (!server) {
    throw new Error(`No code-server found for ${repositoryPath}`);
  }

  if (server.pid) {
    try {
      process.kill(server.pid, 'SIGTERM');
      server.status = 'stopped';
      codeServers.set(repositoryPath, { ...server });
    } catch (error) {
      console.error(`Failed to stop code-server (PID: ${server.pid}):`, error);
      throw error;
    }
  }

  // Mapから削除
  codeServers.delete(repositoryPath);
}

/**
 * 全code-serverインスタンスを取得
 */
export function getAllCodeServers(): CodeServer[] {
  return Array.from(codeServers.values());
}

/**
 * 特定のcode-serverインスタンスを取得
 */
export function getCodeServer(repositoryPath: string): CodeServer | undefined {
  return codeServers.get(repositoryPath);
}

/**
 * 全code-serverインスタンスを停止
 */
export async function stopAllCodeServers(): Promise<void> {
  const promises = Array.from(codeServers.keys()).map((repositoryPath) =>
    stopCodeServer(repositoryPath).catch((err) =>
      console.error(`Failed to stop code-server for ${repositoryPath}:`, err)
    )
  );
  await Promise.all(promises);
}
