ALTER TABLE macro_bundle ADD COLUMN metadata_revision INTEGER NOT NULL DEFAULT 1;
CREATE TRIGGER macro_metadata_legacy_revision AFTER UPDATE OF goals_json,custom_foods_json ON macro_bundle
WHEN NEW.metadata_revision=OLD.metadata_revision AND (NEW.goals_json<>OLD.goals_json OR NEW.custom_foods_json<>OLD.custom_foods_json)
BEGIN
  UPDATE macro_bundle SET metadata_revision=OLD.metadata_revision+1
    WHERE device_id=NEW.device_id AND metadata_revision=OLD.metadata_revision;
END;
-- Add individual food records without rewriting or deleting the original day rows.
CREATE TABLE macro_entries (
  device_id TEXT NOT NULL,
  date_key TEXT NOT NULL,
  entry_id TEXT NOT NULL,
  ordinal INTEGER NOT NULL,
  payload_json TEXT NOT NULL,
  revision INTEGER NOT NULL DEFAULT 1,
  deleted_at INTEGER,
  last_mutation_id TEXT,
  processing_token TEXT,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (device_id, date_key, entry_id)
);
CREATE INDEX idx_macro_entries_profile_day ON macro_entries(device_id, date_key, ordinal);
CREATE TABLE macro_diary_days (
  device_id TEXT NOT NULL,
  date_key TEXT NOT NULL,
  PRIMARY KEY (device_id, date_key)
);
INSERT INTO macro_diary_days SELECT device_id, date_key FROM macro_log_days;
INSERT INTO macro_entries (device_id, date_key, entry_id, ordinal, payload_json, revision, updated_at)
SELECT d.device_id, d.date_key,
  COALESCE(json_extract(j.value, '$.id'), 'legacy-' || d.date_key || '-' || j.key),
  CAST(j.key AS INTEGER), j.value, 1, d.updated_at
FROM macro_log_days d, json_each(d.items_json) j;
-- Kept intact as an immutable pre-migration recovery copy.
CREATE TABLE macro_log_days_archive_0010 AS SELECT * FROM macro_log_days;
-- Older app requests remain safe during rollout: old day writes are translated
-- into individual records in the same transaction.
CREATE TRIGGER macro_legacy_day_insert AFTER INSERT ON macro_log_days
BEGIN
  INSERT OR IGNORE INTO macro_diary_days VALUES(NEW.device_id,NEW.date_key);
  INSERT INTO macro_entries(device_id,date_key,entry_id,ordinal,payload_json,revision,updated_at)
    SELECT NEW.device_id,NEW.date_key,COALESCE(json_extract(j.value,'$.id'),'legacy-'||NEW.date_key||'-'||j.key),
      CAST(j.key AS INTEGER),j.value,1,NEW.updated_at FROM json_each(NEW.items_json) j WHERE 1
    ON CONFLICT(device_id,date_key,entry_id) DO UPDATE SET payload_json=excluded.payload_json,
      ordinal=excluded.ordinal,revision=macro_entries.revision+1,deleted_at=NULL,updated_at=excluded.updated_at
    WHERE macro_entries.payload_json<>excluded.payload_json OR macro_entries.deleted_at IS NOT NULL;
END;
CREATE TRIGGER macro_legacy_day_update AFTER UPDATE OF items_json ON macro_log_days
WHEN OLD.items_json<>NEW.items_json
BEGIN
  INSERT OR IGNORE INTO macro_diary_days VALUES(NEW.device_id,NEW.date_key);
  UPDATE macro_entries SET deleted_at=NEW.updated_at,revision=revision+1,updated_at=NEW.updated_at
    WHERE device_id=NEW.device_id AND date_key=NEW.date_key AND deleted_at IS NULL
      AND entry_id NOT IN(SELECT COALESCE(json_extract(j.value,'$.id'),'legacy-'||NEW.date_key||'-'||j.key) FROM json_each(NEW.items_json) j);
  INSERT INTO macro_entries(device_id,date_key,entry_id,ordinal,payload_json,revision,updated_at)
    SELECT NEW.device_id,NEW.date_key,COALESCE(json_extract(j.value,'$.id'),'legacy-'||NEW.date_key||'-'||j.key),
      CAST(j.key AS INTEGER),j.value,1,NEW.updated_at FROM json_each(NEW.items_json) j WHERE 1
    ON CONFLICT(device_id,date_key,entry_id) DO UPDATE SET payload_json=excluded.payload_json,
      ordinal=excluded.ordinal,revision=macro_entries.revision+1,deleted_at=NULL,updated_at=excluded.updated_at
    WHERE macro_entries.payload_json<>excluded.payload_json OR macro_entries.deleted_at IS NOT NULL;
END;
CREATE TRIGGER macro_legacy_day_delete AFTER DELETE ON macro_log_days
BEGIN
  UPDATE macro_entries SET deleted_at=OLD.updated_at,revision=revision+1
    WHERE device_id=OLD.device_id AND date_key=OLD.date_key AND deleted_at IS NULL;
END;
CREATE TABLE macro_entry_history (
  device_id TEXT NOT NULL,
  date_key TEXT NOT NULL,
  entry_id TEXT NOT NULL,
  revision INTEGER NOT NULL,
  ordinal INTEGER NOT NULL,
  payload_json TEXT NOT NULL,
  deleted_at INTEGER,
  updated_at INTEGER NOT NULL,
  captured_at INTEGER NOT NULL,
  PRIMARY KEY (device_id, date_key, entry_id, revision)
);
CREATE TRIGGER macro_entry_before_update BEFORE UPDATE ON macro_entries
WHEN OLD.revision <> NEW.revision
BEGIN
  INSERT OR IGNORE INTO macro_entry_history
    (device_id,date_key,entry_id,revision,ordinal,payload_json,deleted_at,updated_at,captured_at)
  VALUES (OLD.device_id,OLD.date_key,OLD.entry_id,OLD.revision,OLD.ordinal,OLD.payload_json,OLD.deleted_at,OLD.updated_at,
    CAST(strftime('%s','now') AS INTEGER) * 1000);
  DELETE FROM macro_entry_history
  WHERE device_id=OLD.device_id AND date_key=OLD.date_key AND entry_id=OLD.entry_id
    AND revision NOT IN (SELECT revision FROM macro_entry_history
      WHERE device_id=OLD.device_id AND date_key=OLD.date_key AND entry_id=OLD.entry_id ORDER BY revision DESC LIMIT 20);
END;
CREATE TABLE macro_input_receipts (
  device_id TEXT NOT NULL,
  request_id TEXT NOT NULL,
  date_key TEXT NOT NULL,
  raw_text TEXT NOT NULL,
  result_json TEXT,
  status TEXT NOT NULL,
  processing_token TEXT,
  error TEXT,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY(device_id,request_id)
);
