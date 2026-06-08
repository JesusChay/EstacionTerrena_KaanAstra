import { mapTelemetryRow, selectFields } from './telemetryRowMapper.js';

export function createTelemetryRepository({ db, now = () => new Date().toISOString() }) {
  return {
    async insertTelemetry(telemetry) {
      const receivedAtUtc = now();
      const sql = `
        INSERT INTO telemetry (
          time, speed, temperature, pressure,
          accelx, accely, accelz, atotal,
          gyrox, gyroy, gyroz, gyrox_rad, gyroy_rad, gyroz_rad,
          magx, magy, magz,
          altitude, latitude, longitude, source_channel, receiver_latitude, receiver_longitude, distance_to_receiver,
          velocity, velocity_z, relative_altitude,
          decoupling_status, received_at_utc
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `;

      const values = [
        telemetry.time ?? null,
        telemetry.speed ?? null,
        telemetry.temperature ?? null,
        telemetry.pressure ?? null,
        telemetry.accelx ?? null,
        telemetry.accely ?? null,
        telemetry.accelz ?? null,
        telemetry.atotal ?? null,
        telemetry.gyrox ?? null,
        telemetry.gyroy ?? null,
        telemetry.gyroz ?? null,
        telemetry.gyroxRad ?? null,
        telemetry.gyroyRad ?? null,
        telemetry.gyrozRad ?? null,
        telemetry.magx ?? null,
        telemetry.magy ?? null,
        telemetry.magz ?? null,
        telemetry.altitude ?? null,
        telemetry.latitude ?? null,
        telemetry.longitude ?? null,
        telemetry.sourceChannel ?? null,
        telemetry.receiverLatitude ?? null,
        telemetry.receiverLongitude ?? null,
        telemetry.distanceToReceiver ?? null,
        telemetry.velocity ?? null,
        telemetry.velocityZ ?? null,
        telemetry.relativeAltitude ?? null,
        telemetry.decouplingStatus ? 1 : 0,
        receivedAtUtc
      ];

      const result = await db.prepare(sql).bind(...values).run();
      const insertedId = result.meta.last_row_id;
      const insertedTelemetry = await db
        .prepare(`SELECT ${selectFields} FROM telemetry WHERE id = ? LIMIT 1`)
        .bind(insertedId)
        .first();

      return mapTelemetryRow(insertedTelemetry);
    },

    async readLatestTelemetry() {
      const row = await db
        .prepare(`SELECT ${selectFields} FROM telemetry ORDER BY id DESC LIMIT 1`)
        .first();

      return mapTelemetryRow(row);
    },

    async readRecentTelemetry(limit) {
      const result = await db
        .prepare(`SELECT ${selectFields} FROM telemetry ORDER BY id DESC LIMIT ?`)
        .bind(limit)
        .all();

      const rows = Array.isArray(result.results) ? result.results : [];
      return rows.map(mapTelemetryRow).reverse();
    },

    async readReportTelemetry(limit, since) {
      const query = since
        ? `SELECT ${selectFields} FROM telemetry WHERE received_at_utc >= ? ORDER BY id ASC LIMIT ?`
        : `SELECT ${selectFields} FROM telemetry ORDER BY id ASC LIMIT ?`;

      const stmt = db.prepare(query);
      const result = since
        ? await stmt.bind(since, limit).all()
        : await stmt.bind(limit).all();

      const rows = Array.isArray(result.results) ? result.results : [];
      return rows.map(mapTelemetryRow);
    }
  };
}
