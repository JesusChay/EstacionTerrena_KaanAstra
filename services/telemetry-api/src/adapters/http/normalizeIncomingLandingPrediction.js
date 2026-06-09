import { allowedLandingPredictionFields } from '../../domain/landingPredictionSchema.js';

const NUMERIC_FIELDS = new Set([
  'etaSeconds',
  'uncertaintyRadiusMeters',
  'altitudeAglMeters',
  'currentDescentRateMps',
  'timeToDeploySeconds',
  'deployAltitudeMeters'
]);

const OBJECT_FIELDS = new Set([
  'currentLocation',
  'deployPoint',
  'predictedLanding',
  'horizontalVelocityVector',
  'blendedDriftVector',
  'windVector',
  'inputs'
]);

const ARRAY_FIELDS = new Set(['estimatedTrajectory']);

export function normalizeIncomingLandingPrediction(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new Error('Landing prediction payload must be a JSON object.');
  }

  const prediction = {};

  for (const field of allowedLandingPredictionFields) {
    if (!(field in payload)) {
      continue;
    }

    if (NUMERIC_FIELDS.has(field)) {
      prediction[field] = normalizeNumber(payload[field]);
      continue;
    }

    if (OBJECT_FIELDS.has(field)) {
      prediction[field] = normalizeObject(payload[field]);
      continue;
    }

    if (ARRAY_FIELDS.has(field)) {
      prediction[field] = normalizeArray(payload[field]);
      continue;
    }

    prediction[field] = normalizeScalar(payload[field]);
  }

  if (Object.keys(prediction).length === 0) {
    throw new Error('Landing prediction payload does not contain supported fields.');
  }

  return prediction;
}

function normalizeArray(value) {
  if (value === undefined || value === null) {
    return null;
  }

  if (!Array.isArray(value)) {
    throw new Error('Landing prediction array fields must be arrays.');
  }

  return value;
}

function normalizeNumber(value) {
  if (value === undefined || value === null || value === '') {
    return null;
  }

  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number.parseFloat(value.trim());
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }

  throw new Error('Landing prediction numeric fields must be finite numbers.');
}

function normalizeObject(value) {
  if (value === undefined || value === null) {
    return null;
  }

  if (typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Landing prediction object fields must be JSON objects.');
  }

  return value;
}

function normalizeScalar(value) {
  if (value === undefined || value === null || value === '') {
    return null;
  }

  if (typeof value === 'string') {
    return value.trim();
  }

  throw new Error('Landing prediction scalar fields must be strings.');
}
