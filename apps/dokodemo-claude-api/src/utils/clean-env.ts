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
