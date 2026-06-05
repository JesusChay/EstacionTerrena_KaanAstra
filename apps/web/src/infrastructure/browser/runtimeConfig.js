export function readAppConfigApiBaseUrl() {
  return globalThis.window?.APP_CONFIG?.apiBaseUrl || '/api';
}
