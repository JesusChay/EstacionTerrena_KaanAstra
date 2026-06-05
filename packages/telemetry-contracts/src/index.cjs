const TELEMETRY_SAMPLE_FIELDS = Object.freeze([
  'time',
  'speed',
  'temperature',
  'pressure',
  'accelx',
  'accely',
  'accelz',
  'atotal',
  'gyrox',
  'gyroy',
  'gyroz',
  'gyroxRad',
  'gyroyRad',
  'gyrozRad',
  'magx',
  'magy',
  'magz',
  'altitude',
  'latitude',
  'longitude',
  'sourceChannel',
  'receiverLatitude',
  'receiverLongitude',
  'distanceToReceiver',
  'velocity',
  'velocityZ',
  'relativeAltitude',
  'decouplingStatus'
]);

const TELEMETRY_READ_MODEL_FIELDS = Object.freeze([
  'id',
  ...TELEMETRY_SAMPLE_FIELDS,
  'receivedAtUtc'
]);

const TELEMETRY_BOOLEAN_FIELDS = Object.freeze(['decouplingStatus']);
const TELEMETRY_SAMPLE_REQUIRED_FIELDS = Object.freeze([]);

const TELEMETRY_API_BASE_PATH = '/api';
const TELEMETRY_API_PATHS = Object.freeze({
  health: '/health',
  schema: '/schema',
  latest: '/latest',
  recent: '/recent',
  report: '/report',
  telemetry: '/telemetry'
});

const TELEMETRY_API_ROUTES = Object.freeze(
  Object.fromEntries(
    Object.entries(TELEMETRY_API_PATHS).map(([key, value]) => [key, `${TELEMETRY_API_BASE_PATH}${value}`])
  )
);

const TELEMETRY_LIMITS = Object.freeze({
  recent: Object.freeze({ default: 24, max: 120 }),
  report: Object.freeze({ default: 5000, max: 10000 })
});

function pickTelemetryFields(source, fields) {
  if (!source || typeof source !== 'object' || Array.isArray(source)) {
    return {};
  }

  const result = {};
  for (const field of fields) {
    if (Object.prototype.hasOwnProperty.call(source, field)) {
      result[field] = source[field];
    }
  }
  return result;
}

function createTelemetrySampleDto(source) {
  return pickTelemetryFields(source, TELEMETRY_SAMPLE_FIELDS);
}

function createTelemetryReadModelDto(source) {
  return pickTelemetryFields(source, TELEMETRY_READ_MODEL_FIELDS);
}

function getBrowserContractSnapshot() {
  return {
    telemetrySampleFields: [...TELEMETRY_SAMPLE_FIELDS],
    telemetryReadModelFields: [...TELEMETRY_READ_MODEL_FIELDS],
    telemetryBooleanFields: [...TELEMETRY_BOOLEAN_FIELDS],
    telemetrySampleRequiredFields: [...TELEMETRY_SAMPLE_REQUIRED_FIELDS],
    apiBasePath: TELEMETRY_API_BASE_PATH,
    apiPaths: { ...TELEMETRY_API_PATHS },
    apiRoutes: { ...TELEMETRY_API_ROUTES },
    limits: {
      recent: { ...TELEMETRY_LIMITS.recent },
      report: { ...TELEMETRY_LIMITS.report }
    }
  };
}

module.exports = Object.freeze({
  TELEMETRY_SAMPLE_FIELDS,
  TELEMETRY_READ_MODEL_FIELDS,
  TELEMETRY_BOOLEAN_FIELDS,
  TELEMETRY_SAMPLE_REQUIRED_FIELDS,
  TELEMETRY_API_BASE_PATH,
  TELEMETRY_API_PATHS,
  TELEMETRY_API_ROUTES,
  TELEMETRY_LIMITS,
  pickTelemetryFields,
  createTelemetrySampleDto,
  createTelemetryReadModelDto,
  getBrowserContractSnapshot
});
