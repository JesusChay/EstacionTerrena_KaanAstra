export async function getLatestTelemetry({ repository }) {
  const latestTelemetry = await repository.readLatestTelemetry();
  if (!latestTelemetry) {
    throw new Error('No telemetry available yet.');
  }

  return latestTelemetry;
}
