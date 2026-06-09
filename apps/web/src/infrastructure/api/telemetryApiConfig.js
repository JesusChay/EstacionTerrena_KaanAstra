const DEFAULT_API_BASE_URL = '/api';
const DEFAULT_API_PATHS = Object.freeze({
  health: '/health',
  schema: '/schema',
  latest: '/latest',
  prediction: '/predictions',
  predictionLatest: '/predictions/latest',
  predictionRecent: '/predictions/recent',
  recent: '/recent',
  report: '/report',
  telemetry: '/telemetry'
});
const DEFAULT_LIMITS = Object.freeze({
  predictionRecent: Object.freeze({ default: 24, max: 240 }),
  recent: Object.freeze({ default: 24, max: 120 }),
  report: Object.freeze({ default: 5000, max: 10000 })
});

let configuredContracts = {};
let configuredApiBaseUrl = DEFAULT_API_BASE_URL;

export function configureTelemetryApiConfig({ contracts = {}, apiBaseUrl } = {}) {
  configuredContracts = normalizeConfigObject(contracts);
  configuredApiBaseUrl = resolveTelemetryApiBaseUrl({
    apiBaseUrl,
    contracts: configuredContracts
  });
}

export function getConfiguredApiBaseUrl() {
  return configuredApiBaseUrl;
}

export function getApiPaths() {
  const apiPaths = normalizeConfigObject(configuredContracts.apiPaths);
  return { ...DEFAULT_API_PATHS, ...apiPaths };
}

export function getRecentLimitConfig() {
  return getLimitConfig('recent');
}

export function getReportLimitConfig() {
  return getLimitConfig('report');
}

export function getPredictionRecentLimitConfig() {
  return getLimitConfig('predictionRecent');
}

export function buildApiUrl(apiBaseUrl, endpointPath, query = '') {
  const normalizedBase = String(apiBaseUrl || DEFAULT_API_BASE_URL).replace(/\/+$/, '');
  const normalizedPath = endpointPath.startsWith('/') ? endpointPath : `/${endpointPath}`;
  return `${normalizedBase}${normalizedPath}${query}`;
}

function getLimitConfig(limitKey) {
  const fallback = DEFAULT_LIMITS[limitKey];
  const configuredLimit = normalizeConfigObject(configuredContracts.limits?.[limitKey]);

  return {
    default: Number.isFinite(configuredLimit.default) ? configuredLimit.default : fallback.default,
    max: Number.isFinite(configuredLimit.max) ? configuredLimit.max : fallback.max
  };
}

function resolveTelemetryApiBaseUrl({ apiBaseUrl, contracts }) {
  return apiBaseUrl
    || readRuntimeTelemetryApiBaseUrl()
    || contracts.apiBasePath
    || DEFAULT_API_BASE_URL;
}

function readRuntimeTelemetryApiBaseUrl() {
  return globalThis.window?.APP_CONFIG?.telemetryApiBaseUrl
    || globalThis.window?.APP_CONFIG?.apiBaseUrl
    || '';
}

function normalizeConfigObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? { ...value }
    : {};
}
