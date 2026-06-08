import test from 'node:test';
import assert from 'node:assert/strict';
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

test('apps/web bootstraps the React entrypoint with runtime config and bundler-owned UI libraries', () => {
  const indexHtml = readFileSync(new URL('../apps/web/index.html', import.meta.url), 'utf8');

  assert.match(indexHtml, /<script src="\/infrastructure\/telemetry-api-runtime-config\.js"><\/script>/);
  assert.match(indexHtml, /<script type="module" src="\/src\/main\.jsx"><\/script>/);
  assert.match(indexHtml, /<div id="root"><\/div>/);
  assert.doesNotMatch(indexHtml, /cdn\.jsdelivr|unpkg|cdnjs/);
});

test('apps/web 3D presenter loads the shipped STL asset with the matching loader', () => {
  const presenterSource = readFileSync(new URL('../apps/web/src/adapters/ui/createModelPresenter.js', import.meta.url), 'utf8');

  assert.match(presenterSource, /from 'three\/examples\/jsm\/loaders\/STLLoader\.js'/);
  assert.match(presenterSource, /cohete\.stl/);
  assert.match(presenterSource, /new STLLoader\(/);
});

test('desktop 3D renderer loads the rocket STL with STLLoader', () => {
  const dashboardHtml = readFileSync(new URL('../src/adapters/electron/renderer/dashboard.html', import.meta.url), 'utf8');
  const mapHtml = readFileSync(new URL('../src/adapters/electron/renderer/map.html', import.meta.url), 'utf8');
  const modelHtml = readFileSync(new URL('../src/adapters/electron/renderer/model3d.html', import.meta.url), 'utf8');
  const dashboardSource = readFileSync(new URL('../src/adapters/electron/renderer/dashboard.mjs', import.meta.url), 'utf8');
  const mapSource = readFileSync(new URL('../src/adapters/electron/renderer/map.mjs', import.meta.url), 'utf8');
  const modelSource = readFileSync(new URL('../src/adapters/electron/renderer/model3d.mjs', import.meta.url), 'utf8');

  assert.doesNotMatch(dashboardHtml, /cdn\.jsdelivr|unpkg|cdnjs/);
  assert.doesNotMatch(mapHtml, /cdn\.jsdelivr|unpkg|cdnjs/);
  assert.doesNotMatch(modelHtml, /cdn\.jsdelivr|unpkg|cdnjs/);
  assert.match(dashboardHtml, /type="module" src="\.\/dashboard\.mjs"/);
  assert.match(dashboardHtml, /@kurkle\/color/);
  assert.match(mapHtml, /type="module" src="\.\/map\.mjs"/);
  assert.match(modelHtml, /type="module" src="\.\/model3d\.mjs"/);
  assert.match(dashboardSource, /import Chart from 'chart\.js\/auto'/);
  assert.match(mapSource, /import \* as Leaflet from 'leaflet'/);
  assert.match(modelSource, /import \* as THREE from 'three'/);
  assert.match(modelSource, /three\/examples\/jsm\/loaders\/STLLoader\.js/);
  assert.match(modelSource, /assets\/cohete\.stl/);
  assert.match(modelSource, /new STLLoader\(/);
});

test('browser contract artifact stays synchronized with the shared package snapshot', async () => {
  const { default: browserContracts } = await import(new URL('../apps/web/src/generated/telemetry-contract.js', import.meta.url));

  assert.equal(
    JSON.stringify(browserContracts),
    JSON.stringify(getBrowserContractSnapshot())
  );
  assert.equal(
    JSON.stringify(browserContracts.telemetryReadModelFields),
    JSON.stringify(TELEMETRY_READ_MODEL_FIELDS)
  );
  assert.equal(
    JSON.stringify(browserContracts.apiPaths),
    JSON.stringify(TELEMETRY_API_PATHS)
  );
});
