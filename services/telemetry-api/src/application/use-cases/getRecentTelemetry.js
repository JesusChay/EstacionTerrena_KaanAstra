export async function getRecentTelemetry({ repository, limit }) {
  return repository.readRecentTelemetry(limit);
}
