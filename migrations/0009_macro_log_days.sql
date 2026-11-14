-- Preserve original bundles verbatim, including oversized histories. Never rebuild
-- or bind the full history into a new row. Each day is copied separately below.
DROP TRIGGER IF EXISTS macro_bundle_backup_before_update;
DROP TRIGGER IF EXISTS macro_bundle_backup_before_delete;
ALTER TABLE macro_bundle RENAME TO macro_bundle_legacy_0009;
CREATE TABLE macro_bundle (
  device_id TEXT PRIMARY KEY DEFAULT 'default',
  goals_json TEXT NOT NULL,
  custom_foods_json TEXT NOT NULL,
  logs_json TEXT NOT NULL DEFAULT '{}',
  updated_at INTEGER NOT NULL,
  write_token TEXT
);
INSERT INTO macro_bundle (device_id, goals_json, custom_foods_json, logs_json, updated_at)
SELECT device_id, goals_json, custom_foods_json, '{}', updated_at FROM macro_bundle_legacy_0009;
CREATE TABLE macro_log_days (
  device_id TEXT NOT NULL,
  date_key TEXT NOT NULL,
  items_json TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (device_id, date_key)
);
INSERT INTO macro_log_days (device_id, date_key, items_json, updated_at)
SELECT m.device_id, j.key, j.value, m.updated_at
FROM macro_bundle_legacy_0009 AS m, json_each(m.logs_json) AS j;
CREATE TABLE macro_log_day_backups (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  device_id TEXT NOT NULL,
  date_key TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('daily', 'recent')),
  slot TEXT NOT NULL,
  items_json TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  captured_at INTEGER NOT NULL,
  UNIQUE (device_id, date_key, kind, slot)
);
CREATE INDEX idx_macro_day_backups_profile_day ON macro_log_day_backups(device_id, date_key, kind, id);

CREATE TRIGGER macro_log_day_backup_before_update
BEFORE UPDATE ON macro_log_days
WHEN OLD.items_json <> NEW.items_json
BEGIN
  INSERT OR IGNORE INTO macro_log_day_backups
    (device_id, date_key, kind, slot, items_json, updated_at, captured_at)
  VALUES (OLD.device_id, OLD.date_key, 'daily', strftime('%Y-%m-%d', 'now'),
    OLD.items_json, OLD.updated_at, CAST(strftime('%s', 'now') AS INTEGER) * 1000);
  INSERT INTO macro_log_day_backups
    (device_id, date_key, kind, slot, items_json, updated_at, captured_at)
  VALUES (OLD.device_id, OLD.date_key, 'recent', lower(hex(randomblob(16))),
    OLD.items_json, OLD.updated_at, CAST(strftime('%s', 'now') AS INTEGER) * 1000);
  DELETE FROM macro_log_day_backups
  WHERE device_id = OLD.device_id AND date_key = OLD.date_key AND kind = 'recent'
    AND id NOT IN (SELECT id FROM macro_log_day_backups
      WHERE device_id = OLD.device_id AND date_key = OLD.date_key AND kind = 'recent' ORDER BY id DESC LIMIT 20);
  DELETE FROM macro_log_day_backups
  WHERE device_id = OLD.device_id AND date_key = OLD.date_key AND kind = 'daily'
    AND id NOT IN (SELECT id FROM macro_log_day_backups
      WHERE device_id = OLD.device_id AND date_key = OLD.date_key AND kind = 'daily' ORDER BY id DESC LIMIT 30);
END;

CREATE TRIGGER macro_log_day_backup_before_delete
BEFORE DELETE ON macro_log_days
BEGIN
  INSERT OR IGNORE INTO macro_log_day_backups
    (device_id, date_key, kind, slot, items_json, updated_at, captured_at)
  VALUES (OLD.device_id, OLD.date_key, 'daily', strftime('%Y-%m-%d', 'now'),
    OLD.items_json, OLD.updated_at, CAST(strftime('%s', 'now') AS INTEGER) * 1000);
  INSERT INTO macro_log_day_backups
    (device_id, date_key, kind, slot, items_json, updated_at, captured_at)
  VALUES (OLD.device_id, OLD.date_key, 'recent', lower(hex(randomblob(16))),
    OLD.items_json, OLD.updated_at, CAST(strftime('%s', 'now') AS INTEGER) * 1000);
  DELETE FROM macro_log_day_backups
  WHERE device_id = OLD.device_id AND date_key = OLD.date_key AND kind = 'recent'
    AND id NOT IN (SELECT id FROM macro_log_day_backups
      WHERE device_id = OLD.device_id AND date_key = OLD.date_key AND kind = 'recent' ORDER BY id DESC LIMIT 20);
  DELETE FROM macro_log_day_backups
  WHERE device_id = OLD.device_id AND date_key = OLD.date_key AND kind = 'daily'
    AND id NOT IN (SELECT id FROM macro_log_day_backups
      WHERE device_id = OLD.device_id AND date_key = OLD.date_key AND kind = 'daily' ORDER BY id DESC LIMIT 30);
END;

CREATE TRIGGER IF NOT EXISTS macro_bundle_backup_before_update
BEFORE UPDATE ON macro_bundle
WHEN OLD.goals_json <> NEW.goals_json
  OR OLD.custom_foods_json <> NEW.custom_foods_json
  OR OLD.logs_json <> NEW.logs_json
BEGIN

  INSERT OR IGNORE INTO macro_bundle_backups
    (device_id, kind, slot, goals_json, custom_foods_json, logs_json, updated_at, captured_at)
  VALUES (OLD.device_id, 'daily', strftime('%Y-%m-%d', 'now'),
    OLD.goals_json, OLD.custom_foods_json, OLD.logs_json, OLD.updated_at,
    CAST(strftime('%s', 'now') AS INTEGER) * 1000);
  INSERT INTO macro_bundle_backups
    (device_id, kind, slot, goals_json, custom_foods_json, logs_json, updated_at, captured_at)
  VALUES (OLD.device_id, 'recent', lower(hex(randomblob(16))),
    OLD.goals_json, OLD.custom_foods_json, OLD.logs_json, OLD.updated_at,
    CAST(strftime('%s', 'now') AS INTEGER) * 1000);
  DELETE FROM macro_bundle_backups
  WHERE device_id = OLD.device_id AND kind = 'recent'
    AND id NOT IN (SELECT id FROM macro_bundle_backups
      WHERE device_id = OLD.device_id AND kind = 'recent' ORDER BY id DESC LIMIT 20);
  DELETE FROM macro_bundle_backups
  WHERE device_id = OLD.device_id AND kind = 'daily'
    AND id NOT IN (SELECT id FROM macro_bundle_backups
      WHERE device_id = OLD.device_id AND kind = 'daily' ORDER BY id DESC LIMIT 30);
END;

CREATE TRIGGER IF NOT EXISTS macro_bundle_backup_before_delete
BEFORE DELETE ON macro_bundle
BEGIN

  INSERT OR IGNORE INTO macro_bundle_backups
    (device_id, kind, slot, goals_json, custom_foods_json, logs_json, updated_at, captured_at)
  VALUES (OLD.device_id, 'daily', strftime('%Y-%m-%d', 'now'),
    OLD.goals_json, OLD.custom_foods_json, OLD.logs_json, OLD.updated_at,
    CAST(strftime('%s', 'now') AS INTEGER) * 1000);
  INSERT INTO macro_bundle_backups
    (device_id, kind, slot, goals_json, custom_foods_json, logs_json, updated_at, captured_at)
  VALUES (OLD.device_id, 'recent', lower(hex(randomblob(16))),
    OLD.goals_json, OLD.custom_foods_json, OLD.logs_json, OLD.updated_at,
    CAST(strftime('%s', 'now') AS INTEGER) * 1000);
  DELETE FROM macro_bundle_backups
  WHERE device_id = OLD.device_id AND kind = 'recent'
    AND id NOT IN (SELECT id FROM macro_bundle_backups
      WHERE device_id = OLD.device_id AND kind = 'recent' ORDER BY id DESC LIMIT 20);
  DELETE FROM macro_bundle_backups
  WHERE device_id = OLD.device_id AND kind = 'daily'
    AND id NOT IN (SELECT id FROM macro_bundle_backups
      WHERE device_id = OLD.device_id AND kind = 'daily' ORDER BY id DESC LIMIT 30);
END;
