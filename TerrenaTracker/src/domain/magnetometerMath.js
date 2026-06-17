export function calcHeading(magX, magY) {
  let heading = Math.atan2(magY, magX) * (180 / Math.PI);
  return ((heading % 360) + 360) % 360;
}

export function calcTotalField(magX, magY, magZ) {
  return Math.sqrt(magX * magX + magY * magY + magZ * magZ);
}

export function headingToCardinal(deg) {
  const directions = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
  return directions[Math.round(deg / 45) % 8];
}
