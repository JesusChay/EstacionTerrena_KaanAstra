# KA'AN ASTRA

Repositorio principal de la estacion terrena y de la futura plataforma web de visualizacion.

## Estructura actual

- `main.js`, `preload.js`, `dashboard.html`, `map.html`, `model3d.html`: app de escritorio Electron actual.
- `apps/web/`: interfaz web externa pensada para Cloudflare Pages.
- `services/telemetry-api/`: API de ingesta para recibir telemetria desde la estacion terrena en Cloudflare Workers.
- `docs/web-platform-plan.md`: decisiones iniciales de arquitectura y contrato de datos.

## Objetivo de esta fase

1. Organizar el repo sin romper la app local.
2. Diseñar una primera interfaz web para mostrar telemetria.
3. Preparar una API inicial para enviar datos desde la estacion terrena.
4. Dejar la base lista para conectar persistencia mas adelante.

## Estado

- La app Electron sigue funcionando desde la raiz con `npm start`.
- La web ya tiene un dashboard inicial desacoplado en `apps/web/`.
- La API ya expone endpoints iniciales en `services/telemetry-api/`.
- La persistencia actual del API es temporal en memoria; mas adelante se reemplaza por BD.
