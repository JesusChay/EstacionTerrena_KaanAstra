export async function getTelemetryReport({ repository, limit }) {
  const telemetry = await repository.readReportTelemetry(limit);

  return {
    telemetry,
    count: telemetry.length
  };
}
