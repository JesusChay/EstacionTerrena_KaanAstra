const test = require('node:test');
const assert = require('node:assert/strict');
const { toLandingPredictionDto } = require('../src/adapters/contracts/toLandingPredictionDto');
const { createLandingPredictionService } = require('../src/application/use-cases/createLandingPredictionService');
const { createStaticWindProfileProvider } = require('../src/infrastructure/weather/createStaticWindProfileProvider');

test('createStaticWindProfileProvider exposes a reusable layered wind profile', () => {
  const provider = createStaticWindProfileProvider({
    layers: [
      { altitudeMeters: 0, speedMps: 3.77, directionDeg: 270 },
      { altitudeMeters: 300, speedMps: 5.5, directionDeg: 260 }
    ]
  });

  const profile = provider.getProfile();
  assert.equal(profile.source, 'static');
  assert.equal(profile.layers.length, 2);
  assert.deepStrictEqual(profile.layers[0], {
    altitudeMeters: 0,
    speedMps: 3.77,
    directionDeg: 270
  });
});

test('landingPredictionService builds a predeploy prediction from ascending telemetry history', () => {
  const service = createLandingPredictionService({
    windProfileProvider: createStaticWindProfileProvider({
      layers: [
        { altitudeMeters: 0, speedMps: 3.77, directionDeg: 270 },
        { altitudeMeters: 250, speedMps: 4.4, directionDeg: 265 },
        { altitudeMeters: 500, speedMps: 5.2, directionDeg: 260 }
      ]
    })
  });

  service.update(makeProcessedTelemetry({
    observedAt: new Date('2026-06-08T12:00:00.000Z'),
    latitude: 20.0,
    longitude: -89.0,
    altitude: 120,
    relativeAltitude: 120,
    velocityZ: 20,
    decouplingStatus: false
  }));
  service.update(makeProcessedTelemetry({
    observedAt: new Date('2026-06-08T12:00:02.000Z'),
    latitude: 20.0001,
    longitude: -89.0001,
    altitude: 170,
    relativeAltitude: 170,
    velocityZ: 22,
    decouplingStatus: false
  }));
  const prediction = service.update(makeProcessedTelemetry({
    observedAt: new Date('2026-06-08T12:00:04.000Z'),
    latitude: 20.0002,
    longitude: -89.0002,
    altitude: 220,
    relativeAltitude: 220,
    velocityZ: 18,
    decouplingStatus: false
  }));

  assert.equal(prediction.phase, 'predeploy');
  assert.equal(prediction.status, 'tracking');
  assert.ok(prediction.etaSeconds > 0);
  assert.ok(prediction.timeToDeploySeconds > 0);
  assert.ok(prediction.estimatedTrajectory.length >= 3);
  assert.ok(Number.isFinite(prediction.predictedLanding.latitude));
  assert.ok(Number.isFinite(prediction.predictedLanding.longitude));
  assert.equal(prediction.inputs.massKg, 0.986);
  assert.equal(service.getLatestPrediction().phase, 'predeploy');
});

test('landingPredictionService builds a deployed prediction from descending telemetry history', () => {
  const service = createLandingPredictionService({
    windProfileProvider: createStaticWindProfileProvider({
      layers: [
        { altitudeMeters: 0, speedMps: 3.2, directionDeg: 250 },
        { altitudeMeters: 150, speedMps: 4.1, directionDeg: 255 },
        { altitudeMeters: 300, speedMps: 4.8, directionDeg: 260 }
      ]
    })
  });

  service.update(makeProcessedTelemetry({
    observedAt: new Date('2026-06-08T12:05:00.000Z'),
    latitude: 20.0,
    longitude: -89.0,
    altitude: 220,
    relativeAltitude: 220,
    velocityZ: -6,
    decouplingStatus: true
  }));
  service.update(makeProcessedTelemetry({
    observedAt: new Date('2026-06-08T12:05:03.000Z'),
    latitude: 20.0001,
    longitude: -89.00015,
    altitude: 180,
    relativeAltitude: 180,
    velocityZ: -7,
    decouplingStatus: true
  }));
  const prediction = service.update(makeProcessedTelemetry({
    observedAt: new Date('2026-06-08T12:05:06.000Z'),
    latitude: 20.00025,
    longitude: -89.0003,
    altitude: 140,
    relativeAltitude: 140,
    velocityZ: -7,
    decouplingStatus: true
  }));

  assert.equal(prediction.phase, 'deployed');
  assert.equal(prediction.status, 'tracking');
  assert.ok(prediction.etaSeconds > 0);
  assert.ok(prediction.currentDescentRateMps >= 3);
  assert.ok(prediction.estimatedTrajectory.length >= 2);
  assert.ok(prediction.uncertaintyRadiusMeters >= 20);
  assert.equal(prediction.inputs.massKg, 0.35);
});

test('toLandingPredictionDto normalizes the prediction payload for Electron IPC', () => {
  const dto = toLandingPredictionDto({
    altitudeAglMeters: 140.1234,
    blendedDriftVector: { northMps: 1.23456, eastMps: -2.34567, speedMps: 2.65011, directionDeg: 251.234 },
    confidence: 'medium',
    currentDescentRateMps: 7.1234,
    currentLocation: { latitude: 20.12345678, longitude: -89.98765432 },
    deployAltitudeMeters: 478,
    deployPoint: { latitude: 20.12456789, longitude: -89.97654321 },
    estimatedTrajectory: [
      { latitude: 20.12345678, longitude: -89.98765432, altitudeMeters: 140.1234, etaSeconds: 18.97 },
      { latitude: 20.12456789, longitude: -89.97654321, altitudeMeters: 0, etaSeconds: 0 }
    ],
    etaSeconds: 18.97,
    inputs: {
      altitudeAglMeters: 140.1234,
      decouplingStatus: true,
      massKg: 0.35,
      parachuteAreaSquareMeters: 0.26420756,
      verticalVelocityMps: -7.1234
    },
    modelVersion: 'landing-predictor-v1',
    observedAt: new Date('2026-06-08T12:05:06.000Z'),
    phase: 'deployed',
    predictedLanding: { latitude: 20.12456789, longitude: -89.97654321 },
    status: 'tracking',
    timeToDeploySeconds: null,
    uncertaintyRadiusMeters: 42.678,
    windProfileSource: 'static',
    windVector: { northMps: 0.5, eastMps: -1.25, speedMps: 1.3462912, directionDeg: 248.5 }
  });

  assert.deepStrictEqual(dto.currentLocation, {
    latitude: 20.123457,
    longitude: -89.987654
  });
  assert.equal(dto.observedAtUtc, '2026-06-08T12:05:06.000Z');
  assert.equal(dto.phase, 'deployed');
  assert.equal(dto.etaSeconds, 19);
  assert.equal(dto.uncertaintyRadiusMeters, 42.7);
  assert.equal(dto.estimatedTrajectory.length, 2);
  assert.equal(dto.inputs.parachuteAreaSquareMeters, 0.2642);
  assert.equal(dto.blendedDriftVector.eastMps, -2.346);
});

function makeProcessedTelemetry(overrides = {}) {
  return {
    observedAt: overrides.observedAt || new Date('2026-06-08T12:00:00.000Z'),
    altitude: overrides.altitude,
    decouplingStatus: overrides.decouplingStatus,
    latitude: overrides.latitude,
    longitude: overrides.longitude,
    relativeAltitude: overrides.relativeAltitude,
    sourceChannel: 'lora',
    velocityZ: overrides.velocityZ
  };
}
