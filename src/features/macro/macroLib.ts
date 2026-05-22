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
  calories?: number
  protein?: number
}

export type MacroEstimateResult = {
  calories: number
  protein: number
  libraryFoodId?: string
  servingMultiplier?: number
}

/** 1-based numbered list for the macro-estimate prompt. */
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
      servingMultiplier: multiplier,
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
      servingMultiplier: multiplier,
    }
  }

  return {
    calories: Math.round(response.calories ?? 0),
    protein: Math.round((response.protein ?? 0) * 10) / 10,
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
        { label: 'Base serving', value: food.baseAmount || '1 serving' },
        { label: 'Multiplier', value: formatMultiplier(mult) },
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
        { label: 'Serving size', value: serving.description },
        { label: 'Multiplier', value: formatMultiplier(mult) },
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
    details.push({ label: 'Multiplier', value: formatMultiplier(mult) })
  }

  return {
    method: 'AI estimate',
    summary: `${cal} cal · ${pro}g protein`,
    details,
  }
}

function formatMultiplier(m: number): string {
  return Number.isInteger(m) ? String(m) : m.toFixed(2).replace(/\.?0+$/, '')
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
export function normalizeMacroLogsOnLoad(logs: Record<string, MacroDayItem[]>): Record<string, MacroDayItem[]> {
  let changed = false
  const out: Record<string, MacroDayItem[]> = {}
  for (const [date, items] of Object.entries(logs)) {
    const next = items.map((item) => {
      if (item.status === 'editing_raw' && item.name?.trim()) {
        changed = true
        return { ...item, status: 'pending' as const }
      }
      return item
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
