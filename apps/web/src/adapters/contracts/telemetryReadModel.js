const DEFAULT_SAMPLE_FIELDS = [
  'time', 'speed', 'temperature', 'pressure',
  'accelx', 'accely', 'accelz', 'atotal',
  'gyrox', 'gyroy', 'gyroz', 'gyroxRad', 'gyroyRad', 'gyrozRad',
  'magx', 'magy', 'magz',
  'altitude', 'latitude', 'longitude',
  'sourceChannel', 'receiverLatitude', 'receiverLongitude',
  'distanceToReceiver', 'velocity', 'velocityZ', 'relativeAltitude', 'decouplingStatus'
];

const DEFAULT_READ_MODEL_FIELDS = ['id', ...DEFAULT_SAMPLE_FIELDS, 'receivedAtUtc'];
const DEFAULT_REPORT_EXPORT_FIELDS = [
  'id', 'time', 'speed', 'temperature', 'pressure',
  'accelx', 'accely', 'accelz', 'atotal',
  'gyrox', 'gyroy', 'gyroz', 'gyroxRad', 'gyroyRad', 'gyrozRad',
  'magx', 'magy', 'magz',
  'altitude', 'relativeAltitude',
  'latitude', 'longitude',
  'velocity', 'velocityZ',
  'decouplingStatus', 'receivedAtUtc'
];

const DEFAULT_REPORT_FIELD_LABELS = {
  id: 'ID',
  time: 'Hora',
  speed: 'Velocidad del viento (m/s)',
  temperature: 'Temperatura (C)',
  pressure: 'Presion (hPa)',
  accelx: 'Aceleracion X (g)',
  accely: 'Aceleracion Y (g)',
  accelz: 'Aceleracion Z (g)',
  atotal: 'Aceleracion Total (g)',
  gyrox: 'Giroscopio X (deg/s)',
  gyroy: 'Giroscopio Y (deg/s)',
  gyroz: 'Giroscopio Z (deg/s)',
  gyroxRad: 'Giroscopio X (rad/s)',
  gyroyRad: 'Giroscopio Y (rad/s)',
  gyrozRad: 'Giroscopio Z (rad/s)',
  magx: 'Magnetometro X',
  magy: 'Magnetometro Y',
  magz: 'Magnetometro Z',
  altitude: 'Altitud absoluta (m)',
  relativeAltitude: 'Altitud relativa (m)',
  latitude: 'Latitud',
  longitude: 'Longitud',
  velocity: 'Velocidad horizontal (m/s)',
  velocityZ: 'Velocidad vertical (m/s)',
  decouplingStatus: 'Desacople',
  receivedAtUtc: 'Recibido UTC'
};

let configuredContracts = {};

export function configureTelemetryReadModel({ contracts = {} } = {}) {
  configuredContracts = contracts && typeof contracts === 'object' ? { ...contracts } : {};
}

export function getTelemetryReadModelFields() {
  const fields = configuredContracts.telemetryReadModelFields;
  return Array.isArray(fields) && fields.length > 0 ? [...fields] : [...DEFAULT_READ_MODEL_FIELDS];
}

export function normalizeTelemetryRecord(record) {
  if (!record || typeof record !== 'object') {
    return null;
  }

  const normalized = {};
  getTelemetryReadModelFields().forEach((field) => {
    if (Object.prototype.hasOwnProperty.call(record, field)) {
      normalized[field] = record[field];
    }
  });

  return normalized;
}

export function normalizeTelemetryRecords(rows) {
  if (!Array.isArray(rows)) return [];
  return rows.map(normalizeTelemetryRecord).filter(Boolean);
}

export function getReportExportFields() {
  const readModelFields = getTelemetryReadModelFields();
  return readModelFields.filter((field) => DEFAULT_REPORT_EXPORT_FIELDS.includes(field));
}

export function getReportFieldLabels() {
  return { ...DEFAULT_REPORT_FIELD_LABELS };
}

export function formatReportValue(field, value) {
  if (field === 'decouplingStatus') {
    return value ? 'Activo' : 'Inactivo';
  }

  return value ?? '';
}
