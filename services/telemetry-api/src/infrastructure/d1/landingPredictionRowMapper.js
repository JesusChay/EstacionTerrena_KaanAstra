import telemetryContracts from '../../../../../packages/telemetry-contracts/src/index.cjs';

const { createLandingPredictionReadModelDto } = telemetryContracts;

export const landingPredictionSelectFields = `
  id,
  status,
  phase,
  confidence,
  model_version AS modelVersion,
  wind_profile_source AS windProfileSource,
  observed_at_utc AS observedAtUtc,
  eta_seconds AS etaSeconds,
  uncertainty_radius_meters AS uncertaintyRadiusMeters,
  altitude_agl_meters AS altitudeAglMeters,
  current_descent_rate_mps AS currentDescentRateMps,
  time_to_deploy_seconds AS timeToDeploySeconds,
  deploy_altitude_meters AS deployAltitudeMeters,
  current_latitude AS currentLatitude,
  current_longitude AS currentLongitude,
  predicted_landing_latitude AS predictedLandingLatitude,
  predicted_landing_longitude AS predictedLandingLongitude,
  payload_json AS payloadJson,
  received_at_utc AS receivedAtUtc
`;

export function mapLandingPredictionRow(row) {
  if (!row) {
    return null;
  }

  const payload = parsePayloadJson(row.payloadJson);
  const currentLocation = payload.currentLocation || createCoordinate(row.currentLatitude, row.currentLongitude);
  const predictedLanding = payload.predictedLanding || createCoordinate(row.predictedLandingLatitude, row.predictedLandingLongitude);

  return createLandingPredictionReadModelDto({
    ...payload,
    id: row.id,
    status: row.status ?? payload.status ?? null,
    phase: row.phase ?? payload.phase ?? null,
    confidence: row.confidence ?? payload.confidence ?? null,
    modelVersion: row.modelVersion ?? payload.modelVersion ?? null,
    windProfileSource: row.windProfileSource ?? payload.windProfileSource ?? null,
    observedAtUtc: row.observedAtUtc ?? payload.observedAtUtc ?? null,
    etaSeconds: row.etaSeconds ?? payload.etaSeconds ?? null,
    uncertaintyRadiusMeters: row.uncertaintyRadiusMeters ?? payload.uncertaintyRadiusMeters ?? null,
    altitudeAglMeters: row.altitudeAglMeters ?? payload.altitudeAglMeters ?? null,
    currentDescentRateMps: row.currentDescentRateMps ?? payload.currentDescentRateMps ?? null,
    timeToDeploySeconds: row.timeToDeploySeconds ?? payload.timeToDeploySeconds ?? null,
    deployAltitudeMeters: row.deployAltitudeMeters ?? payload.deployAltitudeMeters ?? null,
    currentLocation,
    predictedLanding,
    receivedAtUtc: row.receivedAtUtc ?? payload.receivedAtUtc ?? null
  });
}

function createCoordinate(latitude, longitude) {
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    return null;
  }

  return { latitude, longitude };
}

function parsePayloadJson(payloadJson) {
  if (typeof payloadJson !== 'string' || payloadJson.trim() === '') {
    return {};
  }

  try {
    const payload = JSON.parse(payloadJson);
    return payload && typeof payload === 'object' && !Array.isArray(payload)
      ? payload
      : {};
  } catch {
    return {};
  }
}
