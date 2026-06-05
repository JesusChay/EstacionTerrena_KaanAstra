export async function ingestTelemetry({ repository, payload }) {
  return repository.insertTelemetry(payload);
}
