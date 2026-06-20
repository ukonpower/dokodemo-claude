/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/client" />

interface ImportMetaEnv {
  // ポートはフロントから直接は参照しない（同一オリジン経由でアクセスする）。
  // vite.config.ts の proxy 設定でのみ使う値だが、型は残しておく。
  readonly DC_WEB_PORT: string;
  readonly DC_API_PORT: string;
  readonly DC_PROD_PORT: string;
  readonly DC_USE_HTTPS: string;
  // 開発時に別オリジンの API に向けたい場合のオーバーライド
  readonly DC_API_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
