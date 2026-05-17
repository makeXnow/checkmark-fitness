import type { AppStateRow, BootstrapResponse } from '../types/domain'
import { apiFetch } from './apiPaths'

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

export async function fetchBootstrap(): Promise<BootstrapResponse> {
  const res = await apiFetch('/api/bootstrap')
  return parseJson<BootstrapResponse>(res)
}

export async function patchAppState(
  patch: Partial<
    Omit<AppStateRow, 'settings_open'> & {
      settings_open?: boolean | number
    }
  >,
): Promise<{ ok: boolean; appState: AppStateRow }> {
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

export async function transcribeAudio(file: File, model?: string): Promise<string> {
  const fd = new FormData()
  fd.append('file', file)
  const q = model ? `?model=${encodeURIComponent(model)}` : ''
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

/** Nutrition / label photos → structured JSON (uses vision-capable model). */
export async function aiVisionJson(body: {
  system?: string
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
