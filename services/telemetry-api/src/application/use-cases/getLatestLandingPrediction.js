export async function getLatestLandingPrediction({ repository }) {
  const latestPrediction = await repository.readLatestLandingPrediction();
  if (!latestPrediction) {
    throw new Error('No landing prediction available yet.');
  }

  return latestPrediction;
}
