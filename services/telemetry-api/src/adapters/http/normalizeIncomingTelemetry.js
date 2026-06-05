import { allowedFields } from '../../domain/telemetrySchema.js';

export function normalizeIncomingTelemetry(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new Error('Telemetry payload must be a JSON object.');
  }

  const telemetry = {};

  for (const field of allowedFields) {
    if (!(field in payload)) {
      continue;
    }

    if (field === 'decouplingStatus') {
      telemetry[field] = normalizeBoolean(payload[field]);
      continue;
    }

    telemetry[field] = normalizeScalar(payload[field]);
  }

  if (Object.keys(telemetry).length === 0) {
    throw new Error('Telemetry payload does not contain supported fields.');
  }

  return telemetry;
}

export function normalizeScalar(value) {
  if (value === undefined || value === null || value === '') {
    return null;
  }

  if (typeof value === 'number' && Number.isFinite(value)) {
    return value.toString();
  }

  if (typeof value === 'string') {
    return value.trim();
  }

  throw new Error('Telemetry values must be strings, finite numbers or booleans.');
}

export function normalizeBoolean(value) {
  if (typeof value === 'boolean') {
    return value;
  }

  if (value === 'true' || value === '1' || value === 1) {
    return true;
  }

  if (value === 'false' || value === '0' || value === 0 || value === undefined || value === null || value === '') {
    return false;
  }

  throw new Error('decouplingStatus must be a boolean-compatible value.');
}
