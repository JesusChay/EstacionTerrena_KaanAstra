export async function loadRecentTelemetry({
  apiClient,
  historyLimit,
  normalizeTelemetryRecords,
  fallbackTelemetry = () => []
}) {
  try {
    const payload = await apiClient.getRecent(historyLimit);
    return {
      samples: normalizeTelemetryRecords(payload.telemetry),
      source: 'api'
    };
  } catch {
    return {
      samples: normalizeTelemetryRecords(fallbackTelemetry()),
      source: 'demo'
    };
  }
}
