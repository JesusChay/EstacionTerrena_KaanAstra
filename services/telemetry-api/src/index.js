const allowedFields = [
  'time',
  'speed',
  'temperature',
  'humidity',
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
];

const selectFields = [
  'id',
  'time',
  'speed',
  'temperature',
  'humidity',
  'pressure',
  'accelx',
  'accely',
  'accelz',
  'atotal',
  'gyrox',
  'gyroy',
  'gyroz',
  'gyrox_rad AS gyroxRad',
  'gyroy_rad AS gyroyRad',
  'gyroz_rad AS gyrozRad',
  'magx',
  'magy',
  'magz',
  'altitude',
  'latitude',
  'longitude',
  'source_channel AS sourceChannel',
  'receiver_latitude AS receiverLatitude',
  'receiver_longitude AS receiverLongitude',
  'distance_to_receiver AS distanceToReceiver',
  'velocity',
  'velocity_z AS velocityZ',
  'relative_altitude AS relativeAltitude',
  'decoupling_status AS decouplingStatus',
  'received_at_utc AS receivedAtUtc'
].join(', ');

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: buildCorsHeaders() });
    }

    const url = new URL(request.url);

    try {
      if (request.method === 'GET' && url.pathname === '/api/health') {
        const databaseAvailable = Boolean(env.TELEMETRY_DB);
        const latestTelemetry = databaseAvailable ? await readLatestTelemetry(env) : null;

        return json({
          ok: true,
          service: 'telemetry-api',
          persistence: databaseAvailable ? 'cloudflare-d1' : 'not-configured',
          databaseAvailable,
          latestAvailable: Boolean(latestTelemetry)
        });
      }

      if (request.method === 'GET' && url.pathname === '/api/schema') {
        return json({
          fields: allowedFields,
          required: [],
          accepts: 'application/json',
          persistence: 'cloudflare-d1',
          notes: [
            'El contrato replica el payloadData actual de la estacion terrena.',
            'El Worker guarda cada muestra en D1 para exponer latest e historial reciente.'
          ]
        });
      }

      if (!env.TELEMETRY_DB) {
        return json({ ok: false, message: 'TELEMETRY_DB binding is not configured.' }, 503);
      }

      if (request.method === 'GET' && url.pathname === '/api/latest') {
        const latestTelemetry = await readLatestTelemetry(env);
        if (!latestTelemetry) {
          return json({ ok: false, message: 'No telemetry available yet.' }, 404);
        }

        return json({ ok: true, telemetry: latestTelemetry });
      }

      if (request.method === 'GET' && url.pathname === '/api/recent') {
        const requestedLimit = Number.parseInt(url.searchParams.get('limit') || '24', 10);
        const maxLimit = Number.parseInt(env.RECENT_LIMIT || '120', 10);
        const limit = Number.isFinite(requestedLimit) ? Math.min(Math.max(requestedLimit, 1), maxLimit) : 24;
        const recentTelemetry = await readRecentTelemetry(env, limit);

        return json({
          ok: true,
          telemetry: recentTelemetry,
          persistence: 'cloudflare-d1'
        });
      }

      if (request.method === 'GET' && url.pathname === '/api/report') {
        const requestedLimit = Number.parseInt(url.searchParams.get('limit') || '5000', 10);
        const limit = Number.isFinite(requestedLimit) ? Math.min(Math.max(requestedLimit, 1), 10000) : 5000;
        const telemetry = await readReportTelemetry(env, limit);

        return json({
          ok: true,
          telemetry,
          count: telemetry.length,
          persistence: 'cloudflare-d1'
        });
      }

      if (request.method === 'POST' && url.pathname === '/api/telemetry') {
        const contentType = request.headers.get('content-type') || '';
        if (!contentType.includes('application/json')) {
          return json({ ok: false, message: 'Content-Type must be application/json.' }, 415);
        }

        const body = await request.json();
        const incomingTelemetry = body && typeof body === 'object' && body.telemetry ? body.telemetry : body;
        const telemetry = normalizeTelemetry(incomingTelemetry);
        const latestTelemetry = await insertTelemetry(env, telemetry);

        return json({
          ok: true,
          message: 'Telemetry accepted.',
          telemetry: latestTelemetry
        }, 202);
      }

      return json({ ok: false, message: 'Route not found.' }, 404);
    } catch (error) {
      return json({ ok: false, message: error.message || 'Unexpected error.' }, 400);
    }
  }
};

function normalizeTelemetry(payload) {
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

async function insertTelemetry(env, telemetry) {
  const receivedAtUtc = new Date().toISOString();
  const sql = `
    INSERT INTO telemetry (
      time, speed, temperature, humidity, pressure,
      accelx, accely, accelz, atotal,
      gyrox, gyroy, gyroz, gyrox_rad, gyroy_rad, gyroz_rad,
      magx, magy, magz,
      altitude, latitude, longitude, source_channel, receiver_latitude, receiver_longitude, distance_to_receiver,
      velocity, velocity_z, relative_altitude,
      decoupling_status, received_at_utc
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `;

  const values = [
    telemetry.time ?? null,
    telemetry.speed ?? null,
    telemetry.temperature ?? null,
    telemetry.humidity ?? null,
    telemetry.pressure ?? null,
    telemetry.accelx ?? null,
    telemetry.accely ?? null,
    telemetry.accelz ?? null,
    telemetry.atotal ?? null,
    telemetry.gyrox ?? null,
    telemetry.gyroy ?? null,
    telemetry.gyroz ?? null,
    telemetry.gyroxRad ?? null,
    telemetry.gyroyRad ?? null,
    telemetry.gyrozRad ?? null,
    telemetry.magx ?? null,
    telemetry.magy ?? null,
    telemetry.magz ?? null,
    telemetry.altitude ?? null,
    telemetry.latitude ?? null,
    telemetry.longitude ?? null,
    telemetry.sourceChannel ?? null,
    telemetry.receiverLatitude ?? null,
    telemetry.receiverLongitude ?? null,
    telemetry.distanceToReceiver ?? null,
    telemetry.velocity ?? null,
    telemetry.velocityZ ?? null,
    telemetry.relativeAltitude ?? null,
    telemetry.decouplingStatus ? 1 : 0,
    receivedAtUtc
  ];

  const result = await env.TELEMETRY_DB.prepare(sql).bind(...values).run();
  const insertedId = result.meta.last_row_id;
  const insertedTelemetry = await env.TELEMETRY_DB
    .prepare(`SELECT ${selectFields} FROM telemetry WHERE id = ? LIMIT 1`)
    .bind(insertedId)
    .first();

  return mapTelemetryRow(insertedTelemetry);
}

async function readLatestTelemetry(env) {
  const row = await env.TELEMETRY_DB
    .prepare(`SELECT ${selectFields} FROM telemetry ORDER BY id DESC LIMIT 1`)
    .first();

  return mapTelemetryRow(row);
}

async function readRecentTelemetry(env, limit) {
  const result = await env.TELEMETRY_DB
    .prepare(`SELECT ${selectFields} FROM telemetry ORDER BY id DESC LIMIT ?`)
    .bind(limit)
    .all();

  const rows = Array.isArray(result.results) ? result.results : [];
  return rows.map(mapTelemetryRow).reverse();
}

async function readReportTelemetry(env, limit) {
  const result = await env.TELEMETRY_DB
    .prepare(`SELECT ${selectFields} FROM telemetry ORDER BY id ASC LIMIT ?`)
    .bind(limit)
    .all();

  const rows = Array.isArray(result.results) ? result.results : [];
  return rows.map(mapTelemetryRow);
}

function mapTelemetryRow(row) {
  if (!row) {
    return null;
  }

  return {
    id: row.id,
    time: row.time,
    speed: row.speed,
    temperature: row.temperature,
    humidity: row.humidity,
    pressure: row.pressure,
    accelx: row.accelx,
    accely: row.accely,
    accelz: row.accelz,
    atotal: row.atotal,
    gyrox: row.gyrox,
    gyroy: row.gyroy,
    gyroz: row.gyroz,
    gyroxRad: row.gyroxRad,
    gyroyRad: row.gyroyRad,
    gyrozRad: row.gyrozRad,
    magx: row.magx,
    magy: row.magy,
    magz: row.magz,
    altitude: row.altitude,
    latitude: row.latitude,
    longitude: row.longitude,
    sourceChannel: row.sourceChannel,
    receiverLatitude: row.receiverLatitude,
    receiverLongitude: row.receiverLongitude,
    distanceToReceiver: row.distanceToReceiver,
    velocity: row.velocity,
    velocityZ: row.velocityZ,
    relativeAltitude: row.relativeAltitude,
    decouplingStatus: Boolean(row.decouplingStatus),
    receivedAtUtc: row.receivedAtUtc
  };
}

function normalizeScalar(value) {
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

function normalizeBoolean(value) {
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

function json(payload, status = 200) {
  return new Response(JSON.stringify(payload, null, 2), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      ...buildCorsHeaders()
    }
  });
}

function buildCorsHeaders() {
  return {
    'access-control-allow-origin': '*',
    'access-control-allow-methods': 'GET,POST,OPTIONS',
    'access-control-allow-headers': 'Content-Type'
  };
}
