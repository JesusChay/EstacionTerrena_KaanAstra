export async function loadLatestLandingPrediction({ apiClient, normalizeLandingPredictionRecord }) {
  const payload = await apiClient.getLatestPrediction();
  const prediction = normalizeLandingPredictionRecord(payload.prediction);
  if (!prediction) {
    throw new Error('Respuesta sin prediccion');
  }

  return prediction;
}
