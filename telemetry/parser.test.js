const test = require('node:test');
const assert = require('node:assert/strict');
const fixtures = require('../tests/fixtures/serial-lines.json');
const { resolveSerialTelemetryInput } = require('../src/adapters/serial/resolveSerialTelemetryInput');
const { parseTelemetryMessage, isTelemetryLine } = require('../src/adapters/serial/telemetryParser');

test('parseTelemetryMessage parses prefixed terrena lines and keeps the source channel', () => {
  assert.deepStrictEqual(parseTelemetryMessage(fixtures.lora), {
    temperature: 24.5,
    pressure: 1007.2,
    altitude: 128.4,
    accelx: 0.11,
    accely: -0.02,
    accelz: 1.01,
    gyrox: 3.4,
    gyroy: 5.6,
    gyroz: 7.8,
    magx: 141.1,
    magy: -8.4,
    magz: 29.9,
    latitude: 20.96737,
    longitude: -89.62371,
    sourceChannel: 'lora'
  });
});

test('parseTelemetryMessage parses raw terrena lines without injecting sourceChannel', () => {
  const parsed = parseTelemetryMessage(fixtures.raw);

  assert.equal(parsed.temperature, 24.5);
  assert.equal(parsed.pressure, 1007.2);
  assert.equal(parsed.longitude, -89.62371);
  assert.equal(Object.hasOwn(parsed, 'sourceChannel'), false);
});

test('parseTelemetryMessage parses simulation payloads and normalizes decouplingStatus to boolean', () => {
  assert.deepStrictEqual(parseTelemetryMessage(fixtures.simulation), {
    speed: 5.1,
    temperature: 24.35,
    pressure: 1009.8,
    accelx: 0.14,
    accely: -0.03,
    accelz: 1.02,
    gyrox: 0.2,
    gyroy: 0.18,
    gyroz: 0.05,
    magx: 141.1,
    magy: -8.4,
    magz: 29.9,
    altitude: 128.4,
    latitude: 20.96737,
    longitude: -89.62371,
    decouplingStatus: true
  });
});

test('parseTelemetryMessage rejects non-telemetry lines', () => {
  assert.equal(parseTelemetryMessage(fixtures.invalid), null);
  assert.equal(parseTelemetryMessage(''), null);
  assert.equal(parseTelemetryMessage(null), null);
});

test('isTelemetryLine recognizes supported prefixes and csv payloads', () => {
  assert.equal(isTelemetryLine(fixtures.lora), true);
  assert.equal(isTelemetryLine(fixtures.bracketed), true);
  assert.equal(isTelemetryLine(fixtures.raw), true);
  assert.equal(isTelemetryLine(fixtures.simulation), true);
  assert.equal(isTelemetryLine(fixtures.invalid), false);
});

test('resolveSerialTelemetryInput recognizes relay activation as a flight event', () => {
  assert.deepStrictEqual(resolveSerialTelemetryInput(fixtures.deploymentEvent), {
    type: 'flight-event',
    event: 'decoupling-activated'
  });
});
