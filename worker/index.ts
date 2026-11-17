import { applyEstimateResult } from '../src/features/macro/applyEstimateResult'
import { parsedItemsToDayItems, type ParsedFoodItem } from '../src/features/macro/macroLib'
import { ensureInputEntry, entryVersions, mutateEntry, readEntry } from './macroEntries'
import { entryChanges, type EntryMutation } from '../src/lib/macroEntryChanges'
import { readMacroLogs } from './macroLogs'
import { macroLogPatch } from '../src/lib/macroLogPatch'
import { trackedOpenAiFetch, withAiUsage } from './aiUsage'
import { normalizeFoodLibrary } from '../src/features/macro/foodLibrary'
import type { MacroCustomFood, MacroDayItem } from '../src/types/domain'
import { Hono, type Context } from 'hono'
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
import { loadPersonalVocabulary } from './macroMemory'
import {
  getMacroPrompts,
  resolveMacroPromptSystem,
  saveMacroPrompts,
} from './macroPromptsStore'
import { OPENAI_MODELS } from './openaiModels'
import { openAiResponseFormat, callOpenAiJsonWithRetry, ensureJsonObjectUser } from './openaiJson'
import { schemaForPromptKey } from '../src/features/macro/macroAiSchemas'
import { parserValidationErrors, validateParserResponse } from '../src/features/macro/macroAiValidate'
import { rewriteFatSecretSearch, rewriteSpokenFoodLog } from '../src/features/macro/macroBrandAliases'
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
import {
  SHORTCUT_HABITS,
  applyHabitShortcut,
  findProfileByShortcutCode,
  getOrCreateShortcutCode,
  isValidTimeZone,
  localDateInTimeZone,
  type ShortcutHabit,
} from './habitShortcuts'

export interface Env {
  DB: D1Database
  ASSETS: Fetcher
  SCAN_IMAGES?: R2Bucket
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
    allowHeaders: ['Content-Type', 'Authorization', 'x-checkmark-profile', 'x-checkmark-source'],
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
        logs: await readMacroLogs(db, profileId),
        entryRevisions: await entryVersions(db, profileId),
        metadataRevision:macro?.metadata_revision ?? 1,
        updatedAt: macro?.updated_at,
      },
      lift: {
        payload: safeJsonParse((lift?.payload_json as string) || '', {}),
        updatedAt: lift?.updated_at,
      },
    }

    // Mutable per-user diary — never HTTP-cache (stale bootstrap was overwriting newer puts).
    return c.json(jsonSafe(body), 200, {
      'Cache-Control': 'private, no-store',
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

profileApi.post('/macro/parse', async (c) => {
  const profile=c.get('profileId'), db=c.env.DB
  await ensureDevice(db,profile)
  const body=await c.req.json<{date:string;item:MacroDayItem;rawText:string;userEditedText?:boolean}>()
  if(!/^\d{4}-\d{2}-\d{2}$/.test(body.date) || !body.item?.id || !body.rawText?.trim()) return c.json({error:'Food description is required.'},400)
  const receipt=await db.prepare('SELECT * FROM macro_input_receipts WHERE device_id=? AND request_id=?')
    .bind(profile,body.item.id).first<{status:string;result_json:string|null;raw_text:string;updated_at:number}>()
  if(receipt?.status==='parsed' && receipt.raw_text===body.rawText) {
    const ids=JSON.parse(receipt.result_json || '[]') as string[]
    const entries=await Promise.all(ids.map(id=>readEntry(db,profile,body.date,id)))
    return c.json({items:entries.filter(r=>r&&r.deleted_at==null).map(r=>JSON.parse(r!.payload_json)),entryRevisions:await entryVersions(db,profile),updatedAt:(await db.prepare('SELECT updated_at FROM macro_bundle WHERE device_id=?').bind(profile).first<{updated_at:number}>())!.updated_at})
  }
  if(receipt?.status==='processing' && Date.now()-receipt.updated_at<120000) return c.json({error:'This food is still processing. Retry shortly.'},409)
  let input=await ensureInputEntry(db,profile,body.date,{...body.item,rawText:body.rawText,status:'processing_cancellable'})
  const token=crypto.randomUUID(), now=Date.now()
  await db.batch([
    db.prepare(`INSERT INTO macro_input_receipts(device_id,request_id,date_key,raw_text,status,processing_token,updated_at)
      VALUES(?,?,?,?,'processing',?,?) ON CONFLICT(device_id,request_id) DO UPDATE SET
      raw_text=excluded.raw_text,status='processing',processing_token=excluded.processing_token,updated_at=excluded.updated_at,error=NULL`)
      .bind(profile,body.item.id,body.date,body.rawText,token,now),
    db.prepare('UPDATE macro_entries SET processing_token=? WHERE device_id=? AND date_key=? AND entry_id=? AND revision=? AND deleted_at IS NULL')
      .bind(token,profile,body.date,body.item.id,input.revision),
  ])
  try {
    if(!c.env.OPENAI_API_KEY) throw new Error('Food processing is temporarily unavailable. Your description has been saved.')
    const prompts=await getMacroPrompts(db)
    const system=resolveMacroPromptSystem(prompts,'PARSER',undefined)
    const known=await vocabularyList(db,profile)
    const user=`Input: ${rewriteSpokenFoodLog(body.rawText)}${known.length ? `\n\nKNOWN FOODS FOR THIS USER (spelling reference only — never add items from this list): ${known.join('; ')}` : ''}`
    const raw=await callOpenAiJsonWithRetry(c.env.OPENAI_API_KEY,system ?? '',user,{model:OPENAI_MODELS.chatFast,schema:schemaForPromptKey('PARSER')!,validate:validateParserResponse,validationHint:r=>parserValidationErrors(r).join('; ')}) as {items:ParsedFoodItem[]}
    if(!raw.items?.length) throw new Error('No food recognized. Your description is saved; edit it and retry.')
    const items=parsedItemsToDayItems(raw.items,{userInput:body.rawText}).map((item,i)=>({...item,id:`${body.item.id}-${i}`,timestamp:body.item.timestamp ?? now,...(body.userEditedText?{userEditedName:true}:{})}))
    const guard='EXISTS(SELECT 1 FROM macro_entries WHERE device_id=? AND date_key=? AND entry_id=? AND revision=? AND processing_token=? AND deleted_at IS NULL)'
    const guardArgs=[profile,body.date,body.item.id,input.revision,token]
    const writes=items.map((item,i)=>db.prepare(`INSERT OR IGNORE INTO macro_entries(device_id,date_key,entry_id,ordinal,payload_json,revision,updated_at)
      SELECT ?,?,?,?,?,1,? WHERE ${guard}`).bind(profile,body.date,item.id,now+i,JSON.stringify(item),now,...guardArgs))
    const result=await db.batch([
      ...writes,
      db.prepare(`UPDATE macro_input_receipts SET status='parsed',result_json=?,updated_at=? WHERE device_id=? AND request_id=? AND processing_token=? AND ${guard}`)
        .bind(JSON.stringify(items.map(i=>i.id)),now,profile,body.item.id,token,...guardArgs),
      db.prepare(`UPDATE macro_entries SET deleted_at=?,revision=revision+1,processing_token=NULL,updated_at=? WHERE device_id=? AND date_key=? AND entry_id=? AND revision=? AND processing_token=? AND deleted_at IS NULL RETURNING revision`)
        .bind(now,now,...guardArgs),
      db.prepare('UPDATE macro_bundle SET updated_at=MAX(updated_at+1,?) WHERE device_id=?').bind(now,profile),
    ])
    if(!result[writes.length+1].results.length) return c.json({error:'This entry changed or was deleted during processing.'},409)
    return c.json({items,entryRevisions:await entryVersions(db,profile),updatedAt:(await db.prepare('SELECT updated_at FROM macro_bundle WHERE device_id=?').bind(profile).first<{updated_at:number}>())!.updated_at})
  } catch(error) {
    const message=error instanceof Error?error.message:'Food processing failed'
    input=(await readEntry(db,profile,body.date,body.item.id))!
    if(input && input.deleted_at==null && input.processing_token===token) {
      const item={...JSON.parse(input.payload_json),status:'editing_raw',estimateError:message}
      await mutateEntry(db,profile,{date:body.date,id:body.item.id,item,baseRevision:input.revision,ordinal:input.ordinal,mutationId:`failed:${token}`,supersedes:[]})
      await db.prepare("UPDATE macro_input_receipts SET status='failed',error=?,updated_at=? WHERE device_id=? AND request_id=? AND processing_token=?").bind(message,Date.now(),profile,body.item.id,token).run()
    }
    return c.json({error:message},502)
  }
})

profileApi.put('/macro/entries/:date/:id', async (c) => {
  const profile = c.get('profileId')
  await ensureDevice(c.env.DB, profile)
  const body = await c.req.json<EntryMutation>()
  if (body.date !== c.req.param('date') || body.id !== c.req.param('id')) return c.json({ error: 'Food identity does not match.' }, 400)
  const result = await mutateEntry(c.env.DB, profile, body)
  if (result.status !== 200) return c.json(result, result.status)
  const metadata = await c.env.DB.prepare('SELECT updated_at FROM macro_bundle WHERE device_id=?').bind(profile).first<{ updated_at: number }>()
  const row=await readEntry(c.env.DB,profile,body.date,body.id)
  return c.json({ ok: true, revision: result.revision, updatedAt: metadata!.updated_at, item:row?.deleted_at==null?JSON.parse(row!.payload_json):null })
})

profileApi.put('/macro', async (c) => {
  const profileId = c.get('profileId')
  const db = c.env.DB
  await ensureDevice(db, profileId)
  const body = (await c.req.json()) as {
    baseMetadataRevision?: number
    baseUpdatedAt?: number
    goals?: Record<string, unknown>
    goalsSnapshotsByDay?: Record<string, { calorieGoal: number; proteinPctGoal: number }>
    goalsHistory?: { effectiveDate: string; calorieGoal: number; proteinPctGoal: number }[]
    customFoods?: MacroCustomFood[]
    logs?: Record<string, unknown>
  }
  if (!Number.isSafeInteger(body.baseUpdatedAt) || Number(body.baseUpdatedAt) < 0) {
    return c.json({ error: 'Please reload the app before saving food. This app version needs an update.' }, 428)
  }
  if (!body.goals || Array.isArray(body.goals) || typeof body.goals !== 'object' ||
      !Array.isArray(body.customFoods) || !body.logs || Array.isArray(body.logs) || typeof body.logs !== 'object') {
    return c.json({ error: 'A complete food diary is required to save.' }, 400)
  }
  // Older clients send the entire history. Do not bind that multi-megabyte JSON
  // into every SQL statement: only changed days belong in the merge patch.
  const current = await db.prepare('SELECT updated_at,metadata_revision FROM macro_bundle WHERE device_id = ?')
    .bind(profileId).first<{ updated_at: number;metadata_revision:number }>()
  const metadataOnly=Number.isSafeInteger(body.baseMetadataRevision) && Object.keys(body.logs).length===0
  if (!current || (metadataOnly ? current.metadata_revision!==body.baseMetadataRevision : current.updated_at !== body.baseUpdatedAt)) {
    return c.json({ error: 'Your food diary changed elsewhere. Reload the latest diary and try your edit again.' }, 409)
  }
  const previousLogs = await readMacroLogs(db, profileId)
  const logsPatch = macroLogPatch(previousLogs, body.logs)
  const mergedLogs = { ...previousLogs, ...body.logs } as Record<string, MacroDayItem[]>
  for (const [day, items] of Object.entries(logsPatch)) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || !Array.isArray(items)) {
      return c.json({ error: 'Food diary days must contain a list of entries.' }, 400)
    }
    if (new TextEncoder().encode(JSON.stringify(items)).byteLength > 1_500_000) {
      return c.json({ error: 'This day contains too much food lookup detail to save. Remove an entry and try again.' }, 413)
    }
  }
  const macroCurrent = unwrapMacroGoalsLeaf(body.goals) ?? asObjectRecord(body.goals || {})
  const stored = serializeMacroGoalsStored({
    current: macroCurrent,
    snapshotsByDay: body.goalsSnapshotsByDay || {},
    goalHistory: body.goalsHistory || [],
  })
  const now = Math.max(Date.now(), current.updated_at + 1)
  const writeToken = crypto.randomUUID()
  const goalsJson=JSON.stringify(stored),foodsJson=JSON.stringify(normalizeFoodLibrary(body.customFoods || [],mergedLogs))
  const saved = await db.prepare(`UPDATE macro_bundle SET metadata_revision=metadata_revision+CASE WHEN goals_json<>? OR custom_foods_json<>? THEN 1 ELSE 0 END,
      goals_json=?,custom_foods_json=?,updated_at=?,write_token=?
      WHERE device_id=? AND ${metadataOnly?'metadata_revision':'updated_at'}=? RETURNING updated_at,metadata_revision`)
    .bind(goalsJson,foodsJson,goalsJson,foodsJson,now,writeToken,profileId,metadataOnly?body.baseMetadataRevision:body.baseUpdatedAt)
    .first<{updated_at:number;metadata_revision:number}>()
  if (saved) {
    const versions = await entryVersions(db, profileId)
    const operations = entryChanges(previousLogs, logsPatch as Record<string,MacroDayItem[]>, versions)
    for(const date of Object.keys(logsPatch)) await db.prepare('INSERT OR IGNORE INTO macro_diary_days(device_id,date_key) VALUES(?,?)').bind(profileId,date).run()
    for (const op of operations) {
      const result = await mutateEntry(db,profileId,op)
      if (result.status !== 200) return c.json(result,result.status)
    }
    const revision = await db.prepare('SELECT updated_at FROM macro_bundle WHERE device_id=?').bind(profileId).first<{updated_at:number}>()
    saved.updated_at = revision!.updated_at
  }

  if (!saved) {
    return c.json({ error: 'Your food diary changed elsewhere. Reload the latest diary and try your edit again.' }, 409)
  }
  return c.json({ ok: true, updatedAt: saved.updated_at,metadataRevision:saved.metadata_revision })
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

// Scanner diagnostics use the existing profile-scoped image bucket.
profileApi.put('/macro/barcode-recordings/:session/:sequence', async (c) => {
  const bucket = c.env.SCAN_IMAGES
  if (!bucket) return c.json({ error: 'Image storage unavailable' }, 503)
  const session = c.req.param('session')
  const sequence = c.req.param('sequence')
  if (!/^[a-f0-9-]{36}$/.test(session) || !/^\d{1,8}$/.test(sequence)) {
    return c.json({ error: 'Invalid frame identifier' }, 400)
  }
  if (Number(c.req.header('content-length')) > 2_100_000) {
    return c.json({ error: 'Frame too large' }, 413)
  }
  const form = await c.req.formData()
  const image = form.get('image')
  const metadata = form.get('metadata')
  if (!(image instanceof File) || image.type !== 'image/jpeg' || image.size > 2_000_000 ||
      typeof metadata !== 'string' || new TextEncoder().encode(metadata).length > 1800) {
    return c.json({ error: 'Invalid scanner frame' }, 400)
  }
  try { JSON.parse(metadata) } catch { return c.json({ error: 'Invalid metadata' }, 400) }
  const key = `${c.get('profileId')}/barcode-recordings/${session}/${sequence.padStart(8, '0')}.jpg`
  await bucket.put(key, image.stream(), {
    httpMetadata: { contentType: 'image/jpeg' },
    customMetadata: { scan: metadata },
  })
  return c.json({ key })
})

profileApi.get('/macro/barcode-recordings', async (c) => {
  const bucket = c.env.SCAN_IMAGES
  if (!bucket) return c.json({ error: 'Image storage unavailable' }, 503)
  const result = await bucket.list({
    prefix: `${c.get('profileId')}/barcode-recordings/`,
    cursor: c.req.query('cursor') || undefined,
    limit: 100,
    include: ['customMetadata'],
  })
  return c.json({
    frames: result.objects.map(object => ({
      key: object.key, size: object.size, uploadedAt: object.uploaded,
      metadata: object.customMetadata?.scan ? JSON.parse(object.customMetadata.scan) : null,
    })),
    cursor: result.truncated ? result.cursor : null,
  })
})

profileApi.post('/macro/scan-images', async (c) => {
  const bucket = c.env.SCAN_IMAGES
  if (!bucket) return c.json({ error: 'SCAN_IMAGES bucket not configured' }, 500)
  const profileId = c.get('profileId')
  const body = (await c.req.json()) as {
    itemId?: string
    front?: { mimeType?: string; base64?: string }
    nutrition?: { mimeType?: string; base64?: string }
  }
  const itemId = body.itemId?.trim()
  if (!itemId) return c.json({ error: 'itemId required' }, 400)
  if (!body.front?.base64 || !body.nutrition?.base64) {
    return c.json({ error: 'front and nutrition images required' }, 400)
  }

  const putSide = async (side: 'front' | 'nutrition', img: { mimeType?: string; base64?: string }) => {
    const mime = img.mimeType?.trim() || 'image/jpeg'
    const ext = mime.includes('png') ? 'png' : 'jpg'
    const objectKey = `${profileId}/${itemId}/${side}.${ext}`
    const bin = atob(img.base64!)
    const bytes = new Uint8Array(bin.length)
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
    await bucket.put(objectKey, bytes, {
      httpMetadata: { contentType: mime },
      customMetadata: { profileId, itemId, side },
    })
    return objectKey
  }

  const frontKey = await putSide('front', body.front)
  const nutritionKey = await putSide('nutrition', body.nutrition)
  return c.json({ frontKey, nutritionKey })
})

profileApi.get('/macro/scan-images/*', async (c) => {
  const bucket = c.env.SCAN_IMAGES
  if (!bucket) return c.json({ error: 'SCAN_IMAGES bucket not configured' }, 500)
  const profileId = c.get('profileId')
  const rawPath = c.req.path
  const marker = '/macro/scan-images/'
  const idx = rawPath.indexOf(marker)
  const key = idx >= 0 ? decodeURIComponent(rawPath.slice(idx + marker.length)) : ''
  if (!key || !key.startsWith(`${profileId}/`)) return c.json({ error: 'Not found' }, 404)
  const obj = await bucket.get(key)
  if (!obj) return c.json({ error: 'Not found' }, 404)
  const headers = new Headers()
  headers.set('Content-Type', obj.httpMetadata?.contentType || 'image/jpeg')
  headers.set('Cache-Control', 'private, max-age=3600')
  return new Response(obj.body, { headers })
})

/** Re-run nutrition vision N times on stored scan photos (for debugging consistency). */
profileApi.post('/macro/packaging-retest', async (c) => {
  const bucket = c.env.SCAN_IMAGES
  const key = c.env.OPENAI_API_KEY
  if (!bucket) return c.json({ error: 'SCAN_IMAGES bucket not configured' }, 500)
  if (!key) return c.json({ error: 'OPENAI_API_KEY missing' }, 500)
  const profileId = c.get('profileId')
  const body = (await c.req.json()) as {
    frontKey?: string
    nutritionKey?: string
    amountText?: string
    runs?: number
  }
  const frontKey = body.frontKey?.trim()
  const nutritionKey = body.nutritionKey?.trim()
  if (!frontKey?.startsWith(`${profileId}/`) || !nutritionKey?.startsWith(`${profileId}/`)) {
    return c.json({ error: 'frontKey and nutritionKey required for this profile' }, 400)
  }
  const runs = Math.min(Math.max(Number(body.runs) || 3, 1), 5)
  const amountText = body.amountText?.trim() || '1 serving'

  const loadB64 = async (objectKey: string) => {
    const obj = await bucket.get(objectKey)
    if (!obj) throw new Error(`Missing image ${objectKey}`)
    const buf = await obj.arrayBuffer()
    const bytes = new Uint8Array(buf)
    let binary = ''
    for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]!)
    return {
      mimeType: obj.httpMetadata?.contentType || 'image/jpeg',
      base64: btoa(binary),
    }
  }

  const frontImg = await loadB64(frontKey)
  const nutritionImg = await loadB64(nutritionKey)

  let system: string
  try {
    const prompts = await getMacroPrompts(c.env.DB)
    system = resolveMacroPromptSystem(prompts, 'ANALYZE_NUTRITION', undefined)
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Invalid prompt'
    return c.json({ error: msg }, 400)
  }

  const jsonSchema = schemaForPromptKey('ANALYZE_NUTRITION')
  const results: unknown[] = []
  for (let i = 0; i < runs; i++) {
    const content: unknown[] = [
      { type: 'text', text: 'Analyze this nutrition facts panel.' },
      { type: 'image_url', image_url: { url: `data:${nutritionImg.mimeType};base64,${nutritionImg.base64}` } },
    ]
    const res = await trackedOpenAiFetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: OPENAI_MODELS.chatVision,
        ...(OPENAI_MODELS.chatVision.includes('gpt-5') ? {} : { temperature: 0 }),
        response_format: openAiResponseFormat(jsonSchema),
        messages: [
          { role: 'system', content: system },
          { role: 'user', content },
        ],
      }),
    })
    if (!res.ok) {
      const errText = await res.text()
      results.push({ error: errText })
      continue
    }
    const data = (await res.json()) as { choices?: { message?: { content?: string } }[] }
    const raw = data.choices?.[0]?.message?.content || ''
    try {
      results.push({ run: i + 1, amountText, vision: JSON.parse(raw), frontIgnored: Boolean(frontImg.base64) })
    } catch {
      results.push({ run: i + 1, parseError: true, raw })
    }
  }

  return c.json({ runs, results })
})

profileApi.post('/shortcut-code', async (c) => {
  const profileId = c.get('profileId')
  await ensureDevice(c.env.DB, profileId)
  const body = (await c.req.json()) as { timeZone?: string; regenerate?: boolean }
  const timeZone = body.timeZone?.trim() || 'UTC'
  if (!isValidTimeZone(timeZone)) return c.json({ error: 'Invalid timeZone' }, 400)
  const code = await getOrCreateShortcutCode(c.env.DB, profileId, timeZone, Boolean(body.regenerate))
  const origin = (c.env.PUBLIC_APP_ORIGIN ?? new URL(c.req.url).origin).replace(/\/$/, '')
  const base = (c.env.PUBLIC_APP_BASE ?? '').replace(/\/$/, '')
  return c.json({
    code,
    links: SHORTCUT_HABITS.map((habit) => ({ habit, url: `${origin}${base}/api/${habit}/${code}` })),
  })
})

api.route('/api/u/:username', profileApi)

/** Siri / Shortcuts "Get Contents of URL": marks the habit done for today in the profile's time zone. */
async function handleHabitShortcut(c: Context<{ Bindings: Env }>, habit: ShortcutHabit) {
  const db = c.env.DB
  const profile = await findProfileByShortcutCode(db, c.req.param('code') ?? '')
  if (!profile) return c.text('Unknown shortcut code. Copy a fresh link from Checkmark settings.', 404)

  await ensureDevice(db, profile.deviceId)
  const row = await db
    .prepare('SELECT goals_json, logs_json, app_settings_json FROM habits_bundle WHERE device_id = ?')
    .bind(profile.deviceId)
    .first<{ goals_json: string; logs_json: string; app_settings_json: string }>()
  const goals = parseHabitsGoalsStored(safeJsonParse<unknown>(row?.goals_json, {}), defaultHabitsGoals).current
  const logs = normalizeHabitsLogs(asLogsMap(safeJsonParse<unknown>(row?.logs_json, {})))
  const settings = safeJsonParse<{ firstDayOfWeek?: number }>(row?.app_settings_json, {})

  const today = localDateInTimeZone(profile.timeZone)
  const goal = asObjectRecord(goals[habit])
  const label = typeof goal.label === 'string' && goal.label ? goal.label : habit
  const result = applyHabitShortcut({
    habit,
    label,
    goal,
    today,
    logs,
    firstDayOfWeek: Number(settings.firstDayOfWeek) || 0,
  })

  if (result.changed) {
    logs[today] = result.day
    await db
      .prepare('UPDATE habits_bundle SET logs_json = ?, updated_at = ? WHERE device_id = ?')
      .bind(JSON.stringify(logs), Date.now(), profile.deviceId)
      .run()
  }

  return c.text(result.message, 200, { 'Cache-Control': 'no-store' })
}

for (const habit of SHORTCUT_HABITS) {
  api.on(['GET', 'POST'], `/api/${habit}/:code`, (c) => handleHabitShortcut(c, habit))
}

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

function optionalProfileId(raw: unknown): string | null {
  if (typeof raw !== 'string' || !raw.trim()) return null
  const id = normalizeUsername(raw)
  return isValidUsername(id) ? id : null
}

/** Personal food/brand spellings for transcription + parser; empty on any failure. */
async function vocabularyList(db: D1Database, profileId: string | null, max = 80): Promise<string[]> {
  if (!profileId) return []
  try {
    return (await loadPersonalVocabulary(db, profileId)).slice(0, max)
  } catch {
    return []
  }
}

/** OpenAI: audio transcription (webm/mp3/wav/m4a) */
api.post('/api/ai/transcribe', async (c) => {
  const key = c.env.OPENAI_API_KEY

  const formData = await c.req.formData()
  let upload = audioUploadFromFormData(formData)
  const contextRaw=formData.get('diaryEntry')
  const context=typeof contextRaw==='string'?JSON.parse(contextRaw) as {date:string;item:MacroDayItem}:null
  const profile=optionalProfileId(c.req.query('profile'))
  let input:Awaited<ReturnType<typeof readEntry>>=null
  let audioKey:string|undefined
  if(context && profile) {
    await ensureDevice(c.env.DB,profile)
    input=await ensureInputEntry(c.env.DB,profile,context.date,{...context.item,audioPending:true})
    audioKey=JSON.parse(input.payload_json).audioKey || `${profile}/voice/${context.item.id}`
    if(!c.env.SCAN_IMAGES) return c.json({error:'Recording storage is unavailable. Your recording remains on this device.'},503)
    if(upload) await c.env.SCAN_IMAGES.put(audioKey,upload.blob,{httpMetadata:{contentType:upload.blob.type}})
    else {
      const saved=await c.env.SCAN_IMAGES.get(audioKey)
      if(saved) upload={blob:new Blob([await saved.arrayBuffer()],{type:saved.httpMetadata?.contentType || 'audio/webm'}),filename:'recording.webm'}
    }
    const item={...JSON.parse(input.payload_json),audioKey,audioPending:true}
    const ack=await mutateEntry(c.env.DB,profile,{date:context.date,id:context.item.id,item,baseRevision:input.revision,ordinal:input.ordinal,mutationId:crypto.randomUUID(),supersedes:[]})
    if(ack.status!==200) return c.json(ack,ack.status)
    input=(await readEntry(c.env.DB,profile,context.date,context.item.id))!
  }
  if(!key) return c.json({error:'Transcription is unavailable. Your recording has been saved.'},503)
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
    const vocab = await vocabularyList(c.env.DB, optionalProfileId(c.req.query('profile')), 25)
    const promptWithVocab = [
      transcriptionPrompt,
      vocab.length ? `Foods and brands this person often logs: ${vocab.join(', ')}.` : '',
    ]
      .filter(Boolean)
      .join('\n\n')
    if (promptWithVocab) upstream.append('prompt', promptWithVocab)
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Invalid prompt key'
    return c.json({ error: msg }, 400)
  }

  const res = await trackedOpenAiFetch('https://api.openai.com/v1/audio/transcriptions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}` },
    body: upstream,
  })

  if (!res.ok) {
    const errText = await res.text()
    return c.json({ error: 'OpenAI transcription failed', detail: errText }, 502)
  }

  const data = (await res.json()) as { text?: string }
  if(context && profile && input) {
    const item={...JSON.parse(input.payload_json),name:'',audioKey,audioPending:false,status:'editing_raw',rawText:data.text || ''}
    const ack=await mutateEntry(c.env.DB,profile,{date:context.date,id:context.item.id,item,baseRevision:input.revision,ordinal:input.ordinal,mutationId:crypto.randomUUID(),supersedes:[]})
    if(ack.status!==200) return c.json(ack,ack.status)
    const meta=await c.env.DB.prepare('SELECT updated_at FROM macro_bundle WHERE device_id=?').bind(profile).first<{updated_at:number}>()
    return c.json({text:data.text || '',savedEntry:item,entryRevision:ack.revision,updatedAt:meta!.updated_at})
  }
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
    profile?: unknown
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
  const jsonSchema = body.promptKey ? schemaForPromptKey(body.promptKey) : null
  const isTextParser = body.promptKey === 'PARSER' && !(body.images?.length)
  const knownFoods = isTextParser ? await vocabularyList(c.env.DB, optionalProfileId(body.profile)) : []
  const parserUser = isTextParser
    ? `${rewriteSpokenFoodLog(body.user)}${
        knownFoods.length ? `\n\nKNOWN FOODS FOR THIS USER (spelling reference only — never add items from this list): ${knownFoods.join('; ')}` : ''
      }`
    : body.user
  const userText = jsonSchema ? parserUser : ensureJsonObjectUser(system ?? '', body.user)
  const content: unknown[] = [{ type: 'text', text: userText }]
  for (const img of body.images || []) {
    content.push({
      type: 'image_url',
      image_url: { url: `data:${img.mimeType};base64,${img.base64}` },
    })
  }

  try {
    if (body.promptKey === 'PARSER' && jsonSchema && !(body.images?.length)) {
      const parsed = await callOpenAiJsonWithRetry(key, system ?? '', parserUser, {
        model,
        schema: jsonSchema,
        validate: validateParserResponse,
        validationHint: (raw) => parserValidationErrors(raw).join('; '),
      })
      return c.json({ result: parsed })
    }

    const res = await trackedOpenAiFetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        ...(model.includes('gpt-5') ? {} : { temperature: 0.2 }),
        response_format: openAiResponseFormat(jsonSchema),
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
    const parsed = JSON.parse(raw) as unknown
    return c.json({ result: parsed })
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'OpenAI chat failed'
    if (msg.includes('invalid after')) {
      return c.json({ error: msg }, 502)
    }
    return c.json({ error: 'Model returned non-JSON', detail: msg }, 502)
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
  const jsonSchema = body.promptKey ? schemaForPromptKey(body.promptKey) : null
  const userText = jsonSchema ? body.user : ensureJsonObjectUser(system ?? '', body.user)
  const content: unknown[] = [{ type: 'text', text: userText }]
  for (const img of body.images || []) {
    content.push({
      type: 'image_url',
      image_url: { url: `data:${img.mimeType};base64,${img.base64}` },
    })
  }

  const res = await trackedOpenAiFetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      ...(model.includes('gpt-5') ? {} : { temperature: 0.2 }),
      response_format: openAiResponseFormat(jsonSchema),
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
    const body = (await c.req.json()) as Parameters<typeof runMacroEstimate>[1] & { profile?: unknown; diaryEntry?: {date:string;item:MacroDayItem} }
    const profile=optionalProfileId(body.profile)
    const context=body.diaryEntry
    let row: Awaited<ReturnType<typeof readEntry>>=null
    const token=crypto.randomUUID()
    if(context && profile) {
      await ensureDevice(c.env.DB,profile)
      row=await ensureInputEntry(c.env.DB,profile,context.date,context.item)
      await c.env.DB.prepare('UPDATE macro_entries SET processing_token=? WHERE device_id=? AND date_key=? AND entry_id=? AND revision=? AND deleted_at IS NULL')
        .bind(token,profile,context.date,context.item.id,row.revision).run()
    }
    try {
      const result = await runMacroEstimate(c.env, body, { profileId: profile })
      if(context && profile && row) {
        const savedEntry=applyEstimateResult(context.item,result,(body.customFoods ?? []) as MacroCustomFood[],Boolean(body.userDatabasePick),Boolean(body.skipFatSecretForAi))
        const writes=await c.env.DB.batch([
          c.env.DB.prepare(`UPDATE macro_entries SET payload_json=?,revision=revision+1,processing_token=NULL,updated_at=?
            WHERE device_id=? AND date_key=? AND entry_id=? AND revision=? AND processing_token=? AND deleted_at IS NULL RETURNING revision`)
            .bind(JSON.stringify(savedEntry),Date.now(),profile,context.date,context.item.id,row.revision,token),
          c.env.DB.prepare('UPDATE macro_bundle SET updated_at=MAX(updated_at+1,?) WHERE device_id=?').bind(Date.now(),profile),
        ])
        const ack=writes[0].results[0] as {revision:number}|undefined
        if(!ack) return c.json({error:'This food was changed or deleted during processing.'},409)
        const meta=await c.env.DB.prepare('SELECT updated_at FROM macro_bundle WHERE device_id=?').bind(profile).first<{updated_at:number}>()
        return c.json({...result,savedEntry,entryRevision:ack.revision,updatedAt:meta!.updated_at})
      }
      return c.json(result)
    } catch(error) {
      if(context && profile && row) {
        const current=await readEntry(c.env.DB,profile,context.date,context.item.id)
        if(current && current.deleted_at==null && current.processing_token===token && current.revision===row.revision) {
          const item={...JSON.parse(current.payload_json),status:'error',estimateError:error instanceof Error?error.message:'Food processing failed'}
          await mutateEntry(c.env.DB,profile,{date:context.date,id:context.item.id,item,baseRevision:current.revision,ordinal:current.ordinal,mutationId:`failed:${token}`,supersedes:[]})
        }
      }
      throw error
    }
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
  const body = (await c.req.json()) as { query?: string; userInput?: string }
  const query = rewriteFatSecretSearch(body.query?.trim() || '', body.userInput)
  if (!query) return c.json({ error: 'query required' }, 400)
  if (!c.env.FATSECRET_CLIENT_ID || !c.env.FATSECRET_CLIENT_SECRET) {
    return c.json({ error: 'FatSecret credentials missing' }, 500)
  }
  try {
    const foods = await fatSecretSearchFoods(c.env, query)
    return c.json({ foods, query })
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
      const routed = new Request(next.toString(), request)
      return withAiUsage(routed, env.DB, async () => api.fetch(routed, env, ctx))
    }
    return env.ASSETS.fetch(request)
  },
}
