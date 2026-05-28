import {
  DEFAULT_MACRO_PROMPTS,
  isMacroPromptKey,
  mergeMacroPrompts,
  type MacroPromptKey,
  type MacroPrompts,
} from '../src/features/macro/prompts'

const ROW_ID = 'default'

let schemaReady = false

async function ensureMacroPromptsSchema(db: D1Database): Promise<void> {
  if (schemaReady) return
  await db
    .prepare(
      `CREATE TABLE IF NOT EXISTS macro_ai_prompts (
        id TEXT PRIMARY KEY DEFAULT 'default',
        prompts_json TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      )`,
    )
    .run()
  schemaReady = true
}

function parseStoredPrompts(raw: string | null | undefined): Partial<MacroPrompts> {
  if (!raw) return {}
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>
    const out: Partial<MacroPrompts> = {}
    for (const [key, value] of Object.entries(parsed)) {
      if (isMacroPromptKey(key) && typeof value === 'string') out[key] = value
    }
    return out
  } catch {
    return {}
  }
}

export async function getMacroPrompts(db: D1Database): Promise<MacroPrompts> {
  await ensureMacroPromptsSchema(db)
  const row = await db
    .prepare('SELECT prompts_json FROM macro_ai_prompts WHERE id = ?')
    .bind(ROW_ID)
    .first<{ prompts_json: string }>()
  return mergeMacroPrompts(parseStoredPrompts(row?.prompts_json))
}

export async function getMacroPrompt(db: D1Database, key: MacroPromptKey): Promise<string> {
  const prompts = await getMacroPrompts(db)
  return prompts[key]
}

export async function saveMacroPrompts(
  db: D1Database,
  partial: Partial<MacroPrompts>,
): Promise<MacroPrompts> {
  await ensureMacroPromptsSchema(db)
  const current = await getMacroPrompts(db)
  const next = mergeMacroPrompts({ ...current, ...partial })
  const now = Date.now()
  await db
    .prepare(
      `INSERT INTO macro_ai_prompts (id, prompts_json, updated_at)
       VALUES (?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         prompts_json = excluded.prompts_json,
         updated_at = excluded.updated_at`,
    )
    .bind(ROW_ID, JSON.stringify(next), now)
    .run()
  return next
}

export function resolveMacroPromptSystem(
  prompts: MacroPrompts,
  promptKey: string | undefined,
  system: string | undefined,
): string | undefined {
  if (promptKey) {
    if (!isMacroPromptKey(promptKey)) throw new Error(`Unknown prompt key: ${promptKey}`)
    return prompts[promptKey]
  }
  return system?.trim() || undefined
}

export { DEFAULT_MACRO_PROMPTS }
