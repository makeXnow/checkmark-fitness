import { MACRO_PROMPTS_OWNER, type MacroPromptKey, type MacroPrompts } from '../features/macro/prompts'
import type {
  AppStateRow,
  BootstrapResponse,
  FatSecretFoodRef,
  MacroEstimateSnapshot,
  MacroParseSnapshot,
} from '../types/domain'
import { apiFetch, apiFetchForProfile } from './apiPaths'

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
    throw new Error(msg)
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

export async function fetchBootstrap(): Promise<BootstrapResponse> {
  const res = await apiFetch('/api/bootstrap')
  return parseJson<BootstrapResponse>(res)
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
  goals: unknown
  goalsSnapshotsByDay?: unknown
  goalsHistory?: unknown
  customFoods: unknown
  logs: unknown
}): Promise<void> {
  const res = await apiFetch('/api/macro', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  })
  if (!res.ok) throw new Error(await res.text())
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
  file: File,
  options?: { model?: string; promptKey?: MacroPromptKey },
): Promise<string> {
  const fd = new FormData()
  fd.append('file', file)
  const params = new URLSearchParams()
  if (options?.model) params.set('model', options.model)
  if (options?.promptKey) params.set('promptKey', options.promptKey)
  else params.set('promptKey', 'TRANSCRIPTION')
  const q = params.toString() ? `?${params}` : ''
  const res = await apiFetch(`/api/ai/transcribe${q}`, { method: 'POST', body: fd })
  const data = await parseJson<{ text?: string; error?: string }>(res)
  if (data.error) throw new Error(data.error)
  const text = (data.text ?? '').trim()
  if (!text) throw new Error('No speech detected — try speaking longer or check your mic.')
  return text
}

export async function aiJson(body: {
  model?: string
  system?: string
  promptKey?: MacroPromptKey
  user: string
  images?: { mimeType: string; base64: string }[]
}): Promise<unknown> {
  const res = await apiFetch('/api/ai/json', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const data = await parseJson<{ result?: unknown; error?: string }>(res)
  if (data.result === undefined) throw new Error(data.error || 'AI failed')
  return data.result
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

export type MacroEstimateApiResult = {
  calories: number
  protein: number
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

export async function macroEstimateItem(body: {
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
}): Promise<MacroEstimateApiResult> {
  const res = await apiFetch('/api/macro/estimate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
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
  return data
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
    body: JSON.stringify(body),
  })
  const data = await parseJson<{ result?: unknown; error?: string }>(res)
  if (data.result === undefined) throw new Error(data.error || 'Vision AI failed')
  return data.result
}
