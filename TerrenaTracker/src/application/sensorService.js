import { calcHeading, calcTotalField, headingToCardinal } from "../domain/magnetometerMath.js";
import { normalizeDirection, directionToCardinal } from "../domain/windSensorMath.js";
import { generateMagnetometerSample, generateWindSample } from "../infrastructure/demoData.js";

export function getSensorDisplayData() {
  const magRaw = generateMagnetometerSample();
  const windRaw = generateWindSample();

  const heading = calcHeading(magRaw.magX, magRaw.magY);
  const totalField = calcTotalField(magRaw.magX, magRaw.magY, magRaw.magZ);
  const cardinal = headingToCardinal(heading);

  const windDir = normalizeDirection(windRaw.direction);
  const windCardinal = directionToCardinal(windDir);

  return {
    mag: {
      x: magRaw.magX,
      y: magRaw.magY,
      z: magRaw.magZ,
      heading,
      headingCardinal: cardinal,
      total: totalField
    },
    wind: {
      speed: windRaw.speed,
      direction: windDir,
      directionCardinal: windCardinal,
      gust: windRaw.gust,
      temperature: windRaw.temperature
    }
  };
}
