import * as fs from 'fs';
import * as path from 'path';

export function cleanChildEnv(
  overrides: Record<string, string | undefined> = {}
): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (key.startsWith('DC_')) continue;
    if (value !== undefined) env[key] = value;
  }
  for (const [key, value] of Object.entries(overrides)) {
    if (value === undefined) delete env[key];
    else env[key] = value;
  }
  return env;
}

/**
 * 与えられた env の PATH を辿って、コマンド名から実行可能ファイルの絶対パスを解決する。
 *
 * node-pty の posix_spawnp で「コマンド名のまま渡す」と、解決失敗時に
 * "posix_spawnp failed" という原因不明の汎用エラーになるため、事前にここで解決する。
 *
 * - コマンドが既にパス区切りを含む場合は、そのパスを存在チェックして返す
 * - PATH エントリを順に走査し、最初に見つかった実行可能ファイルを返す
 * - 解決できない場合は null
 */
export function resolveCommandPath(
  command: string,
  env: Record<string, string>
): string | null {
  if (command.includes('/')) {
    try {
      const stat = fs.statSync(command);
      if (stat.isFile()) return command;
    } catch {
      // ignore
    }
    return null;
  }

  const pathEnv = env.PATH || env.Path || '';
  if (!pathEnv) return null;

  for (const dir of pathEnv.split(path.delimiter)) {
    if (!dir) continue;
    const candidate = path.join(dir, command);
    try {
      const stat = fs.statSync(candidate);
      if (stat.isFile()) {
        // 実行ビットの確認（取得失敗時は許容してそのまま返す）
        try {
          fs.accessSync(candidate, fs.constants.X_OK);
        } catch {
          continue;
        }
        return candidate;
      }
    } catch {
      // 次のエントリへ
    }
  }
  return null;
}

// Express の実 listen port を返す（dev: DC_API_PORT / prod: DC_PROD_PORT）
export function getApiListenPort(): number {
  if (process.env.DC_MODE === 'prod') {
    return parseInt(process.env.DC_PROD_PORT || '8000', 10);
  }
  return parseInt(process.env.DC_API_PORT || '8001', 10);
}

// dokodemo-claude API のベースURLを返す（子プロセスから自身のAPIへアクセスするため）
export function getDokodemoApiBaseUrl(): string {
  const protocol = process.env.DC_USE_HTTPS !== 'false' ? 'https' : 'http';
  return `${protocol}://localhost:${getApiListenPort()}`;
}

// MCP 専用サーバのポート。DC_MCP_PORT 未指定時は DC_API_PORT + 1。
export function getMcpPort(): number {
  const explicit = process.env.DC_MCP_PORT;
  if (explicit) return parseInt(explicit, 10);
  return parseInt(process.env.DC_API_PORT || '8001', 10) + 1;
}

// MCP エンドポイントの URL を返す。
// MCP は loopback 限定の専用 HTTP サーバで提供するため、DC_USE_HTTPS の値に関係なく
// 常に http://127.0.0.1 を指す（自己署名証明書の問題を回避する）。
export function getDokodemoMcpUrl(): string {
  return `http://127.0.0.1:${getMcpPort()}/mcp`;
}
