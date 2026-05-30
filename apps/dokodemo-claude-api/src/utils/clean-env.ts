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

// dokodemo-claude API のベースURLを返す（子プロセスから自身のAPIへアクセスするため）
export function getDokodemoApiBaseUrl(): string {
  const port = process.env.DC_API_PORT || '8001';
  const protocol = process.env.DC_USE_HTTPS !== 'false' ? 'https' : 'http';
  return `${protocol}://localhost:${port}`;
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
