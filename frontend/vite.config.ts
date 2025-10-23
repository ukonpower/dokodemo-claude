import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
  // .envファイルから環境変数を読み込む
  const env = loadEnv(mode, process.cwd(), '');
  const port = parseInt(env.DC_VITE_PORT || '8000', 10);

  return {
    plugins: [react()],
    server: {
      host: true,
      port: port,
      allowedHosts: ['.ts.net'], // Tailscaleドメインを許可
    },
  };
});
