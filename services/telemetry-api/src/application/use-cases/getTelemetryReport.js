export async function getTelemetryReport({ repository, limit, since }) {
  const telemetry = await repository.readReportTelemetry(limit, since);

  return {
    telemetry,
    count: telemetry.length
  };
}
