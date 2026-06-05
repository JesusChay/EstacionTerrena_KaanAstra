export async function loadLatestTelemetry({ apiClient, normalizeTelemetryRecord }) {
  const payload = await apiClient.getLatest();
  const telemetry = normalizeTelemetryRecord(payload.telemetry);
  if (!telemetry) {
    throw new Error('Respuesta sin telemetria');
  }

  return telemetry;
}
