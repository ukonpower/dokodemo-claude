import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
  // プロジェクトルートの.envファイルを読み込み
  const env = loadEnv(mode, process.cwd() + '/..', '');

  return {
    plugins: [react()],
    server: {
      port: parseInt(env.VITE_PORT || '8000', 10),
      host: true,
    },
    // 環境変数をクライアント側で使用できるようにする
    define: {
      'import.meta.env.VITE_API_URL': JSON.stringify(env.VITE_API_URL || 'http://localhost:3001'),
    },
  };
});
