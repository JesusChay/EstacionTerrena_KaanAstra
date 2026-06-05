import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import telemetryContracts from '@kaan-astra/telemetry-contracts';
import { allowedFields } from '../services/telemetry-api/src/index.js';

const {
  TELEMETRY_API_PATHS,
  TELEMETRY_READ_MODEL_FIELDS,
  TELEMETRY_SAMPLE_FIELDS,
  getBrowserContractSnapshot
} = telemetryContracts;

const payloadFixture = JSON.parse(
  readFileSync(new URL('./fixtures/api-telemetry-payload.json', import.meta.url), 'utf8')
);

test('shared sample contract stays aligned with API allowedFields', () => {
  assert.deepStrictEqual(allowedFields, TELEMETRY_SAMPLE_FIELDS);
});

test('baseline payload fixture covers the shared sample contract exactly', () => {
  assert.deepStrictEqual(Object.keys(payloadFixture), TELEMETRY_SAMPLE_FIELDS);
});

test('physical station routes payload creation through the telemetry processor and shared contract adapter', () => {
  const mainSource = readFileSync(new URL('../main.js', import.meta.url), 'utf8');
  const processorSource = readFileSync(new URL('../src/application/use-cases/createTelemetryProcessor.js', import.meta.url), 'utf8');
  const adapterSource = readFileSync(new URL('../src/adapters/contracts/toTelemetrySampleDto.js', import.meta.url), 'utf8');

  assert.match(mainSource, /createTelemetryProcessor/);
  assert.match(mainSource, /toTelemetrySampleDto/);
  assert.doesNotMatch(processorSource, /createTelemetrySampleDto/);
  assert.match(adapterSource, /createTelemetrySampleDto/);
});

test('apps/web loads the generated browser contract before bootstrapping app.js', () => {
  const indexHtml = readFileSync(new URL('../apps/web/src/index.html', import.meta.url), 'utf8');

  assert.match(indexHtml, /<script src="\.\/generated\/telemetry-contract\.js"><\/script>/);
  assert.match(indexHtml, /STLLoader\.js/);
  assert.match(indexHtml, /<script type="module" src="\.\/bootstrap\/main\.js"><\/script>/);
  assert.ok(indexHtml.indexOf('./generated/telemetry-contract.js') < indexHtml.indexOf('./runtime-config.js'));
});

test('apps/web 3D presenter loads the shipped STL asset with the matching loader', () => {
  const presenterSource = readFileSync(new URL('../apps/web/src/adapters/ui/createModelPresenter.js', import.meta.url), 'utf8');

  assert.match(presenterSource, /THREE\.STLLoader|Three\.STLLoader/);
  assert.match(presenterSource, /\.\/assets\/cohete\.stl/);
});

test('desktop 3D renderer loads the rocket STL with STLLoader', () => {
  const modelHtml = readFileSync(new URL('../src/adapters/electron/renderer/model3d.html', import.meta.url), 'utf8');
  const modelSource = readFileSync(new URL('../src/adapters/electron/renderer/model3d.js', import.meta.url), 'utf8');

  assert.match(modelHtml, /STLLoader\.js/);
  assert.match(modelSource, /assets\/cohete\.stl/);
  assert.match(modelSource, /new THREE\.STLLoader\(/);
});

test('browser contract artifact stays synchronized with the shared package snapshot', () => {
  const source = readFileSync(new URL('../apps/web/src/generated/telemetry-contract.js', import.meta.url), 'utf8');
  const sandbox = { window: {} };

  vm.runInNewContext(source, sandbox);

  assert.equal(
    JSON.stringify(sandbox.window.TELEMETRY_CONTRACTS),
    JSON.stringify(getBrowserContractSnapshot())
  );
  assert.equal(
    JSON.stringify(sandbox.window.TELEMETRY_CONTRACTS.telemetryReadModelFields),
    JSON.stringify(TELEMETRY_READ_MODEL_FIELDS)
  );
  assert.equal(
    JSON.stringify(sandbox.window.TELEMETRY_CONTRACTS.apiPaths),
    JSON.stringify(TELEMETRY_API_PATHS)
  );
});
