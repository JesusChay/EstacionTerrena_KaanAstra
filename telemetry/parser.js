function toNumber(value) {
    const n = parseFloat(value);
    return Number.isFinite(n) ? n : undefined;
}

function normalizePressureToHpa(pressure) {
    if (!Number.isFinite(pressure)) return undefined;
    return pressure > 2000 ? pressure / 100 : pressure;
}

function normalizeSourceChannel(source) {
    if (!source) return undefined;
    const normalized = String(source).trim().toLowerCase();
    if (normalized.includes('lora')) return 'lora';
    if (normalized.includes('xbee')) return 'xbee';
    return normalized;
}

const TAGGED_TELEMETRY_FIELDS = {
    SRC: 'sourceChannel',
    SOURCE: 'sourceChannel',
    LAT: 'latitude',
    LON: 'longitude',
    LNG: 'longitude',
    SPEED: 'speed',
    TEMP: 'temperature',
    HUM: 'humidity',
    PRES: 'pressure',
    PRESSURE: 'pressure',
    ACCX: 'accelx',
    ACCY: 'accely',
    ACCZ: 'accelz',
    ATOTAL: 'atotal',
    GYROX: 'gyrox',
    GYROY: 'gyroy',
    GYROZ: 'gyroz',
    GYROXRAD: 'gyroxRad',
    GYROYRAD: 'gyroyRad',
    GYROZRAD: 'gyrozRad',
    MAGX: 'magx',
    MAGY: 'magy',
    MAGZ: 'magz',
    ALT: 'altitude',
    ALTITUDE: 'altitude',
    RXLAT: 'receiverLatitude',
    RXLON: 'receiverLongitude',
    DIST: 'distanceToReceiver',
    DISTANCE: 'distanceToReceiver',
    RELALT: 'relativeAltitude',
    RELATIVEALTITUDE: 'relativeAltitude',
    VEL: 'velocity',
    VELZ: 'velocityZ',
    DECOUP: 'decouplingStatus',
    DECOUPLING: 'decouplingStatus'
};

function isTelemetryLine(line) {
    return line.startsWith('[PAYLOAD]') ||
        line.startsWith('[PRIMARY]') ||
        line.startsWith('[SECONDARY]') ||
        line.startsWith('[LORA]') ||
        line.startsWith('[XBEE]') ||
        /(?:^|[,\s])LAT\s*[:=]/i.test(line) ||
        /(?:^|[,\s])LON\s*[:=]/i.test(line) ||
        /^TX\s*:/i.test(line);
}

function parseTaggedTelemetry(message) {
    let text = message.trim();
    const parsed = {};

    const bracketMatch = text.match(/^\[(LORA|XBEE)\]\s*/i);
    if (bracketMatch) {
        parsed.sourceChannel = normalizeSourceChannel(bracketMatch[1]);
        text = text.slice(bracketMatch[0].length).trim();
    }

    const explicitSourceMatch = text.match(/\b(?:SOURCE|SRC)\s*[:=]\s*([A-Za-z0-9_-]+)/i);
    if (explicitSourceMatch) {
        parsed.sourceChannel = normalizeSourceChannel(explicitSourceMatch[1]);
    }

    const txMatch = text.match(/^TX\s*:\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)/i);
    if (txMatch) {
        parsed.latitude = toNumber(txMatch[1]);
        parsed.longitude = toNumber(txMatch[2]);
    }

    const rxMatch = text.match(/(?:^|\|\s*)RX\s*:\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)/i);
    if (rxMatch) {
        parsed.receiverLatitude = toNumber(rxMatch[1]);
        parsed.receiverLongitude = toNumber(rxMatch[2]);
    }

    const distanceMatch = text.match(/\bD\s*=\s*(-?\d+(?:\.\d+)?)\s*m?/i);
    if (distanceMatch) {
        parsed.distanceToReceiver = toNumber(distanceMatch[1]);
    }

    const latLonMatch = text.match(/LAT\s*[:=]\s*(-?\d+(?:\.\d+)?)\s*,\s*LON\s*[:=]\s*(-?\d+(?:\.\d+)?)/i);
    if (latLonMatch) {
        parsed.latitude = toNumber(latLonMatch[1]);
        parsed.longitude = toNumber(latLonMatch[2]);
    }

    const keyValueRegex = /([A-Za-z][A-Za-z0-9_]*)\s*[:=]\s*([^,|]+)/g;
    let match;
    while ((match = keyValueRegex.exec(text)) !== null) {
        const rawKey = match[1].replace(/_/g, '').toUpperCase();
        const targetKey = TAGGED_TELEMETRY_FIELDS[rawKey];
        if (!targetKey) continue;

        const rawValue = match[2].trim();
        if (targetKey === 'sourceChannel') {
            parsed[targetKey] = normalizeSourceChannel(rawValue);
        } else if (targetKey === 'decouplingStatus') {
            parsed[targetKey] = ['true', '1', 'on', 'activo'].includes(rawValue.toLowerCase());
        } else if (targetKey === 'pressure') {
            parsed[targetKey] = normalizePressureToHpa(toNumber(rawValue));
        } else {
            parsed[targetKey] = toNumber(rawValue);
        }
    }

    if (parsed.latitude !== undefined || parsed.longitude !== undefined || parsed.sourceChannel !== undefined) {
        return parsed;
    }

    return null;
}

function parsePayloadCsv(csv) {
    const parts = csv.split(',').map((p) => p.trim());

    if (parts.length === 17) {
        const speed = toNumber(parts[0]);
        const temperature = toNumber(parts[1]);
        const humidity = toNumber(parts[2]);
        const pressure = normalizePressureToHpa(toNumber(parts[3]));
        const accelx = toNumber(parts[4]);
        const accely = toNumber(parts[5]);
        const accelz = toNumber(parts[6]);
        const gyrox = toNumber(parts[7]);
        const gyroy = toNumber(parts[8]);
        const gyroz = toNumber(parts[9]);
        const magx = toNumber(parts[10]);
        const magy = toNumber(parts[11]);
        const magz = toNumber(parts[12]);
        const altitude = toNumber(parts[13]);
        const latitude = toNumber(parts[14]);
        const longitude = toNumber(parts[15]);
        const decouplingStatus = parts[16].toLowerCase() === 'true';

        if ([speed, temperature, humidity, pressure, accelx, accely, accelz, gyrox, gyroy, gyroz, magx, magy, magz, altitude, latitude, longitude].some((v) => v === undefined)) {
            return null;
        }

        return { speed, temperature, humidity, pressure, accelx, accely, accelz, gyrox, gyroy, gyroz, magx, magy, magz, altitude, latitude, longitude, decouplingStatus };
    }

    if (parts.length === 14) {
        const nums = parts.slice(0, 13).map(toNumber);
        if (nums.some((v) => v === undefined)) {
            return null;
        }
        const [speed, accelx, accely, accelz, gyrox, gyroy, gyroz, magx, magy, magz, altitude, latitude, longitude] = nums;
        const decouplingStatus = parts[13].toLowerCase() === 'true';
        return { speed, accelx, accely, accelz, gyrox, gyroy, gyroz, magx, magy, magz, altitude, latitude, longitude, decouplingStatus };
    }

    if (parts.length === 12) {
        const nums = parts.map(toNumber);
        if (nums.some((v) => v === undefined)) {
            return null;
        }
        const [temperature, accelx, accely, accelz, gyrox, gyroy, gyroz, humidity, pressurePa, altitude, latitude, longitude] = nums;
        const pressure = normalizePressureToHpa(pressurePa);
        return { temperature, accelx, accely, accelz, gyrox, gyroy, gyroz, humidity, pressure, altitude, latitude, longitude };
    }

    return null;
}

function parseTelemetryMessage(message) {
    return parseTaggedTelemetry(message) || parsePayloadCsv(message);
}

module.exports = {
    isTelemetryLine,
    parseTaggedTelemetry,
    parsePayloadCsv,
    parseTelemetryMessage,
    normalizeSourceChannel,
    normalizePressureToHpa,
    toNumber
};
