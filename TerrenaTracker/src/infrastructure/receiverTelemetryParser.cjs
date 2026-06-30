const RECEIVER_FIELD_COUNT = 8;

const FLIGHT_STATUS_MAP = { 0: "IDLE", 1: "FLYING", 2: "LANDED" };

const COORD_RANGE = {
  latMin: -90, latMax: 90,
  lonMin: -180, lonMax: 180
};

function isValidCoordinate(lat, lon) {
  return Number.isFinite(lat) && Number.isFinite(lon)
    && (lat !== 0 || lon !== 0)
    && lat >= COORD_RANGE.latMin && lat <= COORD_RANGE.latMax
    && lon >= COORD_RANGE.lonMin && lon <= COORD_RANGE.lonMax;
}

function stripEspLogPrefix(line) {
  const cleaned = line
    .replace(/\x1b\[[0-9;]*m/g, '')
    .replace(/\[[0-9;]+m/g, '')
    .replace(/^[IWE]\s*\(\d+\)\s+[^:]+:\s*/, '')
    .trim();
  return cleaned;
}

function parseReceiverCSV(line) {
  if (!line || typeof line !== 'string') return null;

  const trimmed = stripEspLogPrefix(line);
  if (!trimmed) return null;

  const parts = trimmed.split(',').map(p => p.trim());
  if (parts.length !== RECEIVER_FIELD_COUNT) return null;

  const rocketLat = parseFloat(parts[0]);
  const rocketLon = parseFloat(parts[1]);
  const rocketAlt = parseFloat(parts[2]);
  if (!isValidCoordinate(rocketLat, rocketLon)) return null;

  const flightStatusNum = parseInt(parts[3], 10);
  const alarmActive = parts[4] === '1';
  const timestamp = parseInt(parts[5], 10);
  const groundLat = parseFloat(parts[6]);
  const groundLon = parseFloat(parts[7]);
  if (!isValidCoordinate(groundLat, groundLon)) return null;

  return {
    rocket: {
      latitude: rocketLat,
      longitude: rocketLon,
      altitude: Number.isFinite(rocketAlt) ? rocketAlt : null
    },
    flight: {
      status: FLIGHT_STATUS_MAP[flightStatusNum] || "UNKNOWN",
      alarm: alarmActive
    },
    signal: {
      timestamp: Number.isFinite(timestamp) ? timestamp : null,
      rssi: null,
      snr: null
    },
    ground: {
      latitude: groundLat,
      longitude: groundLon
    },
    wind: null,
    compass: null
  };
}

function isReceiverLine(line) {
  if (!line || typeof line !== 'string') return false;
  const trimmed = stripEspLogPrefix(line).trim();
  if (!trimmed) return false;
  const parts = trimmed.split(',').map(p => p.trim());
  if (parts.length !== RECEIVER_FIELD_COUNT) return false;

  const firstVal = parseFloat(parts[0]);
  const secondVal = parseFloat(parts[1]);
  return Number.isFinite(firstVal) && Number.isFinite(secondVal);
}

module.exports = { isValidCoordinate, parseReceiverCSV, isReceiverLine, stripEspLogPrefix };
