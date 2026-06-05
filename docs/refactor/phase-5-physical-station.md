# Fase 5 - Terrena fisica

## Objetivo

Vaciar `main.js` de logica de negocio y mover el procesamiento principal de telemetria, publicacion HTTP y generacion de reportes a las capas del componente fisico.

## Resultado

- `main.js` ahora actua principalmente como composition root y wiring de Electron, serial e IPC.
- el pipeline de procesamiento vive en `src/application/use-cases/createTelemetryProcessor.js`.
- la simulacion de telemetria fue extraida a `src/application/use-cases/createSimulationTelemetrySource.js`.
- las reglas puras extraidas viven en `src/domain/telemetry/`.
- la publicacion al API vive en `src/infrastructure/http/createTelemetryApiPublisher.js`.
- el contenido funcional de los reportes vive en `src/application/use-cases/buildDesktopReportArtifacts.js` y la escritura en disco/XLSX vive en `src/infrastructure/reporting/createDesktopReportWriter.js`.
- la resolucion de lineas seriales quedo encapsulada en `src/adapters/serial/resolveSerialTelemetryInput.js`.
- el envio a ventanas Electron quedo centralizado en `src/adapters/electron/windowMessaging.js`.

## Estructura principal

- `src/domain/telemetry/quaternion.js`
- `src/domain/telemetry/kalmanFilter.js`
- `src/domain/telemetry/telemetryMath.js`
- `src/domain/telemetry/telemetryMerge.js`
- `src/application/use-cases/createTelemetryProcessor.js`
- `src/application/use-cases/createSimulationTelemetrySource.js`
- `src/application/use-cases/buildDesktopReportArtifacts.js`
- `src/application/use-cases/generateDesktopReport.js`
- `src/infrastructure/http/createTelemetryApiPublisher.js`
- `src/infrastructure/reporting/createDesktopReportWriter.js`
- `src/adapters/serial/resolveSerialTelemetryInput.js`
- `src/adapters/electron/windowMessaging.js`

## Compatibilidad mantenida

- los canales IPC siguen siendo `payload-data`, `error`, `report-generated` y `simulation-status`
- la publicacion a la API sigue saliendo hacia el mismo endpoint configurado por `TELEMETRY_API_URL`
- el formato del `payloadData` sigue saliendo del contrato compartido
- los reportes Excel y TXT siguen generandose en `Documents/KAAN_ASTRA_Reportes`

## Verificacion

- `npm test`
- `node --check main.js`
- `npm run build:web`
- `npm --workspace services/telemetry-api run build`

## Alcance restante

- `main.js` todavia conserva wiring de ventanas e inicializacion serial
- mover completamente la app fisica fuera de la raiz queda para la fase final de limpieza y relocalizacion
