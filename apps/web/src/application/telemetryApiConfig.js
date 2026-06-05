const DEFAULT_API_BASE_URL = '/api';
const DEFAULT_API_PATHS = {
  health: '/health',
  schema: '/schema',
  latest: '/latest',
  recent: '/recent',
  report: '/report',
  telemetry: '/telemetry'
};
const DEFAULT_LIMITS = {
  recent: { default: 24, max: 120 },
  report: { default: 5000, max: 10000 }
};

let configuredContracts = {};
let configuredApiBaseUrl = DEFAULT_API_BASE_URL;

export function configureTelemetryApiConfig({ contracts = {}, apiBaseUrl = DEFAULT_API_BASE_URL } = {}) {
  configuredContracts = contracts && typeof contracts === 'object' ? { ...contracts } : {};
  configuredApiBaseUrl = apiBaseUrl || DEFAULT_API_BASE_URL;
}

export function getConfiguredApiBaseUrl() {
  return configuredApiBaseUrl;
}

export function getApiPaths() {
  const apiPaths = configuredContracts.apiPaths;
  return apiPaths && typeof apiPaths === 'object'
    ? { ...DEFAULT_API_PATHS, ...apiPaths }
    : { ...DEFAULT_API_PATHS };
}

export function getRecentLimitConfig() {
  const recent = configuredContracts.limits?.recent;
  return {
    default: Number.isFinite(recent?.default) ? recent.default : DEFAULT_LIMITS.recent.default,
    max: Number.isFinite(recent?.max) ? recent.max : DEFAULT_LIMITS.recent.max
  };
}

export function getReportLimitConfig() {
  const report = configuredContracts.limits?.report;
  return {
    default: Number.isFinite(report?.default) ? report.default : DEFAULT_LIMITS.report.default,
    max: Number.isFinite(report?.max) ? report.max : DEFAULT_LIMITS.report.max
  };
}

export function buildApiUrl(apiBaseUrl, endpointPath, query = '') {
  const normalizedBase = String(apiBaseUrl || DEFAULT_API_BASE_URL).replace(/\/+$/, '');
  const normalizedPath = endpointPath.startsWith('/') ? endpointPath : `/${endpointPath}`;
  return `${normalizedBase}${normalizedPath}${query}`;
}
