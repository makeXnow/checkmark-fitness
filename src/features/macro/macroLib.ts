import type { MacroCustomFood, MacroDayItem } from '../../types/domain'

export type ParsedFoodItem = {
  emoji?: string
  name: string
  amount: string
  notes?: string
}

export type MacroEstimateResponse = {
  libraryIndex?: number | null
  multiplier?: number
  calories?: number
  protein?: number
}

export type MacroEstimateResult = {
  calories: number
  protein: number
  libraryFoodId?: string
  servingMultiplier?: number
  name?: string
  emoji?: string
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

function parseLibraryIndex(raw: unknown): number | null {
  if (typeof raw === 'number' && Number.isFinite(raw)) return Math.trunc(raw)
  if (typeof raw === 'string' && raw.trim()) {
    const n = parseInt(raw, 10)
    if (Number.isFinite(n)) return n
  }
  return null
}

export function resolveMacroEstimate(response: MacroEstimateResponse, foods: MacroCustomFood[]): MacroEstimateResult {
  const idx = parseLibraryIndex(response.libraryIndex)
  if (idx !== null && idx >= 1 && idx <= foods.length) {
    const food = foods[idx - 1]!
    const multiplier = typeof response.multiplier === 'number' && response.multiplier > 0 ? response.multiplier : 1
    const scaled = scaleLibraryMacros(food, multiplier)
    return {
      calories: scaled.calories,
      protein: scaled.protein,
      libraryFoodId: food.id,
      servingMultiplier: multiplier,
      name: food.name,
      emoji: food.emoji,
    }
  }
  return {
    calories: Math.round(response.calories ?? 0),
    protein: Math.round((response.protein ?? 0) * 10) / 10,
  }
}

const MACRO_ITEM_STATUS_RANK: Record<string, number> = {
  ready: 4,
  editing_raw: 3,
  processing_cancellable: 2,
  transcribing: 2,
  pending: 1,
}

function macroItemStatusRank(status?: string): number {
  return MACRO_ITEM_STATUS_RANK[status ?? ''] ?? 0
}

/** Prefer the more complete item when parallel saves race (e.g. ready over pending). */
export function mergeMacroDayItem(a: MacroDayItem, b: MacroDayItem): MacroDayItem {
  const ra = macroItemStatusRank(a.status)
  const rb = macroItemStatusRank(b.status)
  if (ra !== rb) return ra > rb ? { ...b, ...a } : { ...a, ...b }
  const ta = a.timestamp ?? 0
  const tb = b.timestamp ?? 0
  return ta >= tb ? { ...b, ...a } : { ...a, ...b }
}

export function mergeMacroDayLists(prev: MacroDayItem[], incoming: MacroDayItem[]): MacroDayItem[] {
  const byId = new Map<string, MacroDayItem>()
  for (const item of prev) byId.set(item.id, item)
  for (const item of incoming) {
    const existing = byId.get(item.id)
    byId.set(item.id, existing ? mergeMacroDayItem(existing, item) : item)
  }
  const seen = new Set<string>()
  const ordered: MacroDayItem[] = []
  for (const item of incoming) {
    if (!seen.has(item.id)) {
      ordered.push(byId.get(item.id)!)
      seen.add(item.id)
    }
  }
  for (const item of prev) {
    if (!seen.has(item.id)) {
      ordered.push(byId.get(item.id)!)
      seen.add(item.id)
    }
  }
  return ordered
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
  return {
    id: crypto.randomUUID(),
    emoji: it.emoji,
    name: it.name || '',
    amount: it.amount || '',
    notes: it.notes?.trim() || undefined,
    status: 'pending',
    timestamp: Date.now(),
    calories: 0,
    protein: 0,
    fat: 0,
    carbs: 0,
    ...overrides,
  }
}
