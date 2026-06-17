export function normalizeDirection(deg) {
  return ((deg % 360) + 360) % 360;
}

export function directionToCardinal(deg) {
  const directions = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE",
                       "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"];
  return directions[Math.round(deg / 22.5) % 16];
}
