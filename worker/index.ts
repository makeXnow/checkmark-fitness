import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { fatSecretLookupBarcode, fatSecretSearchFoods } from './fatsecret'
import { pickBarcodeFoodLabel } from './barcodeLabel'
import {
  type HabitsGoalsStored,
  parseHabitsGoalsStored,
  parseMacroGoalsStored,
  serializeHabitsGoalsStored,
  serializeMacroGoalsStored,
  unwrapHabitsGoalsLeaf,
  unwrapMacroGoalsLeaf,
} from './goalSnapshots'
import { runMacroEstimate } from './macroEstimate'
import {
  getMacroPrompts,
  resolveMacroPromptSystem,
  saveMacroPrompts,
} from './macroPromptsStore'
import { OPENAI_MODELS } from './openaiModels'
import { MACRO_PROMPTS_OWNER, type MacroPrompts } from '../src/features/macro/prompts'
import {
  clearLiftAssumption,
  closeLiftSession,
  dismissLiftAssumption,
  openLiftSession,
  parseLiftAssumptionPayload,
  resolveLiftAssumptionPrompt,
} from './liftAssumption'
import { isValidUsername, normalizeUsername } from './username'

export interface Env {
  DB: D1Database
  ASSETS: Fetcher
  /** Public site origin for PWA manifest URLs (e.g. https://makexnow.com). */
  PUBLIC_APP_ORIGIN?: string
  /** URL path prefix where the app is mounted (e.g. /checkmark-fitness). */
  PUBLIC_APP_BASE?: string
  OPENAI_API_KEY?: string
  FATSECRET_CLIENT_ID?: string
  FATSECRET_CLIENT_SECRET?: string
}

const defaultHabitsGoals = {
  cardio: { min: 1, max: 3, color: 'bg-rose-500', icon: 'Heart', label: 'Cardio' },
  lift: { min: 1, max: 3, color: 'bg-indigo-500', icon: 'Dumbbell', label: 'Lift' },
  diet: { min: 6, max: 7, color: 'bg-emerald-500', icon: 'Apple', label: 'Diet' },
  water: { min: 6, max: 7, dailyTarget: 4, color: 'bg-blue-500', icon: 'Droplet', label: 'Water' },
}

type ProfileVariables = { profileId: string }

function todayISO(): string {
  return new Date().toISOString().slice(0, 10)
}

function normalizeHabitsGoals(goals: Record<string, unknown>): Record<string, unknown> {
  const g = { ...goals }
  const lifting = g.lifting as Record<string, unknown> | undefined
  if (lifting && !g.lift) {
    g.lift = { ...lifting, label: (lifting.label as string) === 'Lifting' ? 'Lift' : lifting.label }
    delete g.lifting
  }
  return g
}

function safeJsonParse<T>(raw: string | null | undefined, fallback: T): T {
  if (raw == null || raw === '') return fallback
  try {
    return JSON.parse(raw) as T
  } catch {
    return fallback
  }
}

/** D1 may surface integers as bigint; JSON.stringify throws on bigint. */
function jsonSafe<T>(value: T): T {
  return JSON.parse(JSON.stringify(value, (_k, v) => (typeof v === 'bigint' ? Number(v) : v))) as T
}

function normalizeHabitsLogs(logs: Record<string, Record<string, unknown>>): Record<string, Record<string, unknown>> {
  const out: Record<string, Record<string, unknown>> = {}
  for (const [date, day] of Object.entries(logs || {})) {
    const d = { ...day }
    if ('lifting' in d && !('lift' in d)) {
      d.lift = d.lifting
      delete d.lifting
    }
    out[date] = d
  }
  return out
}

function asObjectRecord(v: unknown): Record<string, unknown> {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return {}
  return v as Record<string, unknown>
}

function asLogsMap(v: unknown): Record<string, Record<string, unknown>> {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return {}
  return v as Record<string, Record<string, unknown>>
}

let liftAssumptionSchemaReady = false

async function ensureLiftAssumptionSchema(db: D1Database): Promise<void> {
  if (liftAssumptionSchemaReady) return
  await db
    .prepare(
      `CREATE TABLE IF NOT EXISTS lift_assumption (
        device_id TEXT PRIMARY KEY DEFAULT 'default',
        payload_json TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      )`,
    )
    .run()
  await db
    .prepare(`CREATE INDEX IF NOT EXISTS idx_lift_assumption_device ON lift_assumption(device_id)`)
    .run()
  liftAssumptionSchemaReady = true
}

async function ensureLiftAssumption(db: D1Database, deviceId: string): Promise<void> {
  await ensureLiftAssumptionSchema(db)
  const existing = await db
    .prepare('SELECT device_id FROM lift_assumption WHERE device_id = ?')
    .bind(deviceId)
    .first()
  if (existing) return

  const now = Date.now()
  await db
    .prepare(`INSERT INTO lift_assumption (device_id, payload_json, updated_at) VALUES (?, ?, ?)`)
    .bind(deviceId, JSON.stringify({ activeSession: null, dailyOpens: {}, pending: null }), now)
    .run()
}

async function readLiftAssumptionPayload(db: D1Database, deviceId: string): Promise<ReturnType<typeof parseLiftAssumptionPayload>> {
  await ensureLiftAssumption(db, deviceId)
  const row = await db
    .prepare('SELECT payload_json FROM lift_assumption WHERE device_id = ?')
    .bind(deviceId)
    .first<{ payload_json: string }>()
  return parseLiftAssumptionPayload(row?.payload_json)
}

async function writeLiftAssumptionPayload(
  db: D1Database,
  deviceId: string,
  payload: ReturnType<typeof parseLiftAssumptionPayload>,
): Promise<void> {
  const now = Date.now()
  await db
    .prepare(
      `INSERT INTO lift_assumption (device_id, payload_json, updated_at)
       VALUES (?, ?, ?)
       ON CONFLICT(device_id) DO UPDATE SET
         payload_json = excluded.payload_json,
         updated_at = excluded.updated_at`,
    )
    .bind(deviceId, JSON.stringify(payload), now)
    .run()
}

async function ensureDevice(db: D1Database, deviceId: string): Promise<void> {
  const existing = await db.prepare('SELECT device_id FROM app_state WHERE device_id = ?').bind(deviceId).first()
  if (existing) return

  const now = Date.now()
  const date = todayISO()
  const habitsGoals = JSON.stringify(defaultHabitsGoals)
  const habitsLogs = JSON.stringify({})
  const habitsSettings = JSON.stringify({ firstDayOfWeek: 0 })
  const macroGoals = JSON.stringify({
    calorieGoal: 2150,
    proteinPctGoal: 35,
    weightLbs: 180,
    bodyFatPct: 18,
    activeHours: 5,
    goalMode: 'fast-cut',
  })
  const macroFoods = JSON.stringify([])
  const macroLogs = JSON.stringify({})
  const liftPayload = JSON.stringify({
    days: [],
    workouts: [],
    statuses: [],
    history: [],
    availablePlates: [],
  })

  await db.batch([
    db
      .prepare(
        `INSERT INTO app_state (
          device_id, selected_tab, settings_open, settings_section,
          lift_sub_route, lift_selected_day_id, lift_current_day_index,
          selected_date, updated_at
        ) VALUES (?, 'habits', 0, 'habits', 'workout', NULL, 0, ?, ?)`,
      )
      .bind(deviceId, date, now),
    db
      .prepare(
        `INSERT INTO habits_bundle (device_id, goals_json, logs_json, app_settings_json, updated_at)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .bind(deviceId, habitsGoals, habitsLogs, habitsSettings, now),
    db
      .prepare(
        `INSERT INTO macro_bundle (device_id, goals_json, custom_foods_json, logs_json, updated_at)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .bind(deviceId, macroGoals, macroFoods, macroLogs, now),
    db
      .prepare(`INSERT INTO lift_bundle (device_id, payload_json, updated_at) VALUES (?, ?, ?)`)
      .bind(deviceId, liftPayload, now),
  ])

  await ensureLiftAssumption(db, deviceId)
}

const api = new Hono<{ Bindings: Env }>()
const profileApi = new Hono<{ Bindings: Env; Variables: ProfileVariables }>()

profileApi.use('*', async (c, next) => {
  const id = normalizeUsername(c.req.param('username') ?? '')
  if (!isValidUsername(id)) {
    return c.json({ error: 'Invalid profile' }, 400)
  }
  c.set('profileId', id)
  await next()
})

api.onError((err, c) => {
  console.error('[api]', err)
  const message = err instanceof Error ? err.message : String(err)
  return c.json({ error: message || 'Internal Server Error' }, 500)
})

api.use(
  '*',
  cors({
    origin: (origin) => origin || '*',
    allowMethods: ['GET', 'PUT', 'PATCH', 'POST', 'OPTIONS'],
    allowHeaders: ['Content-Type', 'Authorization'],
  }),
)

api.get('/api/health', async (c) => {
  try {
    await c.env.DB.prepare('SELECT 1').first()
    return c.json({ ok: true, db: true })
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    return c.json({ ok: false, db: false, error: message }, 500)
  }
})

profileApi.get('/exists', async (c) => {
  const profileId = c.get('profileId')
  const row = await c.env.DB.prepare('SELECT device_id FROM app_state WHERE device_id = ?').bind(profileId).first()
  return c.json({ exists: row != null })
})

profileApi.get('/bootstrap', async (c) => {
  try {
    const profileId = c.get('profileId')
    const db = c.env.DB
    await ensureDevice(db, profileId)

    const state = await db.prepare('SELECT * FROM app_state WHERE device_id = ?').bind(profileId).first()
    const habits = await db.prepare('SELECT * FROM habits_bundle WHERE device_id = ?').bind(profileId).first()
    const macro = await db.prepare('SELECT * FROM macro_bundle WHERE device_id = ?').bind(profileId).first()
    const lift = await db.prepare('SELECT * FROM lift_bundle WHERE device_id = ?').bind(profileId).first()

    const goalsRaw = safeJsonParse<unknown>((habits?.goals_json as string) || '', {})
    const logsRaw = safeJsonParse<unknown>((habits?.logs_json as string) || '', {})
    const habitsStored = parseHabitsGoalsStored(goalsRaw, defaultHabitsGoals)
    const logs = normalizeHabitsLogs(asLogsMap(logsRaw))

    const macroGoalsRaw = safeJsonParse<unknown>((macro?.goals_json as string) || '', {})
    const macroStored = parseMacroGoalsStored(macroGoalsRaw)

    const liftPayloadParsed = safeJsonParse((lift?.payload_json as string) || '', {})
    const assumptionPayload = await readLiftAssumptionPayload(db, profileId)
    const pendingPrompt = resolveLiftAssumptionPrompt(assumptionPayload, liftPayloadParsed, Date.now())

    const body = {
      appState: state,
      liftAssumption: { pendingPrompt },
      habits: {
        goals: habitsStored.current,
        goalsSnapshotsByWeek: habitsStored.snapshotsByWeek,
        goalsHistory: habitsStored.goalHistory,
        logs,
        appSettings: safeJsonParse((habits?.app_settings_json as string) || '', { firstDayOfWeek: 0 }),
        updatedAt: habits?.updated_at,
      },
      macro: {
        goals: macroStored.current,
        goalsSnapshotsByDay: macroStored.snapshotsByDay,
        goalsHistory: macroStored.goalHistory,
        customFoods: safeJsonParse((macro?.custom_foods_json as string) || '', []),
        logs: safeJsonParse((macro?.logs_json as string) || '', {}),
        updatedAt: macro?.updated_at,
      },
      lift: {
        payload: safeJsonParse((lift?.payload_json as string) || '', {}),
        updatedAt: lift?.updated_at,
      },
    }

    return c.json(jsonSafe(body), 200, {
      'Cache-Control': 'private, max-age=60, stale-while-revalidate=120',
    })
  } catch (e) {
    console.error('[bootstrap]', e)
    const message = e instanceof Error ? e.message : String(e)
    return c.json(
      {
        error: message,
        hint:
          message.includes('no such table') || message.includes('does not exist')
            ? 'Run D1 migrations: npm run db:migrate:remote'
            : undefined,
      },
      500,
    )
  }
})

profileApi.patch('/app-state', async (c) => {
  const profileId = c.get('profileId')
  const db = c.env.DB
  await ensureDevice(db, profileId)
  const body = (await c.req.json()) as Record<string, unknown>
  const allowed = [
    'selected_tab',
    'settings_open',
    'settings_section',
    'lift_sub_route',
    'lift_selected_day_id',
    'lift_current_day_index',
    'selected_date',
  ] as const

  const updates: string[] = []
  const values: (string | number | null)[] = []
  for (const key of allowed) {
    if (key in body) {
      updates.push(`${key} = ?`)
      const v = body[key]
      values.push(
        key === 'settings_open'
          ? v
            ? 1
            : 0
          : key === 'lift_current_day_index'
            ? Number(v)
            : v === null
              ? null
              : String(v),
      )
    }
  }
  if (updates.length === 0) return c.json({ ok: true })

  const now = Date.now()
  updates.push('updated_at = ?')
  values.push(now)
  values.push(profileId)

  const sql = `UPDATE app_state SET ${updates.join(', ')} WHERE device_id = ?`
  await db.prepare(sql).bind(...values).run()

  const state = await db.prepare('SELECT * FROM app_state WHERE device_id = ?').bind(profileId).first()
  return c.json({ ok: true, appState: state })
})

profileApi.put('/habits', async (c) => {
  const profileId = c.get('profileId')
  const db = c.env.DB
  await ensureDevice(db, profileId)
  const body = (await c.req.json()) as {
    goals?: Record<string, unknown>
    goalsSnapshotsByWeek?: Record<string, Record<string, unknown>>
    goalsHistory?: HabitsGoalsStored['goalHistory']
    logs?: Record<string, Record<string, unknown>>
    appSettings?: Record<string, unknown>
  }
  const current =
    unwrapHabitsGoalsLeaf(normalizeHabitsGoals(asObjectRecord(body.goals || {}))) ?? defaultHabitsGoals
  const stored = serializeHabitsGoalsStored({
    current,
    snapshotsByWeek: body.goalsSnapshotsByWeek || {},
    goalHistory: body.goalsHistory || [],
  })
  const logs = normalizeHabitsLogs(body.logs || {})
  const appSettings = body.appSettings || { firstDayOfWeek: 0 }
  const now = Date.now()

  await db
    .prepare(
      `INSERT INTO habits_bundle (device_id, goals_json, logs_json, app_settings_json, updated_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(device_id) DO UPDATE SET
         goals_json = excluded.goals_json,
         logs_json = excluded.logs_json,
         app_settings_json = excluded.app_settings_json,
         updated_at = excluded.updated_at`,
    )
    .bind(profileId, JSON.stringify(stored), JSON.stringify(logs), JSON.stringify(appSettings), now)
    .run()

  return c.json({ ok: true })
})

profileApi.put('/macro', async (c) => {
  const profileId = c.get('profileId')
  const db = c.env.DB
  await ensureDevice(db, profileId)
  const body = (await c.req.json()) as {
    goals?: Record<string, unknown>
    goalsSnapshotsByDay?: Record<string, { calorieGoal: number; proteinPctGoal: number }>
    goalsHistory?: { effectiveDate: string; calorieGoal: number; proteinPctGoal: number }[]
    customFoods?: unknown[]
    logs?: Record<string, unknown>
  }
  const macroCurrent = unwrapMacroGoalsLeaf(body.goals) ?? asObjectRecord(body.goals || {})
  const stored = serializeMacroGoalsStored({
    current: macroCurrent,
    snapshotsByDay: body.goalsSnapshotsByDay || {},
    goalHistory: body.goalsHistory || [],
  })
  const now = Date.now()
  await db
    .prepare(
      `INSERT INTO macro_bundle (device_id, goals_json, custom_foods_json, logs_json, updated_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(device_id) DO UPDATE SET
         goals_json = excluded.goals_json,
         custom_foods_json = excluded.custom_foods_json,
         logs_json = excluded.logs_json,
         updated_at = excluded.updated_at`,
    )
    .bind(
      profileId,
      JSON.stringify(stored),
      JSON.stringify(body.customFoods || []),
      JSON.stringify(body.logs || {}),
      now,
    )
    .run()

  return c.json({ ok: true })
})

profileApi.put('/lift', async (c) => {
  const profileId = c.get('profileId')
  const db = c.env.DB
  await ensureDevice(db, profileId)
  const body = (await c.req.json()) as Record<string, unknown>
  const now = Date.now()
  await db
    .prepare(
      `INSERT INTO lift_bundle (device_id, payload_json, updated_at)
       VALUES (?, ?, ?)
       ON CONFLICT(device_id) DO UPDATE SET
         payload_json = excluded.payload_json,
         updated_at = excluded.updated_at`,
    )
    .bind(profileId, JSON.stringify(body), now)
    .run()

  return c.json({ ok: true })
})

async function readLiftSessionBody(c: { req: { json: () => Promise<unknown> } }): Promise<{ dayId: string; localDate: string } | null> {
  const body = (await c.req.json()) as { dayId?: string; localDate?: string }
  const dayId = body.dayId?.trim()
  const localDate = body.localDate?.trim()
  if (!dayId || !localDate || !/^\d{4}-\d{2}-\d{2}$/.test(localDate)) return null
  return { dayId, localDate }
}

profileApi.post('/lift/session/open', async (c) => {
  const profileId = c.get('profileId')
  const db = c.env.DB
  await ensureDevice(db, profileId)
  const parsed = await readLiftSessionBody(c)
  if (!parsed) return c.json({ error: 'dayId and localDate required' }, 400)

  const current = await readLiftAssumptionPayload(db, profileId)
  const next = openLiftSession(current, parsed.dayId, parsed.localDate, Date.now())
  await writeLiftAssumptionPayload(db, profileId, next)
  return c.json({ ok: true })
})

profileApi.post('/lift/session/close', async (c) => {
  const profileId = c.get('profileId')
  const db = c.env.DB
  await ensureDevice(db, profileId)
  const parsed = await readLiftSessionBody(c)
  if (!parsed) return c.json({ error: 'dayId and localDate required' }, 400)

  const current = await readLiftAssumptionPayload(db, profileId)
  const next = closeLiftSession(current, parsed.dayId, parsed.localDate, Date.now())
  await writeLiftAssumptionPayload(db, profileId, next)
  return c.json({ ok: true })
})

profileApi.post('/lift/assumption/dismiss', async (c) => {
  const profileId = c.get('profileId')
  const db = c.env.DB
  await ensureDevice(db, profileId)
  const parsed = await readLiftSessionBody(c)
  if (!parsed) return c.json({ error: 'dayId and localDate required' }, 400)

  const current = await readLiftAssumptionPayload(db, profileId)
  const next = dismissLiftAssumption(current, parsed.dayId, parsed.localDate)
  await writeLiftAssumptionPayload(db, profileId, next)
  return c.json({ ok: true })
})

profileApi.post('/lift/assumption/clear', async (c) => {
  const profileId = c.get('profileId')
  const db = c.env.DB
  await ensureDevice(db, profileId)
  const parsed = await readLiftSessionBody(c)
  if (!parsed) return c.json({ error: 'dayId and localDate required' }, 400)

  const current = await readLiftAssumptionPayload(db, profileId)
  const next = clearLiftAssumption(current, parsed.dayId, parsed.localDate)
  await writeLiftAssumptionPayload(db, profileId, next)
  return c.json({ ok: true })
})

profileApi.put('/macro/prompts', async (c) => {
  const profileId = c.get('profileId')
  if (profileId !== MACRO_PROMPTS_OWNER) {
    return c.json({ error: 'Forbidden' }, 403)
  }
  const body = (await c.req.json()) as Partial<MacroPrompts>
  const prompts = await saveMacroPrompts(c.env.DB, body)
  return c.json({ prompts, updatedAt: Date.now() })
})

api.route('/api/u/:username', profileApi)

api.get('/api/macro/prompts', async (c) => {
  const prompts = await getMacroPrompts(c.env.DB)
  return c.json({ prompts })
})

function audioUploadFromFormData(formData: FormData): { blob: Blob; filename: string } | null {
  const entry = formData.get('file')
  if (entry == null || typeof entry === 'string' || !(entry instanceof Blob)) return null
  const mime = entry.type || 'audio/webm'
  const ext = mime.includes('mp4') || mime.includes('aac') || mime.includes('m4a') ? 'm4a' : 'webm'
  const filename = entry instanceof File && entry.name ? entry.name : `audio.${ext}`
  return { blob: entry, filename }
}

/** OpenAI: audio transcription (webm/mp3/wav/m4a) */
api.post('/api/ai/transcribe', async (c) => {
  const key = c.env.OPENAI_API_KEY
  if (!key) return c.json({ error: 'OPENAI_API_KEY missing' }, 500)

  const formData = await c.req.formData()
  const upload = audioUploadFromFormData(formData)
  if (!upload) return c.json({ error: 'Expected file field' }, 400)
  if (upload.blob.size === 0) return c.json({ error: 'Empty audio file' }, 400)

  const upstream = new FormData()
  upstream.append('file', upload.blob, upload.filename)
  const model =
    c.req.query('model') === 'quality'
      ? OPENAI_MODELS.transcribeQuality
      : c.req.query('model') || OPENAI_MODELS.transcribeDefault
  upstream.append('model', model)

  const promptKey = c.req.query('promptKey') || 'TRANSCRIPTION'
  try {
    const prompts = await getMacroPrompts(c.env.DB)
    const transcriptionPrompt = resolveMacroPromptSystem(prompts, promptKey, undefined)
    if (transcriptionPrompt) upstream.append('prompt', transcriptionPrompt)
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Invalid prompt key'
    return c.json({ error: msg }, 400)
  }

  const res = await fetch('https://api.openai.com/v1/audio/transcriptions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}` },
    body: upstream,
  })

  if (!res.ok) {
    const errText = await res.text()
    return c.json({ error: 'OpenAI transcription failed', detail: errText }, 502)
  }

  const data = (await res.json()) as { text?: string }
  return c.json({ text: data.text || '' })
})

/** OpenAI: multimodal JSON extraction (vision + instructions) */
api.post('/api/ai/json', async (c) => {
  const key = c.env.OPENAI_API_KEY
  if (!key) return c.json({ error: 'OPENAI_API_KEY missing' }, 500)

  const body = (await c.req.json()) as {
    model?: string
    system?: string
    promptKey?: string
    user: string
    images?: { mimeType: string; base64: string }[]
  }

  let system: string | undefined
  try {
    const prompts = await getMacroPrompts(c.env.DB)
    system = resolveMacroPromptSystem(prompts, body.promptKey, body.system)
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Invalid prompt key'
    return c.json({ error: msg }, 400)
  }

  const model = body.model || OPENAI_MODELS.chatFast
  const content: unknown[] = [{ type: 'text', text: body.user }]
  for (const img of body.images || []) {
    content.push({
      type: 'image_url',
      image_url: { url: `data:${img.mimeType};base64,${img.base64}` },
    })
  }

  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      temperature: 0.2,
      response_format: { type: 'json_object' },
      messages: [
        ...(system ? [{ role: 'system', content: system }] : []),
        { role: 'user', content },
      ],
    }),
  })

  if (!res.ok) {
    const errText = await res.text()
    return c.json({ error: 'OpenAI chat failed', detail: errText }, 502)
  }

  const data = (await res.json()) as {
    choices?: { message?: { content?: string } }[]
  }
  const raw = data.choices?.[0]?.message?.content || '{}'
  try {
    const parsed = JSON.parse(raw) as unknown
    return c.json({ result: parsed })
  } catch {
    return c.json({ error: 'Model returned non-JSON', raw }, 502)
  }
})

/** Vision-heavy JSON tasks (food labels, packaging). Defaults to gpt-4o. */
api.post('/api/ai/vision', async (c) => {
  const key = c.env.OPENAI_API_KEY
  if (!key) return c.json({ error: 'OPENAI_API_KEY missing' }, 500)

  const body = (await c.req.json()) as {
    model?: string
    system?: string
    promptKey?: string
    user: string
    images: { mimeType: string; base64: string }[]
  }

  let system: string | undefined
  try {
    const prompts = await getMacroPrompts(c.env.DB)
    system = resolveMacroPromptSystem(prompts, body.promptKey, body.system)
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Invalid prompt key'
    return c.json({ error: msg }, 400)
  }

  const model = body.model || OPENAI_MODELS.chatVision
  const content: unknown[] = [{ type: 'text', text: body.user }]
  for (const img of body.images || []) {
    content.push({
      type: 'image_url',
      image_url: { url: `data:${img.mimeType};base64,${img.base64}` },
    })
  }

  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      temperature: 0.2,
      response_format: { type: 'json_object' },
      messages: [
        ...(system ? [{ role: 'system', content: system }] : []),
        { role: 'user', content },
      ],
    }),
  })

  if (!res.ok) {
    const errText = await res.text()
    return c.json({ error: 'OpenAI vision failed', detail: errText }, 502)
  }

  const data = (await res.json()) as {
    choices?: { message?: { content?: string } }[]
  }
  const raw = data.choices?.[0]?.message?.content || '{}'
  try {
    const parsed = JSON.parse(raw) as unknown
    return c.json({ result: parsed })
  } catch {
    return c.json({ error: 'Model returned non-JSON', raw }, 502)
  }
})

/** FatSecret search + macro AI in one Worker call (credentials stay server-side). */
api.post('/api/macro/estimate', async (c) => {
  try {
    const body = await c.req.json()
    const result = await runMacroEstimate(c.env, body as Parameters<typeof runMacroEstimate>[1])
    return c.json(result)
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Macro estimate failed'
    const partial =
      e && typeof e === 'object' && 'fatSecretResults' in e
        ? (e as { fatSecretResults?: unknown; fatSecretSource?: string })
        : null
    if (partial?.fatSecretResults) {
      return c.json(
        {
          error: msg,
          fatSecretResults: partial.fatSecretResults,
          fatSecretSource: partial.fatSecretSource ?? 'none',
        },
        502,
      )
    }
    return c.json({ error: msg }, 502)
  }
})

/** FatSecret food search (OAuth + foods.search). */
api.post('/api/fatsecret/search', async (c) => {
  const body = (await c.req.json()) as { query?: string }
  const query = body.query?.trim()
  if (!query) return c.json({ error: 'query required' }, 400)
  if (!c.env.FATSECRET_CLIENT_ID || !c.env.FATSECRET_CLIENT_SECRET) {
    return c.json({ error: 'FatSecret credentials missing' }, 500)
  }
  try {
    const foods = await fatSecretSearchFoods(c.env, query)
    return c.json({ foods })
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'FatSecret search failed'
    return c.json({ error: msg }, 502)
  }
})

/** FatSecret barcode lookup (food.find_id_for_barcode.v2). */
api.post('/api/fatsecret/barcode', async (c) => {
  const body = (await c.req.json()) as { barcode?: string; region?: string }
  const barcode = body.barcode?.trim()
  if (!barcode) return c.json({ error: 'barcode required' }, 400)
  if (!c.env.FATSECRET_CLIENT_ID || !c.env.FATSECRET_CLIENT_SECRET) {
    return c.json({ error: 'FatSecret credentials missing' }, 500)
  }
  try {
    const food = await fatSecretLookupBarcode(c.env, barcode, body.region?.trim() || 'US')
    const label = await pickBarcodeFoodLabel(c.env.DB, c.env.OPENAI_API_KEY, food)
    return c.json({ food, name: label.name, emoji: label.emoji })
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'FatSecret barcode lookup failed'
    const notFound = /product not found|\berror 211\b|\b211:/i.test(msg)
    const invalid = /invalid barcode/i.test(msg)
    return c.json({ error: msg }, notFound ? 404 : invalid ? 400 : 502)
  }
})

/** Support hosting the SPA under a path prefix (…/api/… still routes to Hono). */
function pathnameForWorkerRouter(pathname: string): string {
  const m = pathname.match(/\/api(?:\/|$)/)
  return m && m.index !== undefined ? pathname.slice(m.index) : pathname
}

const PROFILE_MANIFEST_RE = /\/manifest\/u\/([a-z0-9][a-z0-9_-]*[a-z0-9]|[a-z0-9])\.webmanifest$/

function publicOrigin(request: Request, env: Env): string {
  const configured = env.PUBLIC_APP_ORIGIN?.replace(/\/$/, '')
  if (configured) return configured

  const referer = request.headers.get('referer')
  if (referer) {
    try {
      const origin = new URL(referer).origin
      if (!origin.includes('.workers.dev')) return origin
    } catch {
      /* ignore */
    }
  }

  const host = request.headers.get('x-forwarded-host') ?? request.headers.get('host')
  if (host && !host.includes('.workers.dev')) {
    const proto = request.headers.get('x-forwarded-proto') ?? 'https'
    return `${proto}://${host}`
  }
  return new URL(request.url).origin
}

function profileManifestResponse(request: Request, env: Env): Response | null {
  const url = new URL(request.url)
  const origin = publicOrigin(request, env)
  // makexnow router may strip the app prefix before the Worker; full public path is in x-mxn-path.
  const pathname = request.headers.get('x-mxn-path') ?? url.pathname
  const m = pathname.match(PROFILE_MANIFEST_RE)
  if (!m) return null
  const username = m[1]
  if (!isValidUsername(username)) return null

  const configuredBase = env.PUBLIC_APP_BASE?.replace(/\/$/, '') ?? ''
  const baseEnd = pathname.indexOf('/manifest/')
  const basePath =
    configuredBase || (baseEnd > 0 ? pathname.slice(0, baseEnd) : '')
  const startPath = basePath ? `${basePath}/u/${username}` : `/u/${username}`
  const startUrl = new URL(startPath, origin).href
  const scope = new URL(basePath ? `${basePath}/` : '/', origin).href
  const icon = (file: string) => new URL(`${basePath}/icons/${file}`, origin).href

  const body = {
    id: startUrl,
    name: `Checkmark · ${username}`,
    short_name: username,
    start_url: startUrl,
    scope,
    display: 'standalone',
    orientation: 'portrait-primary',
    background_color: '#0a0a0a',
    theme_color: '#0a0a0a',
    icons: [
      { src: icon('pwa-192.png'), sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: icon('pwa-512.png'), sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: icon('pwa-512.png'), sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  }
  return new Response(JSON.stringify(body), {
    headers: {
      'Content-Type': 'application/manifest+json',
      'Cache-Control': 'no-cache',
    },
  })
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url)
    const manifest = profileManifestResponse(request, env)
    if (manifest) return manifest

    const path = pathnameForWorkerRouter(url.pathname)
    if (path.startsWith('/api')) {
      const next = new URL(url.toString())
      next.pathname = path
      return api.fetch(new Request(next.toString(), request), env, ctx)
    }
    return env.ASSETS.fetch(request)
  },
}
