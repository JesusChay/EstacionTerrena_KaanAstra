export function resolveQueryLimit(rawValue, fallbackLimit, maxLimit) {
  const requestedLimit = Number.parseInt(rawValue ?? String(fallbackLimit), 10);
  return Number.isFinite(requestedLimit)
    ? Math.min(Math.max(requestedLimit, 1), maxLimit)
    : fallbackLimit;
}
