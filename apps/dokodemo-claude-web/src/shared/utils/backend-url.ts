// API / Socket.IO のベース URL。
// dev (vite dev server) では vite.config.ts の proxy 経由で Express に転送されるため、
// prod (Express 統合配信) でも同一オリジンで完結する。両モードとも window.location.origin で OK。
export const BACKEND_URL =
  import.meta.env.DC_API_URL || window.location.origin;
