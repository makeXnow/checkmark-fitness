CREATE TABLE voice_jobs (
  profile TEXT NOT NULL,
  id TEXT NOT NULL,
  date TEXT NOT NULL,
  recorded_at INTEGER NOT NULL,
  attempt INTEGER NOT NULL DEFAULT 0,
  phase TEXT NOT NULL DEFAULT 'queued',
  published_version INTEGER NOT NULL DEFAULT 0,
  transcript TEXT,
  foods TEXT,
  error TEXT,
  PRIMARY KEY (profile, id)
);
CREATE INDEX voice_jobs_day ON voice_jobs(profile, date);
