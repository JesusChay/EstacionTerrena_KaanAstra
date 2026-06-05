export function resolveTelemetryModelState(telemetry) {
  const gyroxRad = toRadiansValue(telemetry?.gyroxRad, telemetry?.gyrox);
  const gyroyRad = toRadiansValue(telemetry?.gyroyRad, telemetry?.gyroy);
  const gyrozRad = toRadiansValue(telemetry?.gyrozRad, telemetry?.gyroz);

  return {
    gyroxRad,
    gyroyRad,
    gyrozRad
  };
}

function toRadiansValue(radValue, degreeValue) {
  if (radValue !== undefined && radValue !== null && radValue !== '') {
    const parsedRad = Number.parseFloat(radValue);
    return Number.isFinite(parsedRad) ? parsedRad : 0;
  }

  const parsedDegree = Number.parseFloat(degreeValue);
  return Number.isFinite(parsedDegree) ? parsedDegree * 0.0174533 : 0;
}
