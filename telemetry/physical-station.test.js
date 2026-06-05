const test = require('node:test');
const assert = require('node:assert/strict');
const { TELEMETRY_SAMPLE_FIELDS } = require('@kaan-astra/telemetry-contracts');
const { parseTelemetryMessage } = require('../src/adapters/serial/telemetryParser');
const { buildDesktopReportArtifacts } = require('../src/application/use-cases/buildDesktopReportArtifacts');
const { createSimulationTelemetrySource } = require('../src/application/use-cases/createSimulationTelemetrySource');
const { createTelemetryProcessor } = require('../src/application/use-cases/createTelemetryProcessor');
const { toTelemetrySampleDto } = require('../src/adapters/contracts/toTelemetrySampleDto');

const LORA_LINE = 'LORA: 24.50,1007.20,128.40,0.11,-0.02,1.01,3.40,5.60,7.80,141.10,-8.40,29.90,20.967370,-89.623710';

test('createTelemetryProcessor returns an internal processed telemetry model', () => {
  const processor = createTelemetryProcessor({
    parseTelemetryMessage,
    now: () => new Date('2026-06-05T12:00:00.000Z')
  });

  const processedTelemetry = processor.process(LORA_LINE);

  assert.ok(processedTelemetry.observedAt instanceof Date);
  assert.equal(processedTelemetry.temperature, 24.5);
  assert.equal(processedTelemetry.altitude, 128.4);
  assert.equal(processedTelemetry.sourceChannel, 'lora');
  assert.equal(processedTelemetry.receiverLatitude, 20.985352);
  assert.equal(processedTelemetry.receiverLongitude, -89.691277);
});

test('toTelemetrySampleDto maps the processed model to the shared contract', () => {
  const processor = createTelemetryProcessor({
    parseTelemetryMessage,
    now: () => new Date('2026-06-05T12:00:00.000Z')
  });

  const payload = toTelemetrySampleDto(processor.process(LORA_LINE));

  assert.deepStrictEqual(Object.keys(payload), TELEMETRY_SAMPLE_FIELDS);
  assert.equal(payload.temperature, '24.50');
  assert.equal(payload.altitude, '128.40');
  assert.equal(payload.sourceChannel, 'lora');
  assert.equal(payload.receiverLatitude, '20.985352');
  assert.equal(payload.receiverLongitude, '-89.691277');
});

test('createTelemetryProcessor applies receiver location updates to future payloads', () => {
  const processor = createTelemetryProcessor({
    parseTelemetryMessage,
    now: () => new Date('2026-06-05T12:00:00.000Z')
  });

  assert.equal(processor.setReceiverLocation({ latitude: 21.1234567, longitude: -88.7654321 }), true);

  const processedTelemetry = processor.process(LORA_LINE);
  assert.equal(processedTelemetry.receiverLatitude, 21.1234567);
  assert.equal(processedTelemetry.receiverLongitude, -88.7654321);
});

test('createTelemetryProcessor rejects incomplete acceleration payloads', () => {
  const processor = createTelemetryProcessor({
    parseTelemetryMessage,
    now: () => new Date('2026-06-05T12:00:00.000Z')
  });

  const payload = processor.process({
    sourceChannel: 'lora',
    accelx: 0.1,
    temperature: 22.5
  });

  assert.equal(payload, null);
});

test('createSimulationTelemetrySource emits simulation payloads compatible with the serial parser', () => {
  const simulationSource = createSimulationTelemetrySource({ randomFn: () => 0.5 });
  const parsedTelemetry = parseTelemetryMessage(simulationSource.nextTelemetryInput());

  assert.ok(parsedTelemetry);
  assert.equal(typeof parsedTelemetry.temperature, 'number');
  assert.equal(typeof parsedTelemetry.decouplingStatus, 'boolean');
});

test('buildDesktopReportArtifacts keeps report semantics in application', () => {
  const artifacts = buildDesktopReportArtifacts({
    samples: [
      {
        time: '12:00:00',
        speed: '1.23',
        temperature: '25.00',
        pressure: '1007.00',
        accelx: '0.10',
        accely: '0.11',
        accelz: '0.98',
        atotal: '0.99',
        gyrox: '1.10',
        gyroy: '1.20',
        gyroz: '1.30',
        magx: '14.00',
        magy: '15.00',
        magz: '16.00',
        altitude: '120.00',
        relativeAltitude: '10.00',
        latitude: '20.000001',
        longitude: '-89.000001',
        velocity: '2.00',
        velocityZ: '-0.10',
        decouplingStatus: false
      }
    ],
    isSimulation: true,
    generatedAt: new Date('2026-06-05T12:00:00.000Z')
  });

  assert.equal(artifacts.excelSheet.sheetName, 'Reporte CanSat');
  assert.equal(artifacts.excelSheet.headers[0], 'Tiempo');
  assert.equal(artifacts.excelSheet.rows[0][0], '12:00:00');
  assert.match(artifacts.analysisText, /Modo: Simulacion/);
});
