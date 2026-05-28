-- Global diet/macro AI prompts (editable by owner profile only via API).
CREATE TABLE IF NOT EXISTS macro_ai_prompts (
  id TEXT PRIMARY KEY DEFAULT 'default',
  prompts_json TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);
