import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  allowedLandingPredictionFields,
  allowedFields,
  handleRequest,
  mapLandingPredictionRow,
  mapTelemetryRow,
  normalizeIncomingLandingPrediction,
  normalizeBoolean,
  normalizeScalar,
  normalizeTelemetry
} from '../services/telemetry-api/src/index.js';

const landingPredictionFixture = JSON.parse(
  readFileSync(new URL('./fixtures/api-landing-prediction-payload.json', import.meta.url), 'utf8')
);

const payloadFixture = JSON.parse(
  readFileSync(new URL('./fixtures/api-telemetry-payload.json', import.meta.url), 'utf8')
);

class FakeStatement {
  constructor(db, sql) {
    this.db = db;
    this.sql = sql;
    this.args = [];
  }

  bind(...args) {
    this.args = args;
    return this;
  }

  async run() {
    this.db.runCalls.push({ sql: this.sql, args: this.args });
    const insertedId = this.sql.includes('landing_prediction_snapshots')
      ? this.db.insertedPredictionId
      : this.db.insertedId;
    return { meta: { last_row_id: insertedId } };
  }

  async first() {
    this.db.firstCalls.push({ sql: this.sql, args: this.args });

    if (this.sql.includes('landing_prediction_snapshots') && this.sql.includes('WHERE id = ?')) {
      return this.db.insertedPredictionRow;
    }

    if (this.sql.includes('landing_prediction_snapshots') && this.sql.includes('ORDER BY id DESC LIMIT 1')) {
      return this.db.latestPredictionRow;
    }

    if (this.sql.includes('WHERE id = ?')) {
      return this.db.insertedRow;
    }

    if (this.sql.includes('ORDER BY id DESC LIMIT 1')) {
      return this.db.latestRow;
    }

    throw new Error(`Unexpected first() query: ${this.sql}`);
  }

  async all() {
    this.db.allCalls.push({ sql: this.sql, args: this.args });

    if (this.sql.includes('landing_prediction_snapshots') && this.sql.includes('ORDER BY id DESC LIMIT ?')) {
      return { results: this.db.predictionRecentRows };
    }

    if (this.sql.includes('ORDER BY id DESC LIMIT ?')) {
      return { results: this.db.recentRows };
    }

    if (this.sql.includes('ORDER BY id ASC LIMIT ?')) {
      return { results: this.db.reportRows };
    }

    throw new Error(`Unexpected all() query: ${this.sql}`);
  }
}

class FakeDb {
  constructor({
    insertedId = 77,
    insertedPredictionId = 88,
    insertedPredictionRow = null,
    insertedRow = null,
    latestPredictionRow = null,
    latestRow = null,
    predictionRecentRows = [],
    recentRows = [],
    reportRows = []
  } = {}) {
    this.insertedId = insertedId;
    this.insertedPredictionId = insertedPredictionId;
    this.insertedPredictionRow = insertedPredictionRow;
    this.insertedRow = insertedRow;
    this.latestPredictionRow = latestPredictionRow;
    this.latestRow = latestRow;
    this.predictionRecentRows = predictionRecentRows;
    this.recentRows = recentRows;
    this.reportRows = reportRows;
    this.runCalls = [];
    this.firstCalls = [];
    this.allCalls = [];
  }

  prepare(sql) {
    return new FakeStatement(this, sql);
  }
}

function makeStoredRow(id, overrides = {}) {
  return {
    id,
    time: payloadFixture.time,
    speed: payloadFixture.speed,
    temperature: payloadFixture.temperature,
    pressure: payloadFixture.pressure,
    accelx: payloadFixture.accelx,
    accely: payloadFixture.accely,
    accelz: payloadFixture.accelz,
    atotal: payloadFixture.atotal,
    gyrox: payloadFixture.gyrox,
    gyroy: payloadFixture.gyroy,
    gyroz: payloadFixture.gyroz,
    gyroxRad: payloadFixture.gyroxRad,
    gyroyRad: payloadFixture.gyroyRad,
    gyrozRad: payloadFixture.gyrozRad,
    magx: payloadFixture.magx,
    magy: payloadFixture.magy,
    magz: payloadFixture.magz,
    altitude: payloadFixture.altitude,
    latitude: payloadFixture.latitude,
    longitude: payloadFixture.longitude,
    sourceChannel: payloadFixture.sourceChannel,
    receiverLatitude: payloadFixture.receiverLatitude,
    receiverLongitude: payloadFixture.receiverLongitude,
    distanceToReceiver: payloadFixture.distanceToReceiver,
    velocity: payloadFixture.velocity,
    velocityZ: payloadFixture.velocityZ,
    relativeAltitude: payloadFixture.relativeAltitude,
    decouplingStatus: payloadFixture.decouplingStatus ? 1 : 0,
    receivedAtUtc: '2026-06-04T18:22:03.000Z',
    ...overrides
  };
}

function makeStoredPredictionRow(id, overrides = {}) {
  return {
    id,
    status: landingPredictionFixture.status,
    phase: landingPredictionFixture.phase,
    confidence: landingPredictionFixture.confidence,
    modelVersion: landingPredictionFixture.modelVersion,
    windProfileSource: landingPredictionFixture.windProfileSource,
    observedAtUtc: landingPredictionFixture.observedAtUtc,
    etaSeconds: landingPredictionFixture.etaSeconds,
    uncertaintyRadiusMeters: landingPredictionFixture.uncertaintyRadiusMeters,
    altitudeAglMeters: landingPredictionFixture.altitudeAglMeters,
    currentDescentRateMps: landingPredictionFixture.currentDescentRateMps,
    timeToDeploySeconds: landingPredictionFixture.timeToDeploySeconds,
    deployAltitudeMeters: landingPredictionFixture.deployAltitudeMeters,
    currentLatitude: landingPredictionFixture.currentLocation.latitude,
    currentLongitude: landingPredictionFixture.currentLocation.longitude,
    predictedLandingLatitude: landingPredictionFixture.predictedLanding.latitude,
    predictedLandingLongitude: landingPredictionFixture.predictedLanding.longitude,
    payloadJson: JSON.stringify(landingPredictionFixture),
    receivedAtUtc: '2026-06-08T12:05:07.000Z',
    ...overrides
  };
}

test('normalize helpers keep the API contract stable', () => {
  assert.equal(normalizeScalar(24.35), '24.35');
  assert.equal(normalizeScalar(' 14:22:03 '), '14:22:03');
  assert.equal(normalizeScalar(''), null);
  assert.equal(normalizeBoolean('1'), true);
  assert.equal(normalizeBoolean('0'), false);

  assert.deepStrictEqual(normalizeTelemetry({
    time: ' 14:22:03 ',
    temperature: 24.35,
    decouplingStatus: 'false',
    ignored: 'value'
  }), {
    time: '14:22:03',
    temperature: '24.35',
    decouplingStatus: false
  });

  assert.deepStrictEqual(normalizeIncomingLandingPrediction({
    status: ' tracking ',
    phase: 'deployed',
    etaSeconds: '18.9',
    predictedLanding: { latitude: 20.1, longitude: -89.5 },
    estimatedTrajectory: [{ latitude: 20.1, longitude: -89.5 }],
    ignored: 'value'
  }), {
    status: 'tracking',
    phase: 'deployed',
    etaSeconds: 18.9,
    predictedLanding: { latitude: 20.1, longitude: -89.5 },
    estimatedTrajectory: [{ latitude: 20.1, longitude: -89.5 }]
  });
});

test('mapTelemetryRow preserves the read model and normalizes decouplingStatus to boolean', () => {
  assert.deepStrictEqual(mapTelemetryRow(makeStoredRow(5, { decouplingStatus: 1 })), {
    id: 5,
    time: payloadFixture.time,
    speed: payloadFixture.speed,
    temperature: payloadFixture.temperature,
    pressure: payloadFixture.pressure,
    accelx: payloadFixture.accelx,
    accely: payloadFixture.accely,
    accelz: payloadFixture.accelz,
    atotal: payloadFixture.atotal,
    gyrox: payloadFixture.gyrox,
    gyroy: payloadFixture.gyroy,
    gyroz: payloadFixture.gyroz,
    gyroxRad: payloadFixture.gyroxRad,
    gyroyRad: payloadFixture.gyroyRad,
    gyrozRad: payloadFixture.gyrozRad,
    magx: payloadFixture.magx,
    magy: payloadFixture.magy,
    magz: payloadFixture.magz,
    altitude: payloadFixture.altitude,
    latitude: payloadFixture.latitude,
    longitude: payloadFixture.longitude,
    sourceChannel: payloadFixture.sourceChannel,
    receiverLatitude: payloadFixture.receiverLatitude,
    receiverLongitude: payloadFixture.receiverLongitude,
    distanceToReceiver: payloadFixture.distanceToReceiver,
    velocity: payloadFixture.velocity,
    velocityZ: payloadFixture.velocityZ,
    relativeAltitude: payloadFixture.relativeAltitude,
    decouplingStatus: true,
    receivedAtUtc: '2026-06-04T18:22:03.000Z'
  });
});

test('mapLandingPredictionRow preserves the read model and restores payload JSON', () => {
  assert.deepStrictEqual(mapLandingPredictionRow(makeStoredPredictionRow(11)), {
    ...landingPredictionFixture,
    id: 11,
    receivedAtUtc: '2026-06-08T12:05:07.000Z'
  });
});

test('handleRequest exposes schema and health metadata without a database binding', async () => {
  const schemaResponse = await handleRequest(new Request('https://example.com/api/schema'), {});
  const schemaBody = await schemaResponse.json();

  assert.equal(schemaResponse.status, 200);
  assert.deepStrictEqual(schemaBody.fields, allowedFields);
  assert.deepStrictEqual(schemaBody.landingPredictionFields, allowedLandingPredictionFields);

  const healthResponse = await handleRequest(new Request('https://example.com/api/health'), {});
  const healthBody = await healthResponse.json();

  assert.equal(healthResponse.status, 200);
  assert.equal(healthBody.databaseAvailable, false);
  assert.equal(healthBody.latestAvailable, false);

  const latestResponse = await handleRequest(new Request('https://example.com/api/latest'), {});
  const latestBody = await latestResponse.json();

  assert.equal(latestResponse.status, 503);
  assert.equal(latestBody.ok, false);
});

test('handleRequest ingests landing predictions and persists the JSON payload contract', async () => {
  const insertedPredictionRow = makeStoredPredictionRow(88);
  const db = new FakeDb({ insertedPredictionRow });
  const response = await handleRequest(
    new Request('https://example.com/api/predictions', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ prediction: landingPredictionFixture })
    }),
    { TELEMETRY_DB: db }
  );

  const body = await response.json();
  assert.equal(response.status, 202);
  assert.equal(body.ok, true);
  assert.deepStrictEqual(body.prediction, {
    ...landingPredictionFixture,
    id: 88,
    receivedAtUtc: '2026-06-08T12:05:07.000Z'
  });

  assert.equal(db.runCalls.length, 1);
  assert.match(db.runCalls[0].args[16], /^\{/);
  assert.match(db.runCalls[0].args[17], /^\d{4}-\d{2}-\d{2}T/);
});

test('handleRequest ingests telemetry and persists the current string-based payload contract', async () => {
  const insertedRow = makeStoredRow(77, { decouplingStatus: 0 });
  const db = new FakeDb({ insertedRow });
  const response = await handleRequest(
    new Request('https://example.com/api/telemetry', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ telemetry: payloadFixture })
    }),
    { TELEMETRY_DB: db }
  );

  const body = await response.json();
  assert.equal(response.status, 202);
  assert.equal(body.ok, true);
  assert.deepStrictEqual(body.telemetry, {
    ...payloadFixture,
    id: 77,
    decouplingStatus: false,
    receivedAtUtc: '2026-06-04T18:22:03.000Z'
  });

  assert.equal(db.runCalls.length, 1);
  assert.equal(db.runCalls[0].args[0], payloadFixture.time);
  assert.equal(db.runCalls[0].args[20], payloadFixture.sourceChannel);
  assert.equal(db.runCalls[0].args[27], 0);
  assert.match(db.runCalls[0].args[28], /^\d{4}-\d{2}-\d{2}T/);
});

test('handleRequest returns recent telemetry oldest-to-newest inside the requested window and report telemetry oldest-first', async () => {
  const db = new FakeDb({
    recentRows: [makeStoredRow(9), makeStoredRow(8, { decouplingStatus: 1 })],
    reportRows: [makeStoredRow(2), makeStoredRow(3, { sourceChannel: 'xbee' })]
  });

  const recentResponse = await handleRequest(
    new Request('https://example.com/api/recent?limit=9999'),
    { TELEMETRY_DB: db, RECENT_LIMIT: '2' }
  );
  const recentBody = await recentResponse.json();

  assert.equal(recentResponse.status, 200);
  assert.deepStrictEqual(recentBody.telemetry.map((entry) => entry.id), [8, 9]);
  assert.equal(db.allCalls[0].args[0], 2);

  const reportResponse = await handleRequest(
    new Request('https://example.com/api/report?limit=3'),
    { TELEMETRY_DB: db }
  );
  const reportBody = await reportResponse.json();

  assert.equal(reportResponse.status, 200);
  assert.deepStrictEqual(reportBody.telemetry.map((entry) => entry.id), [2, 3]);
  assert.equal(reportBody.count, 2);
});

test('handleRequest returns latest and recent landing prediction snapshots', async () => {
  const db = new FakeDb({
    latestPredictionRow: makeStoredPredictionRow(14),
    predictionRecentRows: [makeStoredPredictionRow(14), makeStoredPredictionRow(15, { phase: 'predeploy' })]
  });

  const latestResponse = await handleRequest(
    new Request('https://example.com/api/predictions/latest'),
    { TELEMETRY_DB: db }
  );
  const latestBody = await latestResponse.json();

  assert.equal(latestResponse.status, 200);
  assert.equal(latestBody.prediction.id, 14);
  assert.equal(latestBody.prediction.windProfileSource, landingPredictionFixture.windProfileSource);

  const recentResponse = await handleRequest(
    new Request('https://example.com/api/predictions/recent?limit=999'),
    { TELEMETRY_DB: db, PREDICTION_RECENT_LIMIT: '2' }
  );
  const recentBody = await recentResponse.json();

  assert.equal(recentResponse.status, 200);
  assert.deepStrictEqual(recentBody.predictions.map((entry) => entry.id), [15, 14]);
  assert.equal(db.allCalls.at(-1).args[0], 2);
});
