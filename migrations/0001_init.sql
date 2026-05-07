-- Device-scoped bundles (default device until multi-user auth exists)
CREATE TABLE IF NOT EXISTS app_state (
  device_id TEXT PRIMARY KEY DEFAULT 'default',
  selected_tab TEXT NOT NULL DEFAULT 'habits',
  settings_open INTEGER NOT NULL DEFAULT 0,
  settings_section TEXT NOT NULL DEFAULT 'habits',
  lift_sub_route TEXT NOT NULL DEFAULT 'workout',
  lift_selected_day_id TEXT,
  lift_current_day_index INTEGER NOT NULL DEFAULT 0,
  selected_date TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS habits_bundle (
  device_id TEXT PRIMARY KEY DEFAULT 'default',
  goals_json TEXT NOT NULL,
  logs_json TEXT NOT NULL,
  app_settings_json TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS macro_bundle (
  device_id TEXT PRIMARY KEY DEFAULT 'default',
  goals_json TEXT NOT NULL,
  custom_foods_json TEXT NOT NULL,
  logs_json TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS lift_bundle (
  device_id TEXT PRIMARY KEY DEFAULT 'default',
  payload_json TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);
