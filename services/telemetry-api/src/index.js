import { handleTelemetryApiRequest } from './adapters/http/handleTelemetryApiRequest.js';

export { allowedFields } from './domain/telemetrySchema.js';
export { buildCorsHeaders } from './adapters/http/json.js';
export { handleTelemetryApiRequest as handleRequest };
export { normalizeBoolean, normalizeScalar, normalizeIncomingTelemetry as normalizeTelemetry } from './adapters/http/normalizeIncomingTelemetry.js';
export { mapTelemetryRow } from './infrastructure/d1/telemetryRowMapper.js';

export default {
  fetch: handleTelemetryApiRequest
};
