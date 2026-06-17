let magXTarget = 25;
let magYTarget = 0;
let magZTarget = 40;
let currentMagX = 25;
let currentMagY = 0;
let currentMagZ = 40;

let windSpeedTarget = 3;
let windGustTarget = 5;
let windDirTarget = 180;
let windTempTarget = 25;
let currentWindSpeed = 3;
let currentWindGust = 5;
let currentWindDir = 180;
let currentWindTemp = 25;

let tick = 0;

function lerp(current, target, factor) {
  return current + (target - current) * factor;
}

function randomInRange(min, max) {
  return min + Math.random() * (max - min);
}

function pickNewTarget() {
  magXTarget = randomInRange(20, 30);
  magYTarget = randomInRange(-8, 8);
  magZTarget = randomInRange(32, 50);

  windSpeedTarget = randomInRange(0, 10);
  windGustTarget = windSpeedTarget + randomInRange(2, 6);
  windDirTarget = randomInRange(0, 360);
  windTempTarget = randomInRange(20, 30);
}

export function generateMagnetometerSample() {
  if (tick % 8 === 0) pickNewTarget();

  currentMagX = lerp(currentMagX, magXTarget, 0.15) + randomInRange(-0.3, 0.3);
  currentMagY = lerp(currentMagY, magYTarget, 0.15) + randomInRange(-0.3, 0.3);
  currentMagZ = lerp(currentMagZ, magZTarget, 0.15) + randomInRange(-0.3, 0.3);

  return { magX: currentMagX, magY: currentMagY, magZ: currentMagZ };
}

export function generateWindSample() {
  if (tick % 8 === 0) pickNewTarget();

  currentWindSpeed = lerp(currentWindSpeed, windSpeedTarget, 0.1) + randomInRange(-0.2, 0.2);
  currentWindGust = lerp(currentWindGust, windGustTarget, 0.08) + randomInRange(-0.3, 0.3);
  currentWindDir = lerp(currentWindDir, windDirTarget, 0.05) + randomInRange(-3, 3);
  currentWindTemp = lerp(currentWindTemp, windTempTarget, 0.02) + randomInRange(-0.1, 0.1);

  tick++;

  return {
    speed: Math.max(0, currentWindSpeed),
    direction: ((currentWindDir % 360) + 360) % 360,
    gust: Math.max(0, currentWindGust),
    temperature: currentWindTemp
  };
}
