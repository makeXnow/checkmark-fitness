CREATE TABLE IF NOT EXISTS habit_shortcut_codes (
  device_id TEXT PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  time_zone TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
