/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/client" />

interface ImportMetaEnv {
  readonly DC_API_PORT: string;
  readonly DC_WEB_PORT: string;
  readonly DC_USE_HTTPS: string;
  readonly DC_API_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
