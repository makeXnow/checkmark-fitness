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
    const payload: CachedBootstrap = { v: CACHE_VERSION, savedAt: Date.now(), data }
    localStorage.setItem(cacheKey(profile), JSON.stringify(payload))
  } catch {
    /* quota or private mode */
  }
}
