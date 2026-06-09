const DEFAULT_SAMPLE_FIELDS = [
  'status',
  'phase',
  'confidence',
  'modelVersion',
  'windProfileSource',
  'observedAtUtc',
  'etaSeconds',
  'uncertaintyRadiusMeters',
  'altitudeAglMeters',
  'currentDescentRateMps',
  'timeToDeploySeconds',
  'deployAltitudeMeters',
  'currentLocation',
  'deployPoint',
  'predictedLanding',
  'estimatedTrajectory',
  'horizontalVelocityVector',
  'blendedDriftVector',
  'windVector',
  'inputs'
];

const DEFAULT_READ_MODEL_FIELDS = ['id', ...DEFAULT_SAMPLE_FIELDS, 'receivedAtUtc'];

let configuredContracts = {};

export function configureLandingPredictionReadModel({ contracts = {} } = {}) {
  configuredContracts = contracts && typeof contracts === 'object' ? { ...contracts } : {};
}

export function getLandingPredictionReadModelFields() {
  const fields = configuredContracts.landingPredictionReadModelFields;
  return Array.isArray(fields) && fields.length > 0 ? [...fields] : [...DEFAULT_READ_MODEL_FIELDS];
}

export function normalizeLandingPredictionRecord(record) {
  if (!record || typeof record !== 'object' || Array.isArray(record)) {
    return null;
  }

  const normalized = {};
  getLandingPredictionReadModelFields().forEach((field) => {
    if (Object.prototype.hasOwnProperty.call(record, field)) {
      normalized[field] = record[field];
    }
  });

  return normalized;
}
