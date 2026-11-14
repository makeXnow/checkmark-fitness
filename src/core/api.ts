import { entryChanges, type EntryMutation, type EntryVersions } from '../lib/macroEntryChanges'
import { withRequestTimeout } from '../lib/requestTimeout'
import { MACRO_PROMPTS_OWNER, type MacroPromptKey, type MacroPrompts } from '../features/macro/prompts'
import type {
  AppStateRow,
  BootstrapResponse,
  FatSecretFoodRef,
  MacroEstimateSnapshot,
  MacroParseSnapshot,
  MacroDayItem,
} from '../types/domain'
import { apiFetch, apiFetchForProfile } from './apiPaths'
import { getApiProfile } from './apiProfile'

export class ApiError extends Error {
  constructor(message: string, public status: number) { super(message); this.name = 'ApiError' }
}

function htmlResponseHint(text: string): string | undefined {
  const t = text.trimStart()
  if (!t.startsWith('<!') && !t.startsWith('<html')) return undefined
  return ' Got HTML instead of JSON — deploy with `npm run deploy` (Worker + assets), not static-only.'
}

async function parseJson<T>(res: Response): Promise<T> {
  const text = await res.text()
  if (!res.ok) {
    let msg = text.trim().slice(0, 600) || res.statusText
    try {
      const j = JSON.parse(text) as { error?: string; hint?: string; detail?: string }
      if (j?.error) {
        let detail = j.detail?.trim()
        if (detail) {
          try {
            const inner = JSON.parse(detail) as { error?: { message?: string } }
            if (inner?.error?.message) detail = inner.error.message
          } catch {
            /* use raw detail */
          }
        }
        msg = [j.error, detail, j.hint].filter(Boolean).join(' — ')
      }
    } catch {
      const htmlHint = htmlResponseHint(text)
      if (htmlHint) msg = (msg || 'Invalid response') + htmlHint
    }
    throw new ApiError(msg, res.status)
  }
  if (!text) return {} as T
  try {
    return JSON.parse(text) as T
  } catch {
    const htmlHint = htmlResponseHint(text)
    throw new Error(
      htmlHint
        ? `Unexpected token '<' — API returned the app page, not JSON.${htmlHint}`
        : 'Invalid JSON in API response',
    )
  }
}

export async function checkProfileExists(profile: string): Promise<boolean> {
  const res = await apiFetchForProfile(profile, '/exists')
  const data = await parseJson<{ exists?: boolean }>(res)
  return Boolean(data.exists)
}

export const confirmedMacroLogs = new Map<string, { updatedAt: number; logs: Record<string, MacroDayItem[]>; entryRevisions: EntryVersions; metadataRevision?:number }>()

export const MACRO_SAVE_TIMEOUT_MS = 30_000

export async function fetchBootstrap(): Promise<BootstrapResponse> {
  return withRequestTimeout(async (signal) => {
    const profile = getApiProfile() ?? ''
    const res = await apiFetch('/api/bootstrap', { cache: 'no-store', signal })
    const data = await parseJson<BootstrapResponse>(res)
    if (signal.aborted) throw new DOMException('Request cancelled', 'AbortError')
    confirmedMacroLogs.set(profile, { updatedAt: data.macro.updatedAt, logs: structuredClone(data.macro.logs), entryRevisions: data.macro.entryRevisions ?? {},metadataRevision:data.macro.metadataRevision })
    return data
  }, MACRO_SAVE_TIMEOUT_MS, 'Connecting to your diary timed out.')
}

export type AppStatePatch = Partial<
  Omit<AppStateRow, 'settings_open'> & {
    settings_open?: boolean | number
  }
>

/** Merge navigation patch into local app state (instant UI; persist with patchAppState in background). */
export function applyAppStatePatch(current: AppStateRow, patch: AppStatePatch): AppStateRow {
  const next: AppStateRow = { ...current, updated_at: Date.now() }
  if (patch.selected_tab !== undefined) next.selected_tab = patch.selected_tab
  if (patch.settings_open !== undefined) next.settings_open = patch.settings_open ? 1 : 0
  if (patch.settings_section !== undefined) next.settings_section = patch.settings_section
  if (patch.lift_sub_route !== undefined) next.lift_sub_route = patch.lift_sub_route
  if (patch.lift_selected_day_id !== undefined) next.lift_selected_day_id = patch.lift_selected_day_id
  if (patch.lift_current_day_index !== undefined) {
    next.lift_current_day_index = Number(patch.lift_current_day_index)
  }
  if (patch.selected_date !== undefined) next.selected_date = patch.selected_date
  return next
}

export async function patchAppState(patch: AppStatePatch): Promise<{ ok: boolean; appState: AppStateRow }> {
  const body: Record<string, unknown> = {}
  const keys = [
    'selected_tab',
    'settings_open',
    'settings_section',
    'lift_sub_route',
    'lift_selected_day_id',
    'lift_current_day_index',
    'selected_date',
  ] as const
  for (const k of keys) {
    if (k in patch && patch[k as keyof typeof patch] !== undefined) {
      const v = patch[k as keyof typeof patch]
      body[k] =
        k === 'settings_open'
          ? Boolean(v)
          : k === 'lift_current_day_index'
            ? Number(v)
            : v
    }
  }
  const res = await apiFetch('/api/app-state', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  return parseJson(res)
}

export async function putHabits(data: {
  goals: unknown
  goalsSnapshotsByWeek?: unknown
  goalsHistory?: unknown
  logs: unknown
  appSettings: unknown
}): Promise<void> {
  const res = await apiFetch('/api/habits', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  })
  if (!res.ok) throw new Error(await res.text())
}

export async function putMacro(data: {
  baseUpdatedAt: number
  goals: unknown
  goalsSnapshotsByDay?: unknown
  goalsHistory?: unknown
  customFoods: unknown
  logs: Record<string, MacroDayItem[]>
  entryMutations?: EntryMutation[]
}): Promise<{ ok: boolean; updatedAt: number }> {
  const profile = getApiProfile() ?? ''
  let known = confirmedMacroLogs.get(profile)
  const operations = data.entryMutations ?? entryChanges(known?.logs ?? {},data.logs,known?.entryRevisions ?? {})
  let revision = data.baseUpdatedAt
  for (const operation of operations) {
    const saved = await withRequestTimeout(async signal => {
      const response = await apiFetch(`/api/macro/entries/${encodeURIComponent(operation.date)}/${encodeURIComponent(operation.id)}`, {
        method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(operation),signal,
      })
      return parseJson<{revision:number;updatedAt:number;item:MacroDayItem|null}>(response)
    }, MACRO_SAVE_TIMEOUT_MS,'Saving timed out. Your unsaved food is still on this device.')
    revision = saved.updatedAt
    known = confirmedMacroLogs.get(profile) ?? {updatedAt:revision,logs:{},entryRevisions:{}}
    const day = known.logs[operation.date] ?? []
    const canonical=saved.item
    const items = canonical === null ? day.filter(i=>i.id!==operation.id)
      : day.some(i=>i.id===operation.id) ? day.map(i=>i.id===operation.id ? canonical : i) : [...day,canonical]
    confirmedMacroLogs.set(profile,{updatedAt:revision,logs:{...known.logs,[operation.date]:structuredClone(items)},
      entryRevisions:{...known.entryRevisions,[operation.date]:{...known.entryRevisions[operation.date],[operation.id]:saved.revision}},metadataRevision:known.metadataRevision})
  }
  return withRequestTimeout(async signal => {
    const response = await apiFetch('/api/macro', {
      method:'PUT',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({...data,entryMutations:undefined,logs:{},baseUpdatedAt:revision,baseMetadataRevision:confirmedMacroLogs.get(profile)?.metadataRevision}),signal,
    })
    const saved = await parseJson<{ok:boolean;updatedAt:number;metadataRevision?:number}>(response)
    if (signal.aborted) throw new DOMException('Request cancelled','AbortError')
    const latest = confirmedMacroLogs.get(profile)
    if(latest) confirmedMacroLogs.set(profile,{...latest,updatedAt:saved.updatedAt,metadataRevision:saved.metadataRevision})
    return saved
  },MACRO_SAVE_TIMEOUT_MS,'Saving timed out. Your unsaved food is still on this device.')
}

export async function putLift(payload: unknown): Promise<void> {
  const res = await apiFetch('/api/lift', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  if (!res.ok) throw new Error(await res.text())
}

export async function openLiftSession(body: { dayId: string; localDate: string }): Promise<void> {
  const res = await apiFetch('/api/lift/session/open', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new Error(await res.text())
}

export async function closeLiftSession(body: { dayId: string; localDate: string }): Promise<void> {
  const res = await apiFetch('/api/lift/session/close', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new Error(await res.text())
}

export async function dismissLiftAssumption(body: { dayId: string; localDate: string }): Promise<void> {
  const res = await apiFetch('/api/lift/assumption/dismiss', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new Error(await res.text())
}

export async function clearLiftAssumption(body: { dayId: string; localDate: string }): Promise<void> {
  const res = await apiFetch('/api/lift/assumption/clear', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new Error(await res.text())
}

export type HabitShortcutLinks = {
  code: string
  links: { habit: 'cardio' | 'lift' | 'diet' | 'water'; url: string }[]
}

export async function fetchHabitShortcutLinks(regenerate = false): Promise<HabitShortcutLinks> {
  const res = await apiFetch('/api/shortcut-code', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone, regenerate }),
  })
  return parseJson<HabitShortcutLinks>(res)
}

export async function fetchMacroPrompts(): Promise<MacroPrompts> {
  const res = await apiFetch('/api/macro/prompts')
  const data = await parseJson<{ prompts?: MacroPrompts; error?: string }>(res)
  if (!data.prompts) throw new Error(data.error || 'Failed to load prompts')
  return data.prompts
}

export async function saveMacroPrompts(prompts: Partial<MacroPrompts>): Promise<MacroPrompts> {
  const res = await apiFetchForProfile(MACRO_PROMPTS_OWNER, '/macro/prompts', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(prompts),
  })
  const data = await parseJson<{ prompts?: MacroPrompts; error?: string }>(res)
  if (!data.prompts) throw new Error(data.error || 'Failed to save prompts')
  return data.prompts
}

export async function transcribeAudio(
  file: File | undefined,
  options?: { model?: string; promptKey?: MacroPromptKey; diaryEntry?: {date:string;item:MacroDayItem}; signal?:AbortSignal },
): Promise<string> {
  const fd = new FormData()
  if(file) fd.append('file', file)
  if(options?.diaryEntry) fd.append('diaryEntry',JSON.stringify(options.diaryEntry))
  const params = new URLSearchParams()
  if (options?.model) params.set('model', options.model)
  if (options?.promptKey) params.set('promptKey', options.promptKey)
  else params.set('promptKey', 'TRANSCRIPTION')
  const profile = getApiProfile()
  if (profile) params.set('profile', profile)
  const q = params.toString() ? `?${params}` : ''
  return withRequestTimeout(async signal=>{
  const res = await apiFetch(`/api/ai/transcribe${q}`, { method: 'POST', body: fd,signal })
  const data = await parseJson<{ text?: string; error?: string; savedEntry?:MacroDayItem;entryRevision?:number;updatedAt?:number }>(res)
  if (data.error) throw new Error(data.error)
  if(options?.diaryEntry && data.savedEntry && data.entryRevision && data.updatedAt) rememberServerEntries(options.diaryEntry.date,[data.savedEntry],{[options.diaryEntry.date]:{[data.savedEntry.id]:data.entryRevision}},data.updatedAt)
  const text = (data.text ?? '').trim()
  if (!text) throw new Error('No speech detected — try speaking longer or check your mic.')
  return text
  },MACRO_ESTIMATE_TIMEOUT_MS,'Transcription timed out. Your recording is saved; retry it.',options?.signal)
}

/** Live worker still uses `json_object`, which requires the word "json" in messages. */
function withJsonHint(user: string): string {
  return /\bjson\b/i.test(user) ? user : `${user}\n\nRespond with JSON.`
}

export async function aiJson(body: {
  model?: string
  system?: string
  promptKey?: MacroPromptKey
  user: string
  images?: { mimeType: string; base64: string }[]
}, signal?: AbortSignal): Promise<unknown> {
  return withRequestTimeout(async (requestSignal) => {
    const res = await apiFetch('/api/ai/json', {
      signal: requestSignal,
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...body, user: withJsonHint(body.user), profile: getApiProfile() ?? undefined }),
    })
    const data = await parseJson<{ result?: unknown; error?: string }>(res)
    if (data.result === undefined) throw new Error(data.error || 'AI failed')
    return data.result
  }, MACRO_ESTIMATE_TIMEOUT_MS, 'Food parsing timed out — edit the entry or try again.', signal)
}

export async function fatSecretSearch(query: string): Promise<{ foods: FatSecretFoodRef[] }> {
  const res = await apiFetch('/api/fatsecret/search', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query }),
  })
  const data = await parseJson<{ foods?: FatSecretFoodRef[]; error?: string }>(res)
  if (data.error) throw new Error(data.error)
  return { foods: data.foods ?? [] }
}

export async function fatSecretBarcodeLookup(
  barcode: string,
  region = 'US',
): Promise<{ food: FatSecretFoodRef; name?: string; emoji?: string }> {
  const res = await apiFetch('/api/fatsecret/barcode', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ barcode, region }),
  })
  const data = await parseJson<{ food?: FatSecretFoodRef; name?: string; emoji?: string; error?: string }>(res)
  if (data.error || !data.food) throw new Error(data.error || 'Product not found')
  return { food: data.food, name: data.name, emoji: data.emoji }
}

export async function persistDiaryEntry(date:string,item:MacroDayItem):Promise<void> {
  const profile=getApiProfile() ?? ''
  const known=confirmedMacroLogs.get(profile)
  const op:EntryMutation={date,id:item.id,item,baseRevision:known?.entryRevisions[date]?.[item.id] ?? 0,ordinal:item.timestamp ?? Date.now(),mutationId:crypto.randomUUID(),supersedes:[]}
  const saved=await withRequestTimeout(async signal=>{
    const response=await apiFetch(`/api/macro/entries/${encodeURIComponent(date)}/${encodeURIComponent(item.id)}`,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(op),signal})
    return parseJson<{revision:number;updatedAt:number;item:MacroDayItem|null}>(response)
  },MACRO_SAVE_TIMEOUT_MS,'Saving this food timed out. It is still on this device.')
  if(saved.item) rememberServerEntries(date,[saved.item],{[date]:{[item.id]:saved.revision}},saved.updatedAt)
}
function rememberServerEntries(date:string,items:MacroDayItem[],versions:EntryVersions,updatedAt:number,removedId?:string) {
  const profile=getApiProfile() ?? ''
  const known=confirmedMacroLogs.get(profile) ?? {updatedAt,logs:{},entryRevisions:{}}
  const ids=new Set(items.map(i=>i.id))
  const day=(known.logs[date] ?? []).filter(i=>i.id!==removedId && !ids.has(i.id))
  confirmedMacroLogs.set(profile,{updatedAt,logs:{...known.logs,[date]:[...day,...structuredClone(items)]},
    entryRevisions:{...known.entryRevisions,[date]:{...known.entryRevisions[date],...versions[date]}},metadataRevision:known.metadataRevision})
}
export async function parseDiaryInput(date:string,item:MacroDayItem,rawText:string,userEditedText:boolean,signal?:AbortSignal):Promise<MacroDayItem[]> {
  return withRequestTimeout(async requestSignal=>{
    const response=await apiFetch('/api/macro/parse',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({date,item,rawText,userEditedText}),signal:requestSignal})
    const data=await parseJson<{items:MacroDayItem[];entryRevisions:EntryVersions;updatedAt:number}>(response)
    if(requestSignal.aborted) throw new DOMException('Request cancelled','AbortError')
    rememberServerEntries(date,data.items,data.entryRevisions,data.updatedAt,item.id)
    return data.items
  },MACRO_ESTIMATE_TIMEOUT_MS,'Food processing timed out. Your description is saved; retry this entry.',signal)
}

export type MacroEstimateApiResult = {
  savedEntry?: MacroDayItem
  entryRevision?: number
  updatedAt?: number
  calories?: number
  protein?: number
  libraryFoodId?: string
  servingType?: string
  servingSize?: number
  servingUnit?: string
  servingMultiplier?: number
  baseCalories?: number
  baseProtein?: number
  fatSecretResults: FatSecretFoodRef[]
  fatSecretSource: 'cache' | 'search' | 'none'
  macroEstimateSnapshot?: MacroEstimateSnapshot
}

export class MacroEstimateError extends Error {
  fatSecretResults?: FatSecretFoodRef[]
  fatSecretSource?: MacroEstimateApiResult['fatSecretSource']
}

/** Client ceiling so a hung Worker/OpenAI call cannot spin the diary forever. Normal path is ~30s. */
export const MACRO_ESTIMATE_TIMEOUT_MS = 90_000

function isAbortOrTimeoutError(e: unknown): boolean {
  if (!(e instanceof Error)) return false
  return e.name === 'AbortError' || e.name === 'TimeoutError' || /aborted|timed?\s*out/i.test(e.message)
}

export async function macroEstimateItem(body: {
  diaryEntry?: {date:string;item:MacroDayItem}
  name: string
  amount: string
  notes?: string
  fatSecretSearch?: string
  fatSecretResults?: FatSecretFoodRef[]
  aiFatSecretResults?: FatSecretFoodRef[]
  fatSecretSelectedIndex?: number
  skipFatSecretForAi?: boolean
  userDatabasePick?: boolean
  parseSnapshot?: MacroParseSnapshot
  userInput?: string
  skipFatSecretFetch?: boolean
  customFoods?: { id: string; name: string; emoji?: string; baseAmount?: string; calories: number; protein: number }[]
  extraCtx?: string
  v7CachedResolution?: {
    fatSecretIndex: number
    servingIndex: number
    relationship: import('../features/macro/macroAiSchemas').V7ServingRelationship
    estimateQuantity?: number | null
    estimateUnit?: string | null
  }
}, parentSignal?: AbortSignal): Promise<MacroEstimateApiResult> {
  return withRequestTimeout(async (signal) => {
    let res: Response
    try {
      res = await apiFetch('/api/macro/estimate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...body,
          extraCtx: withJsonHint(body.extraCtx ?? ''),
          profile: getApiProfile() ?? undefined,
        }),
        signal,
      })
    } catch (e) {
      if (isAbortOrTimeoutError(e)) {
        throw new MacroEstimateError(
          `Macro estimate timed out after ${Math.round(MACRO_ESTIMATE_TIMEOUT_MS / 1000)}s — tap Retry to try again.`,
        )
      }
      throw e
    }
    const text = await res.text()
    let data: MacroEstimateApiResult & { error?: string }
    try {
      data = JSON.parse(text) as MacroEstimateApiResult & { error?: string }
    } catch {
      throw new Error(res.ok ? 'Invalid JSON in API response' : text.trim().slice(0, 600) || res.statusText)
    }
    if (!res.ok || data.error) {
      const err = new MacroEstimateError(data.error || res.statusText)
      if (data.fatSecretResults?.length) {
        err.fatSecretResults = data.fatSecretResults
        err.fatSecretSource = data.fatSecretSource
      }
      throw err
    }
    if(body.diaryEntry && data.savedEntry && data.entryRevision && data.updatedAt) {
      rememberServerEntries(body.diaryEntry.date,[data.savedEntry],{[body.diaryEntry.date]:{[data.savedEntry.id]:data.entryRevision}},data.updatedAt)
    }
    return data
  }, MACRO_ESTIMATE_TIMEOUT_MS, 'Macro estimate timed out — tap Retry to try again.', parentSignal)
}

/** Nutrition / label photos → structured JSON (uses vision-capable model). */
export async function aiVisionJson(body: {
  system?: string
  promptKey?: MacroPromptKey
  user: string
  images: { mimeType: string; base64: string }[]
  model?: string
}): Promise<unknown> {
  const res = await apiFetch('/api/ai/vision', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...body, user: withJsonHint(body.user) }),
  })
  const data = await parseJson<{ result?: unknown; error?: string }>(res)
  if (data.result === undefined) throw new Error(data.error || 'Vision AI failed')
  return data.result
}

export async function readSavedScanImage(key:string):Promise<string> {
  return withRequestTimeout(async signal=>{
    const response=await apiFetch(`/api/macro/scan-images/${key.split('/').map(encodeURIComponent).join('/')}`,{signal})
    if(!response.ok)throw new Error('Saved photo could not be loaded. Reconnect and retry.')
    const blob=await response.blob()
    return new Promise<string>((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result));reader.onerror=()=>reject(reader.error);reader.readAsDataURL(blob)})
  },MACRO_SAVE_TIMEOUT_MS,'Loading the saved photo timed out.')
}
export async function uploadPackagingScanImages(body: {
  itemId: string
  front: { mimeType: string; base64: string }
  nutrition: { mimeType: string; base64: string }
}): Promise<{ frontKey: string; nutritionKey: string }> {
  const res = await apiFetch('/api/macro/scan-images', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const data = await parseJson<{ frontKey?: string; nutritionKey?: string; error?: string }>(res)
  if (!data.frontKey || !data.nutritionKey) throw new Error(data.error || 'Scan image upload failed')
  return { frontKey: data.frontKey, nutritionKey: data.nutritionKey }
}

export async function packagingRetest(body: {
  frontKey: string
  nutritionKey: string
  amountText?: string
  runs?: number
}): Promise<{ runs: number; results: unknown[] }> {
  const res = await apiFetch('/api/macro/packaging-retest', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  return parseJson(res)
}
