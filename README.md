# KA'AN ASTRA

Repositorio principal de la estacion terrena fisica, la terrena en linea y el API que comunica ambas.

## Estructura actual

- `main.js`: composition root actual de la estacion terrena fisica.
- `src/adapters/electron/`: preload y renderers Electron actuales.
- `apps/web/`: interfaz web externa pensada para Cloudflare Pages.
- `services/telemetry-api/`: API de ingesta para recibir telemetria desde la estacion terrena en Cloudflare Workers.
- `docs/web-platform-plan.md`: decisiones iniciales de arquitectura y contrato de datos.
- `docs/refactor/phase-0-baseline.md`: baseline actual del sistema, contrato real y pruebas de caracterizacion.
- `docs/refactor/phase-2-contracts.md`: contrato compartido extraido para desktop, web y API.
- `docs/refactor/phase-3-online-station.md`: separacion de la terrena en linea en capas de application, infrastructure y adapters.
- `docs/refactor/phase-4-api.md`: separacion del API en use cases, repositorio D1 y adapters HTTP.
- `docs/refactor/phase-5-physical-station.md`: extraccion del procesamiento y reportes de la terrena fisica desde `main.js`.
- `docs/refactor/phase-6-cleanup.md`: limpieza final, reglas de dependencia y reorganizacion de firmware.

## Objetivo de esta fase

1. Organizar el repo sin romper la app local.
2. Diseñar una primera interfaz web para mostrar telemetria.
3. Preparar una API inicial para enviar datos desde la estacion terrena.
4. Dejar la base lista para separar las tres arquitecturas de cebolla sin perder comportamiento.

## Estado

- La app Electron sigue funcionando desde la raiz con `npm start`.
- La web ya tiene un dashboard inicial desacoplado en `apps/web/`.
- La API ya expone endpoints activos en `services/telemetry-api/`.
- La persistencia actual del API usa Cloudflare D1.

## Estructura de trabajo para la refactorizacion

- `src/`: estacion terrena fisica ya con dominio, use cases, infraestructura y adapters activos.
- `src/adapters/electron/renderer/`: ventanas `dashboard`, `map` y `model3d` movidas fuera de la raiz.
- `apps/web/src/`: terrena en linea ya separada en `domain`, `application`, `infrastructure` y `adapters`.
- `services/telemetry-api/src/`: API ya separado en `domain`, `application`, `infrastructure` y `adapters`.
- `packages/telemetry-contracts/`: contrato compartido activo para campos, rutas y limites de telemetria.
- `firmware/`: codigo embebido separado en `firmware/cansat/` y `firmware/ground-station/`.
- `src/adapters/serial/telemetryParser.js`: parser serial canonico de la estacion fisica.

## Verificaciones utiles

- `npm test`: suite de caracterizacion y contratos.
- `npm run verify:desktop`: valida sintaxis del entrypoint Electron y del componente fisico en `src/`.
- `npm run verify:boundaries`: valida dependencias por capa y detecta imports relativos faltantes.
- `npm run verify:repo`: corre pruebas, boundary checks y builds de web/API.

## Residual

- la deuda restante ya no es de archivos legacy activos, sino de evolucion futura de renderers y docs historicas.
