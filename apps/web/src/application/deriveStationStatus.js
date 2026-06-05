export function deriveStationStatus(telemetry, now = Date.now()) {
  const receivedAt = telemetry?.receivedAtUtc ? Date.parse(telemetry.receivedAtUtc) : Number.NaN;
  if (!Number.isFinite(receivedAt)) {
    return { label: 'Datos de estacion recibidos', className: 'status-ok' };
  }

  const ageMs = now - receivedAt;
  if (ageMs <= 5000) {
    return { label: 'Recibiendo datos de estacion', className: 'status-ok' };
  }

  if (ageMs <= 15000) {
    return { label: 'Datos recientes de estacion', className: 'status-waiting' };
  }

  return { label: 'Sin datos recientes de estacion', className: 'status-error' };
}
