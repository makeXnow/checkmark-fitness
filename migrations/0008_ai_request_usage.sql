-- Metadata only. No prompts, meals, images, audio, API keys, or raw error messages.
CREATE TABLE IF NOT EXISTS ai_request_usage (
  id TEXT PRIMARY KEY,
  request_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  profile_id TEXT,
  source TEXT NOT NULL CHECK (source IN ('app', 'development', 'test', 'unknown')),
  feature TEXT NOT NULL,
  call_index INTEGER NOT NULL,
  model TEXT,
  http_status INTEGER,
  error_code TEXT,
  upstream_request_id TEXT,
  input_tokens INTEGER,
  output_tokens INTEGER,
  cached_input_tokens INTEGER,
  cache_write_tokens INTEGER,
  audio_seconds REAL,
  latency_ms INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS ai_usage_created ON ai_request_usage(created_at);
CREATE INDEX IF NOT EXISTS ai_usage_profile_source ON ai_request_usage(profile_id, source, created_at);
CREATE INDEX IF NOT EXISTS ai_usage_request ON ai_request_usage(request_id);
