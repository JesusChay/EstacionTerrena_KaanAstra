# Fase 6 - Limpieza final

## Objetivo

Cerrar la separacion arquitectonica de las tres cebollas con reglas de dependencia verificables, reorganizacion del firmware y documentacion final del repo.

## Resultado

- el firmware ya no comparte carpeta con el parser serial JS
- se agrego verificacion automatica de limites de dependencia entre capas
- el build de web ahora pasa por Vite y el API sigue validando sintaxis e imports relativos faltantes
- los renderers Electron activos ya viven dentro de `src/adapters/electron/`
- se documentaron las rutas canonicas y los residuos legacy que quedan por compatibilidad

## Cambios principales

- `firmware/cansat/Cansat.c`
- `firmware/ground-station/Terrena.c`
- `src/adapters/serial/telemetryParser.js`
- `src/adapters/electron/preload.js`
- `src/adapters/electron/renderer/dashboard.html`
- `src/adapters/electron/renderer/map.html`
- `src/adapters/electron/renderer/model3d.html`
- `src/adapters/electron/renderer/dashboard.mjs`
- `src/adapters/electron/renderer/map.mjs`
- `src/adapters/electron/renderer/model3d.mjs`
- `scripts/check-boundaries.mjs`
- `scripts/check-physical-station-syntax.mjs`
- `package.json` con `verify:boundaries` y `verify:repo`
- `services/telemetry-api/scripts/check-syntax.mjs` con validacion de imports relativos
- `apps/web/package.json` y `apps/web/vite.config.js` como build canonico de la web React/Vite

## Reglas automatizadas

- `domain` solo puede depender de `domain`
- `application` solo puede depender de `domain` y `application`
- `infrastructure` puede depender de `domain`, `application` e `infrastructure`
- `adapters` puede depender de `domain`, `application`, `infrastructure` y `adapters`
- `domain` y `application` no pueden importar paquetes tecnicos como `electron`, `serialport`, `xlsx`, `chart.js`, `three`, `fs` o `path`
- `domain` y `application` no pueden acceder directamente a `window` ni `document`

## Verificacion disponible

- `npm test`
- `npm run verify:desktop`
- `npm run verify:boundaries`
- `npm run verify:repo`

## Legacy residual controlado

- `index.html` legacy de la raiz fue retirado
- `telemetry/parser.js` legacy fue retirado y el parser canonico queda en `src/adapters/serial/telemetryParser.js`
- la validacion manual de la GUI Electron y del flujo serial real sigue siendo necesaria porque no hay smoke test automatizado para ventanas nativas
