const RECEIVER_FIELD_COUNT = 12;

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
  if (!Number.isFinite(rocketLat) || !Number.isFinite(rocketLon)) return null;

  const flightStatus = parts[3] || '';
  const alarmActive = parts[4] === 'ON' || parts[4] === '1';
  const timestamp = parseInt(parts[5], 10);
  const rssi = parseInt(parts[6], 10);
  const snr = parseInt(parts[7], 10);
  const groundLat = parseFloat(parts[8]);
  const groundLon = parseFloat(parts[9]);
  const windVelocity = parseFloat(parts[10]);
  const compassDir = parts[11] || '';

  return {
    rocket: {
      latitude: rocketLat,
      longitude: rocketLon,
      altitude: Number.isFinite(rocketAlt) ? rocketAlt : null
    },
    flight: {
      status: flightStatus,
      alarm: alarmActive
    },
    signal: {
      timestamp: Number.isFinite(timestamp) ? timestamp : null,
      rssi: Number.isFinite(rssi) ? rssi : null,
      snr: Number.isFinite(snr) ? snr : null
    },
    ground: {
      latitude: Number.isFinite(groundLat) ? groundLat : null,
      longitude: Number.isFinite(groundLon) ? groundLon : null
    },
    wind: {
      velocity: Number.isFinite(windVelocity) ? windVelocity : null
    },
    compass: {
      direction: compassDir
    }
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

module.exports = { parseReceiverCSV, isReceiverLine, stripEspLogPrefix };
