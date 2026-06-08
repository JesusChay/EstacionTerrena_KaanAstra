# Plan: Limitar reportes a las últimas 2 horas

## Archivos a modificar (5)

### 1. API - Repositorio D1
**`services/telemetry-api/src/infrastructure/d1/telemetryRepository.js`**

```js
// ANTES
async readReportTelemetry(limit) {
  const result = await db
    .prepare(`SELECT ${selectFields} FROM telemetry ORDER BY id ASC LIMIT ?`)
    .bind(limit)
    .all();

// DESPUÉS
async readReportTelemetry(limit, since) {
  const query = since
    ? `SELECT ${selectFields} FROM telemetry WHERE received_at_utc >= ? ORDER BY id ASC LIMIT ?`
    : `SELECT ${selectFields} FROM telemetry ORDER BY id ASC LIMIT ?`;

  const stmt = db.prepare(query);
  const result = since
    ? await stmt.bind(since, limit).all()
    : await stmt.bind(limit).all();
```

### 2. API - Use case
**`services/telemetry-api/src/application/use-cases/getTelemetryReport.js`**

```js
// ANTES
export async function getTelemetryReport({ repository, limit }) {
  const telemetry = await repository.readReportTelemetry(limit);

// DESPUÉS
export async function getTelemetryReport({ repository, limit, since }) {
  const telemetry = await repository.readReportTelemetry(limit, since);
```

### 3. API - HTTP handler
**`services/telemetry-api/src/adapters/http/handleTelemetryApiRequest.js`**

```js
// ANTES (ruta /api/report)
const limit = resolveQueryLimit(..., TELEMETRY_LIMITS.report.default, TELEMETRY_LIMITS.report.max);
const report = await getTelemetryReport({ repository, limit });

// DESPUÉS
const limit = resolveQueryLimit(..., TELEMETRY_LIMITS.report.default, TELEMETRY_LIMITS.report.max);
const sinceParam = url.searchParams.get('since');
const since = sinceParam || new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
const report = await getTelemetryReport({ repository, limit, since });

return json({
  ok: true,
  telemetry: toTelemetryReadModelDtos(report.telemetry),
  count: report.count,
  persistence: telemetryPersistenceName,
  since       // ← nuevo campo en respuesta
});
```

### 4. Desktop - main.js (Electron)
**`src/main.js`** — función `processPayloadData` (línea 357):

```js
// ANTES
const payloadData = toTelemetrySampleDto(processedTelemetry);
payloadDataLog.push(payloadData);
telemetryPublisher.publish(payloadData);
broadcastPayloadData([dashboardWindow, mapWindow, model3dWindow], payloadData);

// DESPUÉS
const payloadData = toTelemetrySampleDto(processedTelemetry);
payloadDataLog.push({ ...payloadData, receivedAt: new Date().toISOString() });
telemetryPublisher.publish(payloadData);
broadcastPayloadData([dashboardWindow, mapWindow, model3dWindow], payloadData);
```

### 5. Desktop - buildDesktopReportArtifacts
**`src/application/use-cases/buildDesktopReportArtifacts.js`**

```js
// ANTES - inicio de la función
function buildDesktopReportArtifacts({ samples, isSimulation, generatedAt = new Date() }) {
    const headers = [...]

// DESPUÉS
function buildDesktopReportArtifacts({ samples, isSimulation, generatedAt = new Date() }) {
    const since = new Date(generatedAt.getTime() - 2 * 60 * 60 * 1000);
    const recentSamples = samples.filter(s => {
        const ts = s.receivedAt ? new Date(s.receivedAt) : null;
        return ts && ts >= since;
    });

    if (recentSamples.length === 0) {
        throw new Error('No hay datos de las últimas 2 horas para generar el reporte');
    }

    // Luego usar recentSamples en lugar de samples en todas partes
    const rows = recentSamples.map((sample) => ([...]));
    // analysis usa recentSamples en lugar de samples
```

## Resumen del flujo

1. **Web app**: usuario descarga reporte → GET /api/report → API filtra por `received_at_utc >= (now - 2h)` → D1 query con WHERE → CSV solo con datos recientes
2. **Desktop app**: usuario genera reporte → `processPayloadData` ya registra `receivedAt` ISO en cada muestra → `buildDesktopReportArtifacts` filtra por `receivedAt >= (now - 2h)` → XLSX + TXT solo con datos recientes
3. **API endpoint** acepta `?since=` opcional para override, default 2h atrás
