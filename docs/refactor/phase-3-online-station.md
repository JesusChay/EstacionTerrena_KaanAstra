# Fase 3 - Terrena en linea

## Objetivo

Convertir `apps/web/` en la referencia de arquitectura para lectura remota sin tocar aun la arquitectura interna de la terrena fisica ni del API.

## Resultado

- `apps/web/src/main.js` funciona hoy como composition root de telemetria.
- `apps/web/index.html` y `apps/web/src/main.jsx` montan la UI React con Vite.
- la logica HTTP vive en `apps/web/src/infrastructure/api/telemetryApiClient.js`.
- los casos de uso de lectura y exportacion viven en `apps/web/src/application/`.
- la configuracion HTTP y de consultas vive en `apps/web/src/infrastructure/api/telemetryApiConfig.js`.
- la normalizacion del read model y el contrato browser viven en `apps/web/src/adapters/contracts/telemetryReadModel.js`.
- el fallback demo vive en `apps/web/src/adapters/ui/demoTelemetry.js`.
- la UI visible se reparte entre `apps/web/src/App.jsx`, `apps/web/src/useTelemetryApp.js` y `apps/web/src/components/`.
- charts, mapa, modelo 3D y estado siguen encapsulados en adapters/presenters reutilizables.

## Estructura principal

- `apps/web/src/infrastructure/api/telemetryApiConfig.js`
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
- `apps/web/src/adapters/ui/telemetryViewState.js`
- `apps/web/src/App.jsx`
- `apps/web/src/useTelemetryApp.js`
- `apps/web/src/components/TelemetryCharts.jsx`
- `apps/web/src/components/TelemetryMapPanel.jsx`
- `apps/web/src/components/TelemetryModelPanel.jsx`
- `apps/web/src/adapters/contracts/telemetryReadModel.js`

## Decision tecnica

- `apps/web/index.html` carga `infrastructure/telemetry-api-runtime-config.js` y el entrypoint `apps/web/src/main.jsx`.
- `apps/web/src/main.jsx` monta React y delega el flujo de telemetria a `apps/web/src/main.js`.
- `apps/web/src/generated/telemetry-contract.js` sigue siendo un artefacto generado, pero ahora se importa como modulo ESM dentro del build.
- `apps/web/package.json` usa `vite build` como verificacion canonica de la web.

## Alcance

En esta fase no se cambiaron los endpoints, el modo demo ni la experiencia visible del dashboard; solo se reubico la logica segun las capas definidas.
