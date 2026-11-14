import type { PendingMacro } from './macroRecovery'
import type { BootstrapResponse } from '../types/domain'

const CACHE_VERSION = 1
const KEY_PREFIX = 'checkmark-bootstrap'

type CachedBootstrap = {
  v: number
  savedAt: number
  data: BootstrapResponse
}

function cacheKey(profile: string): string {
  return `${KEY_PREFIX}:${profile}`
}

export function readBootstrapCache(profile: string): BootstrapResponse | null {
  if (typeof localStorage === 'undefined') return null
  try {
    const raw = localStorage.getItem(cacheKey(profile))
    if (!raw) return null
    const parsed = JSON.parse(raw) as CachedBootstrap
    if (parsed.v !== CACHE_VERSION || !parsed.data?.appState) return null
    return parsed.data
  } catch {
    return null
  }
}

export function writeBootstrapCache(profile: string, data: BootstrapResponse): void {
  if (typeof localStorage === 'undefined') return
  try {
    const payload: CachedBootstrap = { v: CACHE_VERSION, savedAt: Date.now(), data: { ...data, macro: compactMacroCache(data.macro) } }
    localStorage.setItem(cacheKey(profile), JSON.stringify(payload))
  } catch {
    /* quota or private mode */
  }
}

/** Keep failed/unsent edits separate from the display cache so a refresh cannot erase them. */
export function writeMacroRecoveryCache(profile: string, macro: BootstrapResponse['macro']): void {
  if (typeof localStorage === 'undefined') return
  try {
    const key = `${KEY_PREFIX}:macro-recovery:${profile}`
    const previous = JSON.parse(localStorage.getItem(key) || '[]')
    const copies = Array.isArray(previous) ? previous.slice(-4) : []
    localStorage.setItem(key, JSON.stringify([...copies, { savedAt: Date.now(), macro: compactMacroCache(macro) }]))
  } catch {
    /* storage unavailable */
  }
}

/** Local emergency copies need food names, portions and totals, not large lookup traces. */
export function compactMacroCache(macro: BootstrapResponse['macro']): BootstrapResponse['macro'] {
  return {
    ...macro,
    logs: Object.fromEntries(Object.entries(macro.logs).map(([day, items]) => [day, items.map(item => {
      const { fatSecretResults: _candidates, macroEstimateSnapshot: estimate, ...food } = item
      const snapshot = estimate ? Object.fromEntries(Object.entries(estimate).filter(([key]) =>
        !/Json$/.test(key) && key !== 'candidateAnnotationsJson',
      )) : undefined
      return { ...food, ...(snapshot ? { macroEstimateSnapshot: snapshot } : {}) }
    })])),
  }
}

export function writePendingMacroCache(profile: string, pending: PendingMacro | null): boolean {
  if (typeof localStorage === 'undefined') return false
  const key = `${KEY_PREFIX}:pending:${profile}`
  try {
    if (pending) localStorage.setItem(key, JSON.stringify({ ...pending, macro: compactMacroCache(pending.macro) }))
    else localStorage.removeItem(key)
    return true
  } catch {
    return false
  }
}

export function readPendingMacroCache(profile: string): PendingMacro | null {
  if (typeof localStorage === 'undefined') return null
  try {
    const value = JSON.parse(localStorage.getItem(`${KEY_PREFIX}:pending:${profile}`) || 'null') as PendingMacro | null
    return value?.macro?.logs && Array.isArray(value.changedDays) ? value : null
  } catch {
    return null
  }
}

/** Offer old emergency copies for review, adding only named foods absent from the server. */
export function readLegacyFoodRecovery(profile: string, current: BootstrapResponse['macro'], day: string): PendingMacro | null {
  if (typeof localStorage === 'undefined') return null
  try {
    const copies = JSON.parse(localStorage.getItem(`${KEY_PREFIX}:macro-recovery:${profile}`) || '[]') as { macro: BootstrapResponse['macro'];savedAt?:number }[]
    const present = new Set((current.logs[day] ?? []).map(item => item.id))
    const extra = new Map<string, BootstrapResponse['macro']['logs'][string][number]>()
    for (const copy of copies) {
      if(copy.macro?.updatedAt!==current.updatedAt)continue
      for (const item of copy.macro?.logs?.[day] ?? []) {
        if (item.name?.trim() && !present.has(item.id)) extra.set(item.id, item)
      }
    }
    if (!extra.size) return null
    return { changedDays: [day], macro: { ...current, logs: { ...current.logs, [day]: [...(current.logs[day] ?? []), ...extra.values()] } } }
  } catch {
    return null
  }
}
