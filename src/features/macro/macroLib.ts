import type {
  FatSecretFoodRef,
  MacroCustomFood,
  MacroDayItem,
  MacroEstimateSnapshot,
  MacroParseSnapshot,
} from '../../types/domain'

export type ParsedFoodItem = {
  emoji?: string
  name: string
  amount: string
  notes?: string
  fatSecretSearch?: string
}

export type MacroEstimateResponse = {
  libraryIndex?: number | null
  fatSecretIndex?: number | null
  servingIndex?: number | null
  multiplier?: number
  servingType?: string
  calories?: number
  protein?: number
}

export type MacroEstimateResult = {
  calories: number
  protein: number
  libraryFoodId?: string
  servingType?: string
  servingMultiplier?: number
  baseCalories?: number
  baseProtein?: number
}

/** 1-based numbered list for the macro-estimate prompt. */
/** Count day-log entries that reference each library food id. */
export function countLibraryFoodUsage(logs: Record<string, MacroDayItem[]>): Map<string, number> {
  const counts = new Map<string, number>()
  for (const items of Object.values(logs)) {
    for (const item of items) {
      const id = item.libraryFoodId
      if (!id) continue
      counts.set(id, (counts.get(id) ?? 0) + 1)
    }
  }
  return counts
}

/** Most-logged library foods first; tie-break by recency then name. */
export function sortCustomFoodsByUsage(
  foods: MacroCustomFood[],
  logs: Record<string, MacroDayItem[]>,
): MacroCustomFood[] {
  const usage = countLibraryFoodUsage(logs)
  return [...foods].sort((a, b) => {
    const usageDiff = (usage.get(b.id) ?? 0) - (usage.get(a.id) ?? 0)
    if (usageDiff !== 0) return usageDiff
    const createdDiff = (b.createdAt ?? 0) - (a.createdAt ?? 0)
    if (createdDiff !== 0) return createdDiff
    return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })
  })
}

export function formatNumberedFoodLibrary(foods: MacroCustomFood[]): string {
  if (foods.length === 0) return ''
  const lines = foods.map((f, i) => {
    const base = f.baseAmount || '1 serving'
    return `${i + 1}. ${f.name} | base: ${base} | ${f.calories} cal | ${f.protein}g protein`
  })
  return `\n\nFOOD LIBRARY (use libraryIndex only when the item is essentially the same product as a library entry — not merely a shared ingredient):\n${lines.join('\n')}`
}

export function formatNumberedFatSecret(results: FatSecretFoodRef[]): string {
  if (results.length === 0) return ''
  const lines = results.map((f, i) => {
    const label = f.brandName ? `${f.brandName} ${f.name}`.trim() : f.name
    const servingParts = f.servings
      .map((s, si) => `${si + 1}) ${s.description}: ${s.calories} cal, ${s.protein}g protein`)
      .join('; ')
    return `${i + 1}. ${label} | servings: ${servingParts}`
  })
  return `\n\nFATSECRET RESULTS (use fatSecretIndex + servingIndex + multiplier only when essentially the same product — not a shared ingredient):\n${lines.join('\n')}`
}

export function buildMacroEstimatePrompt(
  name: string,
  amount: string,
  notes?: string,
  extraCtx = '',
): string {
  const notesLine = notes?.trim() ? `\nNotes: ${notes.trim()}` : ''
  return `Estimate calories and protein for this food serving:\nItem: ${name}\nServing: ${amount}${notesLine}${extraCtx}`
}

export function scaleLibraryMacros(food: MacroCustomFood, multiplier: number): { calories: number; protein: number } {
  const m = Number.isFinite(multiplier) && multiplier > 0 ? multiplier : 1
  return {
    calories: Math.round(food.calories * m),
    protein: Math.round(food.protein * m * 10) / 10,
  }
}

export function scaleFatSecretServing(
  serving: { calories: number; protein: number },
  multiplier: number,
): { calories: number; protein: number } {
  const m = Number.isFinite(multiplier) && multiplier > 0 ? multiplier : 1
  return {
    calories: Math.round(serving.calories * m),
    protein: Math.round(serving.protein * m * 10) / 10,
  }
}

export function formatMultiplier(m: number): string {
  return Number.isInteger(m) ? String(m) : m.toFixed(2).replace(/\.?0+$/, '')
}

/** Display string for a quantity + unit (e.g. "0.8 can", "2 cups"). */
export function formatServingDisplay(multiplier: number, servingType: string): string {
  const type = servingType.trim() || 'serving'
  const m = formatMultiplier(Number.isFinite(multiplier) && multiplier > 0 ? multiplier : 1)
  return `${m} ${type}`
}

/** Parse legacy free-text amount into quantity + unit. */
export function parseLegacyServing(amount: string): { multiplier: number; servingType: string } {
  const trimmed = amount.trim()
  if (!trimmed) return { multiplier: 1, servingType: 'serving' }
  const match = trimmed.match(/^([\d.]+)\s+(.*)$/)
  if (match) {
    const n = parseFloat(match[1]!)
    if (Number.isFinite(n) && n > 0) return { multiplier: n, servingType: match[2]!.trim() || 'serving' }
  }
  const compact = trimmed.match(/^([\d.]+)(oz|g|lb|lbs|ml|l)$/i)
  if (compact) {
    const n = parseFloat(compact[1]!)
    if (Number.isFinite(n) && n > 0) return { multiplier: n, servingType: compact[2]!.toLowerCase() }
  }
  const numOnly = parseFloat(trimmed)
  if (Number.isFinite(numOnly) && String(numOnly) === trimmed) return { multiplier: numOnly, servingType: 'serving' }
  return { multiplier: 1, servingType: trimmed }
}

/** Resolved serving fields for display and edit. */
export function macroItemServingFields(item: {
  amount?: string
  servingType?: string
  servingMultiplier?: number
}): { servingType: string; servingMultiplier: number; amount: string } {
  if (item.servingType?.trim()) {
    const mult = typeof item.servingMultiplier === 'number' && item.servingMultiplier > 0 ? item.servingMultiplier : 1
    return {
      servingType: item.servingType.trim(),
      servingMultiplier: mult,
      amount: formatServingDisplay(mult, item.servingType),
    }
  }
  const legacy = parseLegacyServing(item.amount || '')
  return {
    servingType: legacy.servingType,
    servingMultiplier: legacy.multiplier,
    amount: item.amount?.trim() ? item.amount : formatServingDisplay(legacy.multiplier, legacy.servingType),
  }
}

function parseIndex(raw: unknown): number | null {
  if (typeof raw === 'number' && Number.isFinite(raw)) return Math.trunc(raw)
  if (typeof raw === 'string' && raw.trim()) {
    const n = parseInt(raw, 10)
    if (Number.isFinite(n)) return n
  }
  return null
}

export function resolveMacroEstimate(
  response: MacroEstimateResponse,
  foods: MacroCustomFood[],
  fatSecretResults: FatSecretFoodRef[] = [],
): MacroEstimateResult {
  const libIdx = parseIndex(response.libraryIndex)
  if (libIdx !== null && libIdx >= 1 && libIdx <= foods.length) {
    const food = foods[libIdx - 1]!
    const multiplier = typeof response.multiplier === 'number' && response.multiplier > 0 ? response.multiplier : 1
    const scaled = scaleLibraryMacros(food, multiplier)
    return {
      calories: scaled.calories,
      protein: scaled.protein,
      libraryFoodId: food.id,
      servingType: food.baseAmount || '1 serving',
      servingMultiplier: multiplier,
      baseCalories: food.calories,
      baseProtein: food.protein,
    }
  }

  const fsIdx = parseIndex(response.fatSecretIndex)
  if (fsIdx !== null && fsIdx >= 1 && fsIdx <= fatSecretResults.length) {
    const food = fatSecretResults[fsIdx - 1]!
    const servIdx = parseIndex(response.servingIndex)
    const serving =
      servIdx !== null && servIdx >= 1 && servIdx <= food.servings.length
        ? food.servings[servIdx - 1]!
        : food.servings.find((s) => s.isDefault) ?? food.servings[0]!
    const multiplier = typeof response.multiplier === 'number' && response.multiplier > 0 ? response.multiplier : 1
    const scaled = scaleFatSecretServing(serving, multiplier)
    return {
      calories: scaled.calories,
      protein: scaled.protein,
      servingType: serving.description,
      servingMultiplier: multiplier,
      baseCalories: serving.calories,
      baseProtein: serving.protein,
    }
  }

  const multiplier = typeof response.multiplier === 'number' && response.multiplier > 0 ? response.multiplier : 1
  const calories = Math.round(response.calories ?? 0)
  const protein = Math.round((response.protein ?? 0) * 10) / 10
  const servingType = response.servingType?.trim() || 'serving'
  return {
    calories,
    protein,
    servingType,
    servingMultiplier: multiplier,
    baseCalories: Math.round(calories / multiplier),
    baseProtein: Math.round((protein / multiplier) * 10) / 10,
  }
}

export type MacroEstimateDescription = {
  method: string
  summary: string
  details: { label: string; value: string }[]
}

/** Human-readable breakdown of a macro-estimate AI response for the info panel. */
export function describeMacroEstimate(
  snap: MacroEstimateSnapshot,
  ctx?: {
    fatSecretResults?: FatSecretFoodRef[]
    customFoods?: MacroCustomFood[]
  },
): MacroEstimateDescription {
  const mult = typeof snap.multiplier === 'number' && snap.multiplier > 0 ? snap.multiplier : 1
  const libIdx = parseIndex(snap.libraryIndex)
  const fsIdx = parseIndex(snap.fatSecretIndex)
  const servIdx = parseIndex(snap.servingIndex)

  if (libIdx !== null && ctx?.customFoods && libIdx >= 1 && libIdx <= ctx.customFoods.length) {
    const food = ctx.customFoods[libIdx - 1]!
    const scaled = scaleLibraryMacros(food, mult)
    return {
      method: 'Food library match',
      summary: `${scaled.calories} cal · ${scaled.protein}g protein`,
      details: [
        { label: 'Library #', value: String(libIdx) },
        { label: 'Item', value: food.name },
        { label: 'Serving type', value: food.baseAmount || '1 serving' },
        { label: 'Quantity', value: formatMultiplier(mult) },
        { label: 'Base macros', value: `${food.calories} cal · ${food.protein}g protein` },
      ],
    }
  }

  if (fsIdx !== null && ctx?.fatSecretResults && fsIdx >= 1 && fsIdx <= ctx.fatSecretResults.length) {
    const food = ctx.fatSecretResults[fsIdx - 1]!
    const serving =
      servIdx !== null && servIdx >= 1 && servIdx <= food.servings.length
        ? food.servings[servIdx - 1]!
        : food.servings.find((s) => s.isDefault) ?? food.servings[0]!
    const scaled = scaleFatSecretServing(serving, mult)
    const label = food.brandName ? `${food.brandName} ${food.name}`.trim() : food.name
    return {
      method: 'FatSecret match',
      summary: `${scaled.calories} cal · ${scaled.protein}g protein`,
      details: [
        { label: 'FatSecret #', value: String(fsIdx) },
        { label: 'Product', value: label },
        { label: 'Serving #', value: servIdx !== null ? String(servIdx) : 'default' },
        { label: 'Serving type', value: serving.description },
        { label: 'Quantity', value: formatMultiplier(mult) },
        { label: 'Per serving', value: `${serving.calories} cal · ${serving.protein}g protein` },
      ],
    }
  }

  const cal = Math.round(snap.calories ?? 0)
  const pro = Math.round((snap.protein ?? 0) * 10) / 10
  const details: { label: string; value: string }[] = [{ label: 'Source', value: 'AI direct estimate' }]
  if (libIdx !== null) details.push({ label: 'Library index', value: String(libIdx) })
  if (fsIdx !== null) details.push({ label: 'FatSecret index', value: String(fsIdx) })
  if (snap.multiplier != null && snap.multiplier !== 1) {
    details.push({ label: 'Quantity', value: formatMultiplier(mult) })
  }
  if (snap.servingType?.trim()) {
    details.push({ label: 'Serving type', value: snap.servingType.trim() })
  }

  return {
    method: 'AI estimate',
    summary: `${cal} cal · ${pro}g protein`,
    details,
  }
}

/** Display name from parser classification; falls back to current item name. */
export function macroItemDisplayName(item: {
  name: string
  parseSnapshot?: MacroParseSnapshot
}): string {
  return item.parseSnapshot?.name?.trim() || item.name
}

export function macroItemDisplayEmoji(item: {
  emoji?: string
  parseSnapshot?: MacroParseSnapshot
}): string {
  return item.parseSnapshot?.emoji || item.emoji || '🍱'
}

const MACRO_ITEM_STATUS_RANK: Record<string, number> = {
  ready: 4,
  pending: 3,
  editing_raw: 2,
  processing_cancellable: 1,
  transcribing: 1,
}

function macroItemStatusRank(status?: string): number {
  return MACRO_ITEM_STATUS_RANK[status ?? ''] ?? 0
}

/** Prefer the more complete item when parallel saves race (e.g. ready over pending). */
export function mergeMacroDayItem(a: MacroDayItem, b: MacroDayItem): MacroDayItem {
  const ra = macroItemStatusRank(a.status)
  const rb = macroItemStatusRank(b.status)
  const base = ra !== rb ? (ra > rb ? { ...b, ...a } : { ...a, ...b }) : (a.timestamp ?? 0) >= (b.timestamp ?? 0) ? { ...b, ...a } : { ...a, ...b }
  const fatSecretResults =
    (a.fatSecretResults?.length ? a.fatSecretResults : undefined) ??
    (b.fatSecretResults?.length ? b.fatSecretResults : undefined) ??
    a.fatSecretResults ??
    b.fatSecretResults
  const fatSecretSearch = base.fatSecretSearch ?? a.fatSecretSearch ?? b.fatSecretSearch
  const fatSecretRoute = base.fatSecretRoute ?? a.fatSecretRoute ?? b.fatSecretRoute
  const userInput = base.userInput ?? a.userInput ?? b.userInput
  const parseSnapshot = base.parseSnapshot ?? a.parseSnapshot ?? b.parseSnapshot
  const macroEstimateSnapshot = base.macroEstimateSnapshot ?? a.macroEstimateSnapshot ?? b.macroEstimateSnapshot
  return {
    ...base,
    fatSecretResults,
    fatSecretSearch,
    fatSecretRoute,
    userInput,
    parseSnapshot,
    macroEstimateSnapshot,
  }
}

export function parseSnapshotFromItem(it: ParsedFoodItem): MacroParseSnapshot {
  return {
    emoji: it.emoji,
    name: it.name || '',
    amount: it.amount || '',
    notes: it.notes?.trim() || undefined,
    fatSecretSearch: it.fatSecretSearch?.trim() || undefined,
  }
}

/** Incoming list defines which items exist (so deletes stick). Per-id fields merge for parallel macro races. */
export function mergeMacroDayLists(prev: MacroDayItem[], incoming: MacroDayItem[]): MacroDayItem[] {
  const prevById = new Map(prev.map((item) => [item.id, item]))
  return incoming.map((item) => {
    const existing = prevById.get(item.id)
    return existing ? mergeMacroDayItem(existing, item) : item
  })
}

/** Resume macro estimation for items saved before calories were calculated. */
export function backfillMacroItemServingFields(
  item: MacroDayItem,
  customFoods: MacroCustomFood[] = [],
): MacroDayItem {
  if (item.baseCalories != null && item.baseProtein != null && item.servingType?.trim()) {
    const mult = typeof item.servingMultiplier === 'number' && item.servingMultiplier > 0 ? item.servingMultiplier : 1
    return {
      ...item,
      servingMultiplier: mult,
      amount: formatServingDisplay(mult, item.servingType),
    }
  }

  const foodsById = new Map(customFoods.map((f) => [f.id, f]))
  if (item.libraryFoodId) {
    const food = foodsById.get(item.libraryFoodId)
    if (food) {
      const legacy = parseLegacyServing(item.amount || '')
      const mult =
        typeof item.servingMultiplier === 'number' && item.servingMultiplier > 0
          ? item.servingMultiplier
          : legacy.multiplier
      const servingType = food.baseAmount || '1 serving'
      return {
        ...item,
        servingType,
        servingMultiplier: mult,
        baseCalories: food.calories,
        baseProtein: food.protein,
        amount: formatServingDisplay(mult, servingType),
      }
    }
  }

  const snap = item.macroEstimateSnapshot
  const fsIdx = snap ? parseIndex(snap.fatSecretIndex) : null
  if (snap && fsIdx != null && item.fatSecretResults?.length && fsIdx >= 1 && fsIdx <= item.fatSecretResults.length) {
    const food = item.fatSecretResults[fsIdx - 1]!
    const servIdx = parseIndex(snap.servingIndex)
    const serving =
      servIdx !== null && servIdx >= 1 && servIdx <= food.servings.length
        ? food.servings[servIdx - 1]!
        : food.servings.find((s) => s.isDefault) ?? food.servings[0]!
    const legacy = parseLegacyServing(item.amount || '')
    const mult =
      typeof item.servingMultiplier === 'number' && item.servingMultiplier > 0
        ? item.servingMultiplier
        : typeof snap.multiplier === 'number' && snap.multiplier > 0
          ? snap.multiplier
          : legacy.multiplier
    const servingType = serving.description
    return {
      ...item,
      servingType,
      servingMultiplier: mult,
      baseCalories: serving.calories,
      baseProtein: serving.protein,
      amount: formatServingDisplay(mult, servingType),
    }
  }

  const legacy = parseLegacyServing(item.amount || '')
  const mult =
    typeof item.servingMultiplier === 'number' && item.servingMultiplier > 0
      ? item.servingMultiplier
      : typeof snap?.multiplier === 'number' && snap.multiplier > 0
        ? snap.multiplier
        : legacy.multiplier
  const servingType = snap?.servingType?.trim() || legacy.servingType
  const calories = item.calories ?? 0
  const protein = item.protein ?? 0

  if (calories > 0 || protein > 0) {
    const baseCalories = mult > 0 ? Math.round(calories / mult) : calories
    const baseProtein = mult > 0 ? Math.round((protein / mult) * 10) / 10 : protein
    return {
      ...item,
      servingType,
      servingMultiplier: mult,
      baseCalories,
      baseProtein,
      amount: formatServingDisplay(mult, servingType),
    }
  }

  return {
    ...item,
    servingType,
    servingMultiplier: mult,
    amount: formatServingDisplay(mult, servingType),
  }
}

function macroItemServingBackfillChanged(before: MacroDayItem, after: MacroDayItem): boolean {
  return (
    before.servingType !== after.servingType ||
    before.servingMultiplier !== after.servingMultiplier ||
    before.baseCalories !== after.baseCalories ||
    before.baseProtein !== after.baseProtein ||
    before.amount !== after.amount
  )
}

export function normalizeMacroLogsOnLoad(
  logs: Record<string, MacroDayItem[]>,
  customFoods: MacroCustomFood[] = [],
): Record<string, MacroDayItem[]> {
  let changed = false
  const out: Record<string, MacroDayItem[]> = {}
  for (const [date, items] of Object.entries(logs)) {
    const next = items.map((item) => {
      let nextItem = item
      if (item.status === 'editing_raw' && item.name?.trim()) {
        changed = true
        nextItem = { ...item, status: 'pending' as const }
      }
      const backfilled = backfillMacroItemServingFields(nextItem, customFoods)
      if (macroItemServingBackfillChanged(nextItem, backfilled)) {
        changed = true
        nextItem = backfilled
      }
      return nextItem
    })
    out[date] = next
  }
  return changed ? out : logs
}

export function mergeMacroLogs(
  prev: Record<string, MacroDayItem[]>,
  incoming: Record<string, MacroDayItem[]>,
): Record<string, MacroDayItem[]> {
  const keys = new Set([...Object.keys(prev), ...Object.keys(incoming)])
  const out: Record<string, MacroDayItem[]> = { ...prev }
  for (const key of keys) {
    const p = prev[key]
    const n = incoming[key]
    if (p && n) out[key] = mergeMacroDayLists(p, n)
    else if (n) out[key] = n
    else if (p) out[key] = p
  }
  return out
}

export function parsedItemToDayItem(it: ParsedFoodItem, overrides: Partial<MacroDayItem> = {}): MacroDayItem {
  const snap = parseSnapshotFromItem(it)
  return {
    id: crypto.randomUUID(),
    emoji: it.emoji,
    name: it.name || '',
    amount: it.amount || '',
    notes: snap.notes,
    fatSecretSearch: snap.fatSecretSearch,
    parseSnapshot: snap,
    status: 'pending',
    timestamp: Date.now(),
    calories: 0,
    protein: 0,
    fat: 0,
    carbs: 0,
    ...overrides,
  }
}
