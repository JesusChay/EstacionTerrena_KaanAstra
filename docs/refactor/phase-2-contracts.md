# Fase 2 - Contrato compartido

## Objetivo

Extraer un contrato canonico minimo para que la estacion fisica, la terrena en linea y el API dejen de repetir listas de campos y limites basicos.

## Workspace activo

- `packages/telemetry-contracts/`

## Contrato centralizado

- `TELEMETRY_SAMPLE_FIELDS`: orden canonico del payload emitido por la terrena fisica y aceptado por el API.
- `TELEMETRY_READ_MODEL_FIELDS`: orden canonico del modelo de lectura expuesto por el API y consumido por la terrena en linea.
- `TELEMETRY_API_PATHS` y `TELEMETRY_API_ROUTES`: paths compartidos para endpoints.
- `TELEMETRY_LIMITS`: limites por defecto y maximos para `recent` y `report`.

## Adopcion en cada componente

- `main.js`: ahora construye `payloadData` con `createTelemetrySampleDto(...)`.
- `services/telemetry-api/src/index.js`: ahora toma campos, limites y rutas desde `@kaan-astra/telemetry-contracts`.
- `apps/web/`: ahora consume `apps/web/src/generated/telemetry-contract.js`, archivo generado desde el mismo workspace compartido.

## Sincronizacion web

- comando: `npm run sync:contracts`
- origen: `packages/telemetry-contracts/src/index.cjs`
- salida generada: `apps/web/src/generated/telemetry-contract.js`

## Lo que aun no se comparte

- reglas de negocio de procesamiento de telemetria
- clientes HTTP concretos
- parsing serial
- mapeos SQL
- logica de UI y renderizado

Ese trabajo se mueve en las siguientes fases para evitar acoplar implementaciones enteras bajo un supuesto paquete comun.
