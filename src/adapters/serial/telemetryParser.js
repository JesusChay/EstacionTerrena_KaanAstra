const TERRENA_FIELD_NAMES = [
  'temperature', 'pressure', 'altitude',
  'accelx', 'accely', 'accelz',
  'gyrox', 'gyroy', 'gyroz',
  'magx', 'magy', 'magz',
  'latitude', 'longitude'
];

const SIMULATION_FIELD_NAMES = [
  'speed', 'temperature', 'pressure',
  'accelx', 'accely', 'accelz',
  'gyrox', 'gyroy', 'gyroz',
  'magx', 'magy', 'magz',
  'altitude', 'latitude', 'longitude',
  'decouplingStatus'
];

function parseCSV(csvPart, fieldNames) {
  const values = csvPart.split(',').map((value) => value.trim());
  if (values.length !== fieldNames.length) return null;

  const result = {};
  let validCount = 0;
  fieldNames.forEach((name, index) => {
    const numberValue = parseFloat(values[index]);
    if (Number.isFinite(numberValue)) {
      result[name] = numberValue;
      validCount += 1;
    } else if (name === 'decouplingStatus') {
      result[name] = values[index].toLowerCase() === 'true';
    }
  });

  if (validCount === 0) return null;
  return result;
}

function parseTerrenaFormat(line) {
  const match = line.match(/^(XBEE|LORA):\s*(.+)/i);
  if (!match) return null;

  const sourceChannel = match[1].toLowerCase();
  const parsed = parseCSV(match[2], TERRENA_FIELD_NAMES);
  if (!parsed) return null;

  parsed.sourceChannel = sourceChannel;
  return parsed;
}

function parseGroundStationFormat(line) {
  const match = line.match(/^(XBEE|LORA),(\d+),(.+)$/i);
  if (!match) return null;

  const sourceChannel = match[1].toLowerCase();
  const parsed = parseCSV(match[3], TERRENA_FIELD_NAMES);
  if (!parsed) return null;

  parsed.sourceChannel = sourceChannel;
  return parsed;
}

function parseTelemetryMessage(line) {
  if (!line || typeof line !== 'string') return null;
  const trimmed = line.trim();
  if (!trimmed) return null;

  const gs = parseGroundStationFormat(trimmed);
  if (gs) return gs;

  const terrena = parseTerrenaFormat(trimmed);
  if (terrena) return terrena;

  const raw14 = parseCSV(trimmed, TERRENA_FIELD_NAMES);
  if (raw14) return raw14;

  const raw16 = parseCSV(trimmed, SIMULATION_FIELD_NAMES);
  if (raw16) return raw16;

  return null;
}

function isTelemetryLine(line) {
  if (!line || typeof line !== 'string') return false;
  const trimmed = line.trim();
  if (!trimmed) return false;

  if (/^(XBEE|LORA):\s*\d/si.test(trimmed)) return true;
  if (/^(XBEE|LORA),\d+,/i.test(trimmed)) return true;
  if (/^\[(XBEE|LORA|PAYLOAD|PRIMARY|SECONDARY)\]/i.test(trimmed)) return true;

  const commaCount = (trimmed.match(/,/g) || []).length;
  if (commaCount >= 13 && commaCount <= 15) {
    const first = parseFloat(trimmed.split(',')[0]);
    return Number.isFinite(first);
  }

  return false;
}

module.exports = { parseTelemetryMessage, isTelemetryLine };
