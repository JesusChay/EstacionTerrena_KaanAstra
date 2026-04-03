# Plataforma web externa

## Organizacion propuesta del repo

- `apps/web/`
  - frontend estatico listo para Cloudflare Pages
- `services/telemetry-api/`
  - Worker HTTP para ingesta y consulta basica
- raiz del repo
  - app Electron existente de la estacion terrena

## Flujo de datos de esta fase

1. La estacion terrena recibe y normaliza `payloadData` en `main.js`.
2. Ese objeto se enviara por `POST /api/telemetry`.
3. El Worker valida el paquete y mantiene una copia temporal del ultimo dato y una ventana corta de historico.
4. La web consulta `GET /api/latest` y `GET /api/recent`.

## Limitacion temporal

El API usa memoria del Worker solo para preparar el flujo extremo a extremo. Eso sirve para pruebas iniciales y para definir el contrato, pero no garantiza persistencia ni consistencia entre instancias. En la siguiente fase debe cambiarse por BD.

## Contrato inicial de telemetria

El payload esperado replica el objeto canónico que hoy arma la estacion terrena en `main.js`:

```json
{
  "time": "14:22:03",
  "speed": "5.10",
  "temperature": "24.35",
  "humidity": "61.20",
  "pressure": "1009.80",
  "accelx": "0.14",
  "accely": "-0.03",
  "accelz": "1.02",
  "atotal": "1.03",
  "gyrox": "0.20",
  "gyroy": "0.18",
  "gyroz": "0.05",
  "magx": "141.10",
  "magy": "-8.40",
  "magz": "29.90",
  "altitude": "128.40",
  "relativeAltitude": "11.35",
  "latitude": "20.967370",
  "longitude": "-89.623710",
  "velocity": "6.20",
  "velocityZ": "-1.12",
  "decouplingStatus": false
}
```

## Endpoints iniciales

- `GET /api/health`
  - estado de la API
- `GET /api/schema`
  - contrato y campos soportados
- `POST /api/telemetry`
  - ingesta de una muestra de telemetria
- `GET /api/latest`
  - ultimo paquete aceptado
- `GET /api/recent?limit=60`
  - ventana corta de muestras recientes

## Siguiente integracion en Electron

El punto ideal para el envio esta justo despues de construir `payloadData` en `main.js`, antes o despues de emitirlo por IPC a las ventanas locales.
