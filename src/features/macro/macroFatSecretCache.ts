/**
 * V7 30-day FatSecret resolution cache (browser localStorage).
 *
 * Key strategy:
 * - Explicit (estimated=false): normalizedSearch + unitFamily
 *   → "green beans|mass" covers both 183 g and 5 oz.
 * - Estimated (estimated=true): normalizedSearch + unitFamily + originalPortion
 *   → "almonds|mass|handful" distinct from "almonds|mass|big scoop".
 */
import type { FatSecretFoodRef } from '../../types/domain'
import type { UnitFamily, V7ServingRelationship } from './macroAiSchemas'

const CACHE_KEY = 'checkmark-fatsecret-v9-cache'
const TTL_MS = 30 * 24 * 60 * 60 * 1000

export type FatSecretV7CacheEntry = {
  searchNormalized: string
  unitFamily: UnitFamily
  estimated: boolean
  originalPortion: string
  foods: FatSecretFoodRef[]
  /** 1-based indices into foods / servings at cache time. */
  selectedFoodIndex: number
  selectedServingIndex: number
  relationship: V7ServingRelationship
  estimateQuantity?: number | null
  estimateUnit?: string | null
  /** V8 AI #3 bridge */
  unitsPerServing?: number | null
  cachedAt: number
}

type CacheStore = Record<string, FatSecretV7CacheEntry>

export function normalizeFatSecretSearchKey(search: string): string {
  return search.trim().toLowerCase().replace(/\s+/g, ' ')
}

export function buildFatSecretCacheKey(input: {
  fatSecretSearch: string
  unitFamily: UnitFamily
  estimated: boolean
  originalPortion?: string
}): string {
  const search = normalizeFatSecretSearchKey(input.fatSecretSearch)
  const base = `${search}|${input.unitFamily}`
  if (input.estimated) {
    const portion = (input.originalPortion ?? '').trim().toLowerCase().replace(/\s+/g, ' ')
    return portion ? `${base}|${portion}` : `${base}|estimated`
  }
  return base
}

function readStore(): CacheStore {
  if (typeof localStorage === 'undefined') return {}
  try {
    const raw = localStorage.getItem(CACHE_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw) as CacheStore
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

function writeStore(store: CacheStore): void {
  if (typeof localStorage === 'undefined') return
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(store))
  } catch {
    /* quota / private mode */
  }
}

function pruneExpired(store: CacheStore): CacheStore {
  const now = Date.now()
  const next: CacheStore = {}
  for (const [k, v] of Object.entries(store)) {
    if (v && typeof v.cachedAt === 'number' && now - v.cachedAt < TTL_MS) {
      next[k] = v
    }
  }
  return next
}

export function getFatSecretV7Cache(input: {
  fatSecretSearch: string
  unitFamily: UnitFamily
  estimated: boolean
  originalPortion?: string
}): FatSecretV7CacheEntry | null {
  const key = buildFatSecretCacheKey(input)
  const store = pruneExpired(readStore())
  writeStore(store)
  const entry = store[key]
  if (!entry) return null
  if (!entry.foods?.length) return null
  if (entry.selectedFoodIndex < 1 || entry.selectedFoodIndex > entry.foods.length) return null
  return entry
}

export function setFatSecretV7Cache(entry: Omit<FatSecretV7CacheEntry, 'cachedAt' | 'searchNormalized'> & {
  fatSecretSearch: string
}): void {
  const searchNormalized = normalizeFatSecretSearchKey(entry.fatSecretSearch)
  const key = buildFatSecretCacheKey({
    fatSecretSearch: entry.fatSecretSearch,
    unitFamily: entry.unitFamily,
    estimated: entry.estimated,
    originalPortion: entry.originalPortion,
  })
  const store = pruneExpired(readStore())
  store[key] = {
    searchNormalized,
    unitFamily: entry.unitFamily,
    estimated: entry.estimated,
    originalPortion: entry.originalPortion,
    foods: entry.foods,
    selectedFoodIndex: entry.selectedFoodIndex,
    selectedServingIndex: entry.selectedServingIndex,
    relationship: entry.relationship,
    estimateQuantity: entry.estimateQuantity ?? null,
    estimateUnit: entry.estimateUnit ?? null,
    unitsPerServing: entry.unitsPerServing ?? null,
    cachedAt: Date.now(),
  }
  writeStore(store)
}

export function clearFatSecretV7Cache(): void {
  if (typeof localStorage === 'undefined') return
  localStorage.removeItem(CACHE_KEY)
}
