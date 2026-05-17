import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { fatSecretSearchFoods } from './fatsecret'
import { runMacroEstimate } from './macroEstimate'
import { OPENAI_MODELS } from './openaiModels'

export interface Env {
  DB: D1Database
  ASSETS: Fetcher
  OPENAI_API_KEY?: string
  FATSECRET_CLIENT_ID?: string
  FATSECRET_CLIENT_SECRET?: string
}

const DEVICE_DEFAULT = 'default'

const defaultHabitsGoals = {
  cardio: { min: 4, max: 5, color: 'bg-rose-500', icon: 'Heart', label: 'Cardio' },
  lift: { min: 3, max: 5, color: 'bg-indigo-500', icon: 'Dumbbell', label: 'Lift' },
  diet: { min: 6, max: 7, color: 'bg-emerald-500', icon: 'Apple', label: 'Diet' },
  water: { min: 6, max: 7, dailyTarget: 4, color: 'bg-blue-500', icon: 'Droplet', label: 'Water' },
}

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

async function ensureDevice(db: D1Database, deviceId: string): Promise<void> {
  const existing = await db.prepare('SELECT device_id FROM app_state WHERE device_id = ?').bind(deviceId).first()
  if (existing) return

  const now = Date.now()
  const date = todayISO()
  const habitsGoals = JSON.stringify(defaultHabitsGoals)
  const habitsLogs = JSON.stringify({})
  const habitsSettings = JSON.stringify({ firstDayOfWeek: 0 })
  const macroGoals = JSON.stringify({ calorieGoal: 2000, proteinPctGoal: 30 })
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
}

const api = new Hono<{ Bindings: Env }>()

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

api.get('/api/bootstrap', async (c) => {
  try {
    const db = c.env.DB
    await ensureDevice(db, DEVICE_DEFAULT)

    const state = await db.prepare('SELECT * FROM app_state WHERE device_id = ?').bind(DEVICE_DEFAULT).first()
    const habits = await db.prepare('SELECT * FROM habits_bundle WHERE device_id = ?').bind(DEVICE_DEFAULT).first()
    const macro = await db.prepare('SELECT * FROM macro_bundle WHERE device_id = ?').bind(DEVICE_DEFAULT).first()
    const lift = await db.prepare('SELECT * FROM lift_bundle WHERE device_id = ?').bind(DEVICE_DEFAULT).first()

    const goalsRaw = safeJsonParse<unknown>((habits?.goals_json as string) || '', {})
    const logsRaw = safeJsonParse<unknown>((habits?.logs_json as string) || '', {})
    const goals = normalizeHabitsGoals(asObjectRecord(goalsRaw))
    const logs = normalizeHabitsLogs(asLogsMap(logsRaw))

    const body = {
      appState: state,
      habits: {
        goals,
        logs,
        appSettings: safeJsonParse((habits?.app_settings_json as string) || '', { firstDayOfWeek: 0 }),
        updatedAt: habits?.updated_at,
      },
      macro: {
        goals: safeJsonParse((macro?.goals_json as string) || '', {}),
        customFoods: safeJsonParse((macro?.custom_foods_json as string) || '', []),
        logs: safeJsonParse((macro?.logs_json as string) || '', {}),
        updatedAt: macro?.updated_at,
      },
      lift: {
        payload: safeJsonParse((lift?.payload_json as string) || '', {}),
        updatedAt: lift?.updated_at,
      },
    }

    return c.json(jsonSafe(body))
  } catch (e) {
    console.error('[bootstrap]', e)
    const message = e instanceof Error ? e.message : String(e)
    return c.json(
      {
        error: message,
        hint:
          message.includes('no such table') || message.includes('does not exist')
            ? 'Run D1 migrations: npm run db:migrate:remote (or db:migrate:local)'
            : undefined,
      },
      500,
    )
  }
})

api.patch('/api/app-state', async (c) => {
  const db = c.env.DB
  await ensureDevice(db, DEVICE_DEFAULT)
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
  values.push(DEVICE_DEFAULT)

  const sql = `UPDATE app_state SET ${updates.join(', ')} WHERE device_id = ?`
  await db.prepare(sql).bind(...values).run()

  const state = await db.prepare('SELECT * FROM app_state WHERE device_id = ?').bind(DEVICE_DEFAULT).first()
  return c.json({ ok: true, appState: state })
})

api.put('/api/habits', async (c) => {
  const db = c.env.DB
  await ensureDevice(db, DEVICE_DEFAULT)
  const body = (await c.req.json()) as {
    goals?: Record<string, unknown>
    logs?: Record<string, Record<string, unknown>>
    appSettings?: Record<string, unknown>
  }
  const goals = normalizeHabitsGoals(body.goals || {})
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
    .bind(DEVICE_DEFAULT, JSON.stringify(goals), JSON.stringify(logs), JSON.stringify(appSettings), now)
    .run()

  return c.json({ ok: true })
})

api.put('/api/macro', async (c) => {
  const db = c.env.DB
  await ensureDevice(db, DEVICE_DEFAULT)
  const body = (await c.req.json()) as {
    goals?: Record<string, unknown>
    customFoods?: unknown[]
    logs?: Record<string, unknown>
  }
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
      DEVICE_DEFAULT,
      JSON.stringify(body.goals || {}),
      JSON.stringify(body.customFoods || []),
      JSON.stringify(body.logs || {}),
      now,
    )
    .run()

  return c.json({ ok: true })
})

api.put('/api/lift', async (c) => {
  const db = c.env.DB
  await ensureDevice(db, DEVICE_DEFAULT)
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
    .bind(DEVICE_DEFAULT, JSON.stringify(body), now)
    .run()

  return c.json({ ok: true })
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
    user: string
    images?: { mimeType: string; base64: string }[]
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
        ...(body.system ? [{ role: 'system', content: body.system }] : []),
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
    user: string
    images: { mimeType: string; base64: string }[]
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
        ...(body.system ? [{ role: 'system', content: body.system }] : []),
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
    const partial = e && typeof e === 'object' && 'fatSecretResults' in e ? (e as { fatSecretResults?: unknown; fatSecretSource?: string }) : null
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

/** Support hosting the SPA under a path prefix (…/api/… still routes to Hono). */
function pathnameForWorkerRouter(pathname: string): string {
  const m = pathname.match(/\/api(?:\/|$)/)
  return m && m.index !== undefined ? pathname.slice(m.index) : pathname
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url)
    const path = pathnameForWorkerRouter(url.pathname)
    if (path.startsWith('/api')) {
      const next = new URL(url.toString())
      next.pathname = path
      return api.fetch(new Request(next.toString(), request), env, ctx)
    }
    return env.ASSETS.fetch(request)
  },
}
