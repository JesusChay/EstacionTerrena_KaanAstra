# Fase 3 - Terrena en linea

## Objetivo

Convertir `apps/web/` en la referencia de arquitectura para lectura remota sin tocar aun la arquitectura interna de la terrena fisica ni del API.

## Resultado

- `apps/web/src/bootstrap/main.js` ahora es un composition root pequeno.
- la logica HTTP fue movida a `apps/web/src/infrastructure/api/telemetryApiClient.js`.
- los casos de uso de lectura y exportacion viven en `apps/web/src/application/`.
- la configuracion de consultas vive en `apps/web/src/application/telemetryApiConfig.js`.
- la normalizacion del read model y el contrato browser viven en `apps/web/src/adapters/contracts/telemetryReadModel.js`.
- el fallback demo vive en `apps/web/src/adapters/ui/demoTelemetry.js`.
- la UI quedo separada en adapters para charts, mapa, modelo 3D, estado y descarga.

## Estructura principal

- `apps/web/src/application/telemetryApiConfig.js`
- `apps/web/src/adapters/contracts/telemetryReadModel.js`
- `apps/web/src/adapters/ui/demoTelemetry.js`
- `apps/web/src/application/loadRecentTelemetry.js`
- `apps/web/src/application/loadLatestTelemetry.js`
- `apps/web/src/adapters/export/createCsvReportArtifact.js`
- `apps/web/src/application/prepareReportDownload.js`
- `apps/web/src/infrastructure/api/telemetryApiClient.js`
- `apps/web/src/adapters/ui/createChartsPresenter.js`
- `apps/web/src/adapters/ui/createMapPresenter.js`
- `apps/web/src/adapters/ui/createModelPresenter.js`
- `apps/web/src/adapters/ui/createStatusPresenter.js`
- `apps/web/src/adapters/ui/initializeTabs.js`
- `apps/web/src/adapters/contracts/telemetryReadModel.js`

## Decision tecnica

- `apps/web/src/bootstrap/main.js` se carga como modulo ES desde `apps/web/src/index.html`.
- `apps/web/src/generated/telemetry-contract.js` sigue siendo un artefacto generado para exponer el contrato al browser sin bundler.
- `apps/web/package.json` ahora valida sintaxis de todos los modulos con `npm --workspace apps/web run build`.

## Alcance

En esta fase no se cambiaron los endpoints, el modo demo ni la experiencia visible del dashboard; solo se reubico la logica segun las capas definidas.
