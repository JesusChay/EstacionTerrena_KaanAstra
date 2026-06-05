export async function prepareReportDownload({
  apiClient,
  reportLimit,
  normalizeTelemetryRecords,
  createReportArtifact
}) {
  const payload = await apiClient.getReport(reportLimit);
  const rows = normalizeTelemetryRecords(payload.telemetry);
  if (rows.length === 0) {
    throw new Error('No hay datos disponibles para exportar.');
  }

  return createReportArtifact({ rows, generatedAt: new Date() });
}
