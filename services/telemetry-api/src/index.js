import { handleTelemetryApiRequest } from './adapters/http/handleTelemetryApiRequest.js';

export { allowedFields } from './domain/telemetrySchema.js';
export { allowedLandingPredictionFields } from './domain/landingPredictionSchema.js';
export { buildCorsHeaders } from './adapters/http/json.js';
export { handleTelemetryApiRequest as handleRequest };
export { mapLandingPredictionRow } from './infrastructure/d1/landingPredictionRowMapper.js';
export { normalizeIncomingLandingPrediction } from './adapters/http/normalizeIncomingLandingPrediction.js';
export { normalizeBoolean, normalizeScalar, normalizeIncomingTelemetry as normalizeTelemetry } from './adapters/http/normalizeIncomingTelemetry.js';
export { mapTelemetryRow } from './infrastructure/d1/telemetryRowMapper.js';

export default {
  fetch: handleTelemetryApiRequest
};
