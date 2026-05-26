CREATE TABLE IF NOT EXISTS lift_assumption (
  device_id TEXT PRIMARY KEY DEFAULT 'default',
  payload_json TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_lift_assumption_device ON lift_assumption(device_id);
