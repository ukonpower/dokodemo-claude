export const BACKEND_URL =
  import.meta.env.DC_API_URL ||
  `${window.location.protocol}//${window.location.hostname}:${import.meta.env.DC_API_PORT || 8001}`;
