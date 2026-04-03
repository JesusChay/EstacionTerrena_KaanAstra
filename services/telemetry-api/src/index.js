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
  'velocity',
  'velocityZ',
  'relativeAltitude',
  'decouplingStatus'
];

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: buildCorsHeaders() });
    }

    const url = new URL(request.url);

    try {
      if (request.method === 'GET' && url.pathname === '/api/health') {
        const latestTelemetry = await readLatestTelemetry(env);
        return json({
          ok: true,
          service: 'telemetry-api',
          persistence: env.TELEMETRY_CACHE ? 'cloudflare-kv' : 'memory-temporary',
          latestAvailable: Boolean(latestTelemetry)
        });
      }

      if (request.method === 'GET' && url.pathname === '/api/schema') {
        return json({
          fields: allowedFields,
          required: [],
          accepts: 'application/json',
          notes: [
            'El contrato replica el payloadData actual de la estacion terrena.',
            'La persistencia actual es temporal en memoria y sera reemplazada por BD.'
          ]
        });
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
        const recentTelemetry = await readRecentTelemetry(env);

        return json({
          ok: true,
          telemetry: recentTelemetry.slice(-limit),
          persistence: env.TELEMETRY_CACHE ? 'cloudflare-kv' : 'memory-temporary'
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

        const latestTelemetry = {
          ...telemetry,
          receivedAtUtc: new Date().toISOString()
        };

        const recentTelemetry = await writeTelemetry(env, latestTelemetry);

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

async function readLatestTelemetry(env) {
  if (!env.TELEMETRY_CACHE) {
    return null;
  }

  const raw = await env.TELEMETRY_CACHE.get('latest');
  return raw ? JSON.parse(raw) : null;
}

async function readRecentTelemetry(env) {
  if (!env.TELEMETRY_CACHE) {
    return [];
  }

  const raw = await env.TELEMETRY_CACHE.get('recent');
  return raw ? JSON.parse(raw) : [];
}

async function writeTelemetry(env, latestTelemetry) {
  if (!env.TELEMETRY_CACHE) {
    return [latestTelemetry];
  }

  const maxLimit = Number.parseInt(env.RECENT_LIMIT || '120', 10);
  const recentTelemetry = await readRecentTelemetry(env);
  recentTelemetry.push(latestTelemetry);
  const boundedTelemetry = recentTelemetry.slice(-maxLimit);

  await Promise.all([
    env.TELEMETRY_CACHE.put('latest', JSON.stringify(latestTelemetry)),
    env.TELEMETRY_CACHE.put('recent', JSON.stringify(boundedTelemetry))
  ]);

  return boundedTelemetry;
}

function normalizeScalar(value) {
  if (value === undefined || value === null || value === '') {
    return undefined;
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
