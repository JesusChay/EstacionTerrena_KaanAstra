export async function ingestLandingPrediction({ repository, payload }) {
  return repository.insertLandingPrediction(payload);
}
