import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import fs from 'fs';
import path from 'path';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, '../../', 'DC_');
  const port = Number(env.DC_WEB_PORT) || 8000;
  const useHttps = env.DC_USE_HTTPS !== 'false';

  let httpsConfig: { cert: Buffer; key: Buffer } | undefined;
  if (useHttps) {
    const certPath = env.DC_HTTPS_CERT_PATH;
    const keyPath = env.DC_HTTPS_KEY_PATH;
    if (certPath && keyPath && fs.existsSync(certPath) && fs.existsSync(keyPath)) {
      httpsConfig = {
        cert: fs.readFileSync(certPath),
        key: fs.readFileSync(keyPath),
      };
    } else {
      console.warn(
        '[vite] HTTPS有効ですが DC_HTTPS_CERT_PATH / DC_HTTPS_KEY_PATH が未設定、またはファイルが見つかりません。HTTPで起動します。'
      );
    }
  }

  return {
    envPrefix: 'DC_',
    css: {
      preprocessorOptions: {
        scss: {
          additionalData: `@use "${path.resolve(__dirname, '../../libs/design-tokens/src/scss')}" as *;\n`,
        },
      },
    },
    plugins: [
      react(),
      VitePWA({
        strategies: 'injectManifest',
        srcDir: 'src',
        filename: 'sw.ts',
        injectManifest: {
          globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2}'],
        },
        manifest: false,
        devOptions: {
          enabled: false,
        },
      }),
    ],
    envDir: '../../',
    server: {
      host: true,
      port,
      allowedHosts: ['.ts.net'], // Tailscaleドメインを許可
      https: httpsConfig,
    },
  };
});
