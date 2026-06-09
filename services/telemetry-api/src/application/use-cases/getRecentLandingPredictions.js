export async function getRecentLandingPredictions({ repository, limit }) {
  return repository.readRecentLandingPredictions(limit);
}
