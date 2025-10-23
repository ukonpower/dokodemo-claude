/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly DC_BACKEND_PORT: string;
  readonly DC_VITE_PORT: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
