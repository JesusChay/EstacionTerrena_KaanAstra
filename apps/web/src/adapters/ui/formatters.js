export function formatMetric(value, type) {
  if (value === undefined || value === null || value === '') {
    return '--';
  }

  switch (type) {
    case 'degC':
      return `${value} C`;
    case 'm':
      return `${value} m`;
    case 'ms':
      return `${value} m/s`;
    case 'hpa':
      return `${value} hPa`;
    case 'coord':
      return `${value}`;
    case 'g':
      return `${value} g`;
    default:
      return `${value}`;
  }
}

export function formatSourceChannel(value) {
  if (!value) return '--';
  const normalized = String(value).toLowerCase();
  if (normalized === 'lora') return 'LoRa';
  if (normalized === 'xbee') return 'XBee';
  return value;
}

export function asNumber(value) {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : null;
}
