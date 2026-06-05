# Fase 4 - API de telemetria

## Objetivo

Separar el Worker HTTP de `services/telemetry-api/` en capas claras para que la validacion, los casos de uso y D1 dejen de vivir juntos en `src/index.js`.

## Resultado

- `services/telemetry-api/src/index.js` ahora es un composition root pequeno.
- el adapter HTTP principal vive en `services/telemetry-api/src/adapters/http/handleTelemetryApiRequest.js`.
- la serializacion HTTP vive en `services/telemetry-api/src/adapters/http/json.js`.
- las reglas de contrato viven en `services/telemetry-api/src/domain/` y la normalizacion de ingesta HTTP vive en `services/telemetry-api/src/adapters/http/`.
- los casos de uso viven en `services/telemetry-api/src/application/use-cases/`.
- el acceso a D1 vive en `services/telemetry-api/src/infrastructure/d1/`.

## Estructura principal

- `services/telemetry-api/src/domain/telemetrySchema.js`
- `services/telemetry-api/src/application/resolveQueryLimit.js`
- `services/telemetry-api/src/application/use-cases/getHealthStatus.js`
- `services/telemetry-api/src/application/use-cases/getLatestTelemetry.js`
- `services/telemetry-api/src/application/use-cases/getRecentTelemetry.js`
- `services/telemetry-api/src/application/use-cases/getTelemetryReport.js`
- `services/telemetry-api/src/application/use-cases/ingestTelemetry.js`
- `services/telemetry-api/src/infrastructure/d1/telemetryRowMapper.js`
- `services/telemetry-api/src/infrastructure/d1/telemetryRepository.js`
- `services/telemetry-api/src/adapters/http/handleTelemetryApiRequest.js`
- `services/telemetry-api/src/adapters/http/normalizeIncomingTelemetry.js`

## Compatibilidad mantenida

- no se cambiaron los endpoints publicos
- no se cambio el contrato JSON externo
- no se cambiaron las migraciones existentes
- `src/index.js` sigue reexportando helpers usados por las pruebas actuales

## Drift documentado

- `services/telemetry-api/migrations/0001_create_telemetry.sql` todavia contiene la columna legacy `humidity`
- el flujo actual ya no usa `humidity`, pero no se modifico la historia de migraciones en esta fase para evitar retrabajo sobre despliegues existentes

## Verificacion

- `npm test`
- `npm --workspace services/telemetry-api run build`

El build del workspace ahora valida sintaxis de todos los modulos del API en lugar de responder solo con un placeholder.
