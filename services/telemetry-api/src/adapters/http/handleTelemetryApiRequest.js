import { getHealthStatus } from '../../application/use-cases/getHealthStatus.js';
import { getLatestLandingPrediction } from '../../application/use-cases/getLatestLandingPrediction.js';
import { getLatestTelemetry } from '../../application/use-cases/getLatestTelemetry.js';
import { getRecentLandingPredictions } from '../../application/use-cases/getRecentLandingPredictions.js';
import { getRecentTelemetry } from '../../application/use-cases/getRecentTelemetry.js';
import { getTelemetryReport } from '../../application/use-cases/getTelemetryReport.js';
import { ingestLandingPrediction } from '../../application/use-cases/ingestLandingPrediction.js';
import { ingestTelemetry } from '../../application/use-cases/ingestTelemetry.js';
import { resolveQueryLimit } from '../../application/resolveQueryLimit.js';
import { allowedLandingPredictionFields, requiredLandingPredictionFields } from '../../domain/landingPredictionSchema.js';
import { allowedFields, requiredFields } from '../../domain/telemetrySchema.js';
import { createTelemetryRepository } from '../../infrastructure/d1/telemetryRepository.js';
import { buildCorsHeaders, json } from './json.js';
import { normalizeIncomingLandingPrediction } from './normalizeIncomingLandingPrediction.js';
import { normalizeIncomingTelemetry } from './normalizeIncomingTelemetry.js';
import {
  TELEMETRY_API_ROUTES,
  TELEMETRY_LIMITS,
  telemetryPersistenceName,
  telemetrySchemaNotes,
  telemetryServiceName
} from './telemetryApiHttpConfig.js';
import { toLandingPredictionReadModelDto, toLandingPredictionReadModelDtos } from './toLandingPredictionReadModelDto.js';
import { toTelemetryReadModelDto, toTelemetryReadModelDtos } from './toTelemetryReadModelDto.js';

export async function handleTelemetryApiRequest(request, env) {
  if (request.method === 'OPTIONS') {
    return new Response(null, { headers: buildCorsHeaders() });
  }

  const url = new URL(request.url);
  const repository = env.TELEMETRY_DB
    ? createTelemetryRepository({ db: env.TELEMETRY_DB })
    : null;

  try {
    if (request.method === 'GET' && url.pathname === TELEMETRY_API_ROUTES.health) {
      const health = await getHealthStatus({ repository });
      return json({
        ok: true,
        service: telemetryServiceName,
        persistence: health.databaseAvailable ? telemetryPersistenceName : 'not-configured',
        ...health
      });
    }

    if (request.method === 'GET' && url.pathname === TELEMETRY_API_ROUTES.schema) {
      return json({
        fields: allowedFields,
        landingPredictionFields: allowedLandingPredictionFields,
        landingPredictionRequired: requiredLandingPredictionFields,
        required: requiredFields,
        accepts: 'application/json',
        persistence: telemetryPersistenceName,
        notes: telemetrySchemaNotes
      });
    }

    if (!repository) {
      return json({ ok: false, message: 'TELEMETRY_DB binding is not configured.' }, 503);
    }

    if (request.method === 'GET' && url.pathname === TELEMETRY_API_ROUTES.latest) {
      const telemetry = await getLatestTelemetry({ repository });
      return json({ ok: true, telemetry: toTelemetryReadModelDto(telemetry) });
    }

    if (request.method === 'GET' && url.pathname === TELEMETRY_API_ROUTES.predictionLatest) {
      const prediction = await getLatestLandingPrediction({ repository });
      return json({ ok: true, prediction: toLandingPredictionReadModelDto(prediction) });
    }

    if (request.method === 'GET' && url.pathname === TELEMETRY_API_ROUTES.recent) {
      const maxLimit = Number.parseInt(env.RECENT_LIMIT || String(TELEMETRY_LIMITS.recent.max), 10);
      const limit = resolveQueryLimit(url.searchParams.get('limit'), TELEMETRY_LIMITS.recent.default, maxLimit);
      const telemetry = await getRecentTelemetry({ repository, limit });

      return json({
        ok: true,
        telemetry: toTelemetryReadModelDtos(telemetry),
        persistence: telemetryPersistenceName
      });
    }

    if (request.method === 'GET' && url.pathname === TELEMETRY_API_ROUTES.predictionRecent) {
      const maxLimit = Number.parseInt(env.PREDICTION_RECENT_LIMIT || String(TELEMETRY_LIMITS.predictionRecent.max), 10);
      const limit = resolveQueryLimit(url.searchParams.get('limit'), TELEMETRY_LIMITS.predictionRecent.default, maxLimit);
      const predictions = await getRecentLandingPredictions({ repository, limit });

      return json({
        ok: true,
        predictions: toLandingPredictionReadModelDtos(predictions),
        persistence: telemetryPersistenceName
      });
    }

    if (request.method === 'GET' && url.pathname === TELEMETRY_API_ROUTES.report) {
      const limit = resolveQueryLimit(url.searchParams.get('limit'), TELEMETRY_LIMITS.report.default, TELEMETRY_LIMITS.report.max);
      const sinceParam = url.searchParams.get('since');
      const since = sinceParam || new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
      const report = await getTelemetryReport({ repository, limit, since });

      return json({
        ok: true,
        telemetry: toTelemetryReadModelDtos(report.telemetry),
        count: report.count,
        persistence: telemetryPersistenceName,
        since
      });
    }

    if (request.method === 'POST' && url.pathname === TELEMETRY_API_ROUTES.telemetry) {
      const contentType = request.headers.get('content-type') || '';
      if (!contentType.includes('application/json')) {
        return json({ ok: false, message: 'Content-Type must be application/json.' }, 415);
      }

      const body = await request.json();
      const incomingTelemetry = body && typeof body === 'object' && body.telemetry ? body.telemetry : body;
      const latestTelemetry = await ingestTelemetry({
        repository,
        payload: normalizeIncomingTelemetry(incomingTelemetry)
      });

      return json({
        ok: true,
        message: 'Telemetry accepted.',
        telemetry: toTelemetryReadModelDto(latestTelemetry)
      }, 202);
    }

    if (request.method === 'POST' && url.pathname === TELEMETRY_API_ROUTES.prediction) {
      const contentType = request.headers.get('content-type') || '';
      if (!contentType.includes('application/json')) {
        return json({ ok: false, message: 'Content-Type must be application/json.' }, 415);
      }

      const body = await request.json();
      const incomingPrediction = body && typeof body === 'object' && body.prediction ? body.prediction : body;
      const latestPrediction = await ingestLandingPrediction({
        repository,
        payload: normalizeIncomingLandingPrediction(incomingPrediction)
      });

      return json({
        ok: true,
        message: 'Landing prediction accepted.',
        prediction: toLandingPredictionReadModelDto(latestPrediction)
      }, 202);
    }

    return json({ ok: false, message: 'Route not found.' }, 404);
  } catch (error) {
    const status = error.message === 'No telemetry available yet.' || error.message === 'No landing prediction available yet.'
      ? 404
      : 400;
    return json({ ok: false, message: error.message || 'Unexpected error.' }, status);
  }
}
