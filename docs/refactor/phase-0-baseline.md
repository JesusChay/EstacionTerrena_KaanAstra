# Fase 0 - Baseline actual

## Objetivo

Congelar el comportamiento observable antes de mover logica hacia las nuevas capas `domain`, `application`, `infrastructure` y `adapters`.

## Componentes activos

- `raiz del repo`: estacion terrena fisica en Electron.
- `apps/web/`: terrena en linea desplegada en Cloudflare Pages.
- `services/telemetry-api/`: API HTTP en Cloudflare Workers + D1.

## Flujo real de datos

1. La estacion fisica recibe lineas seriales en `main.js`.
2. `src/adapters/serial/telemetryParser.js` interpreta formatos `LORA:`, `XBEE:`, CSV directo y simulacion.
3. `main.js` normaliza, fusiona canales, calcula magnitudes derivadas y construye `payloadData`.
4. `payloadData` se emite por IPC a las ventanas Electron con el canal `payload-data`.
5. `main.js` publica la misma muestra al endpoint `POST /api/telemetry`.
6. `services/telemetry-api/src/index.js` valida el payload y lo persiste en D1.
7. `apps/web/src/main.jsx` monta la UI React y `apps/web/src/main.js` consulta `GET /api/latest`, `GET /api/recent` y `GET /api/report`.

## Payload canonico actual

El objeto emitido por `main.js` y aceptado por el API contiene hoy estos campos:

- `time`
- `speed`
- `temperature`
- `pressure`
- `accelx`, `accely`, `accelz`, `atotal`
- `gyrox`, `gyroy`, `gyroz`
- `gyroxRad`, `gyroyRad`, `gyrozRad`
- `magx`, `magy`, `magz`
- `altitude`, `relativeAltitude`
- `latitude`, `longitude`
- `receiverLatitude`, `receiverLongitude`
- `distanceToReceiver`
- `velocity`, `velocityZ`
- `decouplingStatus`
- `sourceChannel`

## Canales IPC vigentes

- `payload-data`: muestra consolidada para dashboard, mapa y modelo 3D.
- `error`: errores operativos de serial/reportes.
- `report-generated`: confirmacion de exportacion local.
- `simulation-status`: eventos de puerto y simulacion.

## Endpoints vigentes

- `GET /api/health`
- `GET /api/schema`
- `GET /api/latest`
- `GET /api/recent?limit=24`
- `GET /api/report?limit=5000`
- `POST /api/telemetry`

## Pruebas de caracterizacion incorporadas en esta fase

- parser serial de `src/adapters/serial/telemetryParser.js`
- contrato entre `main.js` y `services/telemetry-api/src/index.js`
- normalizacion del payload y mapeo de filas D1
- rutas HTTP base del Worker con dobles de prueba

## Drift detectado y explicitado

- `apps/web/` es la fuente canonica de la terrena en linea.
- `docs/web-platform-plan.md` conserva decisiones iniciales y tenia referencias desactualizadas.
- el contrato real ya no usa `humidity`.
- la API ya no usa almacenamiento temporal; hoy persiste en D1.
- `index.html` en la raiz no representa el flujo principal actual.
