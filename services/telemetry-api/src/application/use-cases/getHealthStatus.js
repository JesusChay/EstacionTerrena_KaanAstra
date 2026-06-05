export async function getHealthStatus({ repository }) {
  const databaseAvailable = Boolean(repository);
  const latestTelemetry = databaseAvailable ? await repository.readLatestTelemetry() : null;

  return {
    databaseAvailable,
    latestAvailable: Boolean(latestTelemetry)
  };
}
