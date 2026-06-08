import {
  buildApiUrl,
  getConfiguredApiBaseUrl,
  getApiPaths
} from './telemetryApiConfig.js';

export function createTelemetryApiClient({
  apiBaseUrl = getConfiguredApiBaseUrl(),
  apiPaths = getApiPaths(),
  fetchImpl = globalThis.fetch.bind(globalThis)
} = {}) {
  async function requestJson(endpointPath, query = '') {
    const response = await fetchImpl(buildApiUrl(apiBaseUrl, endpointPath, query), { cache: 'no-store' });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    return response.json();
  }

  return {
    getLatest() {
      return requestJson(apiPaths.latest);
    },
    getRecent(limit) {
      return requestJson(apiPaths.recent, `?limit=${limit}`);
    },
    getReport(limit) {
      return requestJson(apiPaths.report, `?limit=${limit}`);
    }
  };
}
