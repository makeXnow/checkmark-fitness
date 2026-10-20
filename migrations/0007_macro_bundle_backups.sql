-- Keep per-profile recovery copies inside D1, without rewinding the shared database.
CREATE TABLE IF NOT EXISTS macro_bundle_backups (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  device_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('daily', 'recent')),
  slot TEXT NOT NULL,
  goals_json TEXT NOT NULL,
  custom_foods_json TEXT NOT NULL,
  logs_json TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  captured_at INTEGER NOT NULL,
  UNIQUE (device_id, kind, slot)
);
CREATE INDEX IF NOT EXISTS idx_macro_backups_profile_kind
ON macro_bundle_backups(device_id, kind, id);

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
