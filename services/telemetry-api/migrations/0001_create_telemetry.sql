CREATE TABLE IF NOT EXISTS telemetry (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  time TEXT,
  speed TEXT,
  temperature TEXT,
  humidity TEXT,
  pressure TEXT,
  accelx TEXT,
  accely TEXT,
  accelz TEXT,
  atotal TEXT,
  gyrox TEXT,
  gyroy TEXT,
  gyroz TEXT,
  gyrox_rad TEXT,
  gyroy_rad TEXT,
  gyroz_rad TEXT,
  magx TEXT,
  magy TEXT,
  magz TEXT,
  altitude TEXT,
  latitude TEXT,
  longitude TEXT,
  velocity TEXT,
  velocity_z TEXT,
  relative_altitude TEXT,
  decoupling_status INTEGER NOT NULL DEFAULT 0,
  received_at_utc TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_telemetry_received_at_utc ON telemetry(received_at_utc DESC);
CREATE INDEX IF NOT EXISTS idx_telemetry_id ON telemetry(id DESC);
