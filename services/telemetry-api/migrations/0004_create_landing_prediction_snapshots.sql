CREATE TABLE IF NOT EXISTS landing_prediction_snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  status TEXT,
  phase TEXT,
  confidence TEXT,
  model_version TEXT,
  wind_profile_source TEXT,
  observed_at_utc TEXT,
  eta_seconds REAL,
  uncertainty_radius_meters REAL,
  altitude_agl_meters REAL,
  current_descent_rate_mps REAL,
  time_to_deploy_seconds REAL,
  deploy_altitude_meters REAL,
  current_latitude REAL,
  current_longitude REAL,
  predicted_landing_latitude REAL,
  predicted_landing_longitude REAL,
  payload_json TEXT NOT NULL,
  received_at_utc TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_landing_prediction_snapshots_received_at_utc
  ON landing_prediction_snapshots(received_at_utc DESC);

CREATE INDEX IF NOT EXISTS idx_landing_prediction_snapshots_observed_at_utc
  ON landing_prediction_snapshots(observed_at_utc DESC);
