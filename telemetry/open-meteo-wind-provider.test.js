const test = require('node:test');
const assert = require('node:assert/strict');
const { createOpenMeteoClient } = require('../src/infrastructure/weather/createOpenMeteoClient');
const { createOpenMeteoWindProfileProvider } = require('../src/infrastructure/weather/createOpenMeteoWindProfileProvider');

test('createOpenMeteoClient builds a pressure-layer request and maps layers to AGL', async () => {
  let requestedUrl = null;
  const client = createOpenMeteoClient({
    apiBaseUrl: 'https://example.test/forecast',
    fetchImpl: async (url) => {
      requestedUrl = url;
      return {
        ok: true,
        json: async () => ({
          elevation: 42,
          generationtime_ms: 1.7,
          hourly: {
            wind_speed_1000hPa: [3.5],
            wind_direction_1000hPa: [270],
            geopotential_height_1000hPa: [110],
            wind_speed_975hPa: [4.1],
            wind_direction_975hPa: [260],
            geopotential_height_975hPa: [320]
          },
          latitude: 20.1234,
          longitude: -89.5678
        })
      };
    },
    models: 'best_match',
    pressureLevelsHpa: [1000, 975]
  });

  const profile = await client.readWindProfile({ latitude: 20.1, longitude: -89.6 });
  const query = new URL(requestedUrl).searchParams;

  assert.equal(query.get('forecast_hours'), '1');
  assert.equal(query.get('wind_speed_unit'), 'ms');
  assert.equal(query.get('models'), 'best_match');
  assert.match(query.get('hourly'), /wind_speed_1000hPa/);
  assert.match(query.get('hourly'), /geopotential_height_975hPa/);
  assert.equal(profile.source, 'open-meteo');
  assert.equal(profile.layers.length, 2);
  assert.deepStrictEqual(profile.layers[0], {
    altitudeMeters: 68,
    directionDeg: 270,
    geopotentialHeightMeters: 110,
    pressureLevelHpa: 1000,
    speedMps: 3.5
  });
  assert.deepStrictEqual(profile.layers[1], {
    altitudeMeters: 278,
    directionDeg: 260,
    geopotentialHeightMeters: 320,
    pressureLevelHpa: 975,
    speedMps: 4.1
  });
});

test('createOpenMeteoWindProfileProvider falls back immediately and then serves cached Open-Meteo data', async () => {
  const calls = [];
  const fallbackProvider = {
    getProfile() {
      return {
        source: 'static',
        layers: [{ altitudeMeters: 0, directionDeg: 0, speedMps: 0 }]
      };
    }
  };
  const provider = createOpenMeteoWindProfileProvider({
    client: {
      async readWindProfile(coords) {
        calls.push(coords);
        return {
          fetchedAtUtc: '2026-06-08T12:00:00.000Z',
          layers: [{ altitudeMeters: 100, directionDeg: 255, speedMps: 4.8 }],
          source: 'open-meteo'
        };
      }
    },
    fallbackProvider,
    refreshIntervalMs: 60000
  });

  const telemetry = {
    latitude: 20.1234,
    longitude: -89.5678
  };

  const firstProfile = provider.getProfile({ telemetry });
  assert.equal(firstProfile.source, 'static');
  assert.equal(calls.length, 1);

  await new Promise((resolve) => setImmediate(resolve));

  const secondProfile = provider.getProfile({ telemetry });
  assert.equal(secondProfile.source, 'open-meteo');
  assert.deepStrictEqual(secondProfile.layers, [{ altitudeMeters: 100, directionDeg: 255, speedMps: 4.8 }]);
});

test('createOpenMeteoWindProfileProvider returns fallback when Open-Meteo refresh fails', async () => {
  const provider = createOpenMeteoWindProfileProvider({
    client: {
      async readWindProfile() {
        throw new Error('network down');
      }
    },
    fallbackProvider: {
      getProfile() {
        return {
          source: 'static',
          layers: [{ altitudeMeters: 0, directionDeg: 0, speedMps: 0 }]
        };
      }
    }
  });

  const profile = await provider.refreshNow({
    telemetry: {
      receiverLatitude: 20.1234,
      receiverLongitude: -89.5678
    }
  });

  assert.equal(profile.source, 'static-fallback');
  assert.equal(profile.layers.length, 1);
});
