# Fase 1 - Estructura inicial de capas

## Objetivo

Preparar el repo para tres arquitecturas de cebolla separadas sin mover todavia la logica de negocio existente.

## Componentes

- estacion terrena fisica: sigue operando desde la raiz del repo
- terrena en linea: `apps/web/`
- API: `services/telemetry-api/`

## Carpetas reservadas en esta fase

- `src/domain`, `src/application`, `src/infrastructure`, `src/adapters`
- `apps/web/src/domain`, `apps/web/src/application`, `apps/web/src/infrastructure`, `apps/web/src/adapters`
- `services/telemetry-api/src/domain`, `services/telemetry-api/src/application`, `services/telemetry-api/src/infrastructure`, `services/telemetry-api/src/adapters`

## Regla de dependencias

- `domain` no depende de ninguna otra capa
- `application` puede depender de `domain`
- `infrastructure` implementa detalles tecnicos requeridos por `application`
- `adapters` traduce entrada/salida externa y delega a `application`

## Decision operativa

- `main.js`, `apps/web/src/bootstrap/main.js` y `services/telemetry-api/src/index.js` siguen siendo entrypoints activos durante esta fase
- el movimiento de logica hacia las carpetas nuevas empieza en las siguientes fases
