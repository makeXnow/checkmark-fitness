import type { FatSecretFoodRef } from './fatsecret'

/**
 * Personal food memory: products this profile verified before (barcode scans and
 * database matches the user picked by hand). Re-offered as pinned candidates so a
 * spoken "Walmart canned chicken" lands on the exact product they scanned.
 */
export type PersonalMemoryEntry = {
  food: FatSecretFoodRef
  source: 'barcode' | 'confirmed'
  diaryName: string
  lastAmount: string
  lastUserInput: string
  lastCalories: number
  lastDate: string
  tokens: Set<string>
}

type StoredItem = {
  name?: string
  amount?: string
  calories?: number
  status?: string
  userInput?: string
  rawText?: string
  fatSecretSearch?: string
  fromBarcode?: boolean
  userConfirmedMatch?: boolean
  userEditedName?: boolean
  fatSecretResults?: FatSecretFoodRef[]
  macroEstimateSnapshot?: { fatSecretIndex?: number | null }
}

const STOPWORDS = new Set([
  'the', 'and', 'with', 'had', 'have', 'ate', 'some', 'about', 'like', 'just', 'one', 'two', 'three',
  'half', 'cup', 'cups', 'tbsp', 'tsp', 'gram', 'grams', 'ounce', 'ounces', 'pound', 'serving',
  'servings', 'piece', 'pieces', 'small', 'large', 'medium', 'big', 'little', 'from', 'for', 'that',
  'this', 'was', 'were', 'whole', 'full', 'plus', 'per', 'brand',
])

export function memoryTokens(...parts: (string | undefined | null)[]): Set<string> {
  const out = new Set<string>()
  for (const p of parts) {
    if (!p) continue
    for (const raw of p.toLowerCase().replace(/[’']/g, '').split(/[^a-z0-9]+/)) {
      if (raw.length < 3 || STOPWORDS.has(raw) || /^\d+$/.test(raw)) continue
      out.add(raw.endsWith('s') && raw.length > 4 ? raw.slice(0, -1) : raw)
    }
  }
  return out
}

function chosenFood(item: StoredItem): FatSecretFoodRef | null {
  const foods = item.fatSecretResults ?? []
  if (item.fromBarcode) return foods[0] ?? null
  const idx = item.macroEstimateSnapshot?.fatSecretIndex
  if (typeof idx === 'number' && idx >= 1 && idx <= foods.length) return foods[idx - 1]!
  return null
}

export function buildPersonalMemory(logs: Record<string, StoredItem[]>): PersonalMemoryEntry[] {
  const byFood = new Map<string, PersonalMemoryEntry>()
  const dates = Object.keys(logs).sort()
  for (const date of dates) {
    for (const item of logs[date] ?? []) {
      if (!item.fromBarcode && !item.userConfirmedMatch) continue
      if (item.status === 'error' || !((item.calories ?? 0) > 0)) continue
      const food = chosenFood(item)
      if (!food?.servings?.length) continue
      const entry: PersonalMemoryEntry = {
        food,
        source: item.fromBarcode ? 'barcode' : 'confirmed',
        diaryName: item.name?.trim() || food.name,
        lastAmount: item.amount?.trim() || '',
        lastUserInput: (item.userInput || item.rawText || '').trim().slice(0, 160),
        lastCalories: Math.round(item.calories ?? 0),
        lastDate: date,
        tokens: memoryTokens(item.name, food.name, food.brandName, item.fatSecretSearch),
      }
      // Later dates overwrite earlier — most recent usage wins.
      byFood.set(food.foodId, entry)
    }
  }
  return [...byFood.values()]
}

/** Entries that plausibly describe the same product as the current item (max 3). */
export function matchPersonalMemory(
  entries: PersonalMemoryEntry[],
  current: { name: string; fatSecretSearch?: string },
): PersonalMemoryEntry[] {
  const cur = memoryTokens(current.name, current.fatSecretSearch)
  if (cur.size === 0) return []
  const scored: { e: PersonalMemoryEntry; overlap: number }[] = []
  for (const e of entries) {
    let overlap = 0
    for (const t of cur) if (e.tokens.has(t)) overlap++
    // The user's own name for the product ("Canned Chicken") must be fully present, so
    // "grilled chicken breast" does not pull in a canned chicken breast scan.
    const diary = memoryTokens(e.diaryName)
    const diaryCovered = diary.size > 0 && [...diary].every((t) => cur.has(t))
    if (diaryCovered || overlap >= 3) scored.push({ e, overlap })
  }
  return scored
    .sort((a, b) => b.overlap - a.overlap || b.e.lastDate.localeCompare(a.e.lastDate))
    .slice(0, 3)
    .map((s) => s.e)
}

export function describeMemoryEntry(e: PersonalMemoryEntry): string {
  const how = e.source === 'barcode' ? 'scanned this exact product (barcode)' : 'hand-picked this database match'
  const said = e.lastUserInput ? ` They said "${e.lastUserInput}" and it was logged as ${e.lastAmount || 'one portion'} (${e.lastCalories} cal).` : ''
  return `On ${e.lastDate} the user ${how}.${said}`
}

/**
 * Product / brand names this user actually eats — spelling hints for transcription and the
 * parser, so each person's own brands survive speech-to-text. Distinctive names (branded
 * products, library foods, verified brands, names the user typed or corrected) come first,
 * ranked by how often they are logged; plain unbranded foods ("Chicken", "Rice") only fill
 * leftover space since speech-to-text rarely mangles them.
 */
const VOCAB_BOOST_BRANDED_PRODUCT = 1
const VOCAB_BOOST_LIBRARY = 1
const VOCAB_BOOST_VERIFIED_BRAND = 2
const VOCAB_BOOST_USER_EDITED = 3
const VOCAB_MIN_PLAIN_LOGS = 2
const VOCAB_MAX = 80

export function buildPersonalVocabulary(
  logs: Record<string, StoredItem[]>,
  customFoods: { name?: string }[],
  max = VOCAB_MAX,
): string[] {
  const entries = new Map<string, { name: string; logs: number; boost: number }>()
  const bump = (raw: string | undefined, logsDelta: number, boost: number) => {
    const v = raw?.trim().replace(/\s+/g, ' ')
    if (!v || v.length < 3 || v.length > 40) return
    const k = v.toLowerCase()
    const e = entries.get(k) ?? { name: v, logs: 0, boost: 0 }
    e.logs += logsDelta
    e.boost = Math.max(e.boost, boost)
    entries.set(k, e)
  }
  for (const f of customFoods) bump(f.name, 0, VOCAB_BOOST_LIBRARY)
  for (const items of Object.values(logs)) {
    for (const item of items ?? []) {
      if (item.status === 'error') continue
      const food = chosenFood(item)
      if (food?.brandName && (item.fromBarcode || item.userConfirmedMatch)) {
        bump(food.brandName, 1, VOCAB_BOOST_VERIFIED_BRAND)
      }
      const boost = item.userEditedName
        ? VOCAB_BOOST_USER_EDITED
        : food?.brandName
          ? VOCAB_BOOST_BRANDED_PRODUCT
          : 0
      bump(item.name, 1, boost)
    }
  }
  const distinctive = (e: { boost: number }) => (e.boost > 0 ? 1 : 0)
  return [...entries.values()]
    .filter((e) => e.boost > 0 || e.logs >= VOCAB_MIN_PLAIN_LOGS)
    .sort((a, b) => distinctive(b) - distinctive(a) || b.logs + b.boost - (a.logs + a.boost))
    .slice(0, max)
    .map((e) => e.name)
}

type BundleCacheEntry = {
  at: number
  entries: PersonalMemoryEntry[]
  vocabulary: string[]
}
const bundleCache = new Map<string, BundleCacheEntry>()
const MEMORY_TTL_MS = 60_000

async function loadBundle(db: D1Database, profileId: string): Promise<BundleCacheEntry> {
  const hit = bundleCache.get(profileId)
  if (hit && Date.now() - hit.at < MEMORY_TTL_MS) return hit
  const row = await db
    .prepare('SELECT logs_json, custom_foods_json FROM macro_bundle WHERE device_id = ?')
    .bind(profileId)
    .first<{ logs_json: string | null; custom_foods_json: string | null }>()
  let logs: Record<string, StoredItem[]> = {}
  let customFoods: { name?: string }[] = []
  try {
    logs = JSON.parse(row?.logs_json || '{}') as Record<string, StoredItem[]>
  } catch {
    logs = {}
  }
  try {
    const parsed = JSON.parse(row?.custom_foods_json || '[]') as unknown
    customFoods = Array.isArray(parsed) ? (parsed as { name?: string }[]) : []
  } catch {
    customFoods = []
  }
  const entry: BundleCacheEntry = {
    at: Date.now(),
    entries: buildPersonalMemory(logs),
    vocabulary: buildPersonalVocabulary(logs, customFoods),
  }
  bundleCache.set(profileId, entry)
  return entry
}

export async function loadPersonalMemory(db: D1Database, profileId: string): Promise<PersonalMemoryEntry[]> {
  return (await loadBundle(db, profileId)).entries
}

export async function loadPersonalVocabulary(db: D1Database, profileId: string): Promise<string[]> {
  return (await loadBundle(db, profileId)).vocabulary
}
