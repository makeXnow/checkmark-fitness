import type {
  FatSecretFoodRef,
  MacroCustomFood,
  MacroDayItem,
  MacroEstimateSnapshot,
  MacroParseSnapshot,
} from '../../types/domain'
import { applyMassMultiplierCorrection, parseMassGrams, parseServingBaseGrams } from './macroMass'

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
  servingSize?: number
  servingUnit?: string
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

/** Parser classification + original input for user-confirmed database re-estimates. */
export function formatClassificationContext(item: {
  userInput?: string
  rawText?: string
  parseSnapshot?: MacroParseSnapshot
}): string {
  const lines: string[] = []
  const userInput = item.userInput?.trim() || item.rawText?.trim()
  if (userInput) lines.push(`Original user input: ${userInput}`)
  const snap = item.parseSnapshot
  if (snap) {
    lines.push('Classification (parser output):')
    if (snap.emoji?.trim()) lines.push(`Emoji: ${snap.emoji.trim()}`)
    if (snap.name?.trim()) lines.push(`Name: ${snap.name.trim()}`)
    if (snap.amount?.trim()) lines.push(`Serving: ${snap.amount.trim()}`)
    if (snap.notes?.trim()) lines.push(`Notes: ${snap.notes.trim()}`)
    if (snap.fatSecretSearch?.trim()) lines.push(`Database search: ${snap.fatSecretSearch.trim()}`)
  }
  if (lines.length === 0) return ''
  return `\n\n${lines.join('\n')}`
}

export function macroEstimateInputFields(item: {
  name: string
  amount: string
  notes?: string
  parseSnapshot?: MacroParseSnapshot
}): { name: string; amount: string; notes?: string } {
  const snap = item.parseSnapshot
  return {
    name: snap?.name?.trim() || item.name,
    amount: snap?.amount?.trim() || item.amount,
    notes: snap?.notes?.trim() || item.notes,
  }
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

function trimTrailingZeros(s: string): string {
  return s.replace(/\.?0+$/, '')
}

function isNearInteger(n: number, epsilon = 0.001): boolean {
  return Math.abs(n - Math.round(n)) < epsilon
}

type ServingUnitKind = 'gram' | 'ounce' | 'pound' | 'milliliter' | 'liter' | 'volume' | 'count'

function servingUnitKind(unit: string): ServingUnitKind {
  const u = unit.toLowerCase().trim()
  if (/^(g|grams?)$/.test(u)) return 'gram'
  if (/^(oz|ounces?)$/.test(u) || /\boz\b/.test(u)) return 'ounce'
  if (/^(lb|lbs|pounds?)$/.test(u) || /\blb\b/.test(u)) return 'pound'
  if (/^(ml|milliliters?)$/.test(u)) return 'milliliter'
  if (/^(l|liters?)$/.test(u)) return 'liter'
  if (/\b(cups?|tbsp|tablespoons?|tsp|teaspoons?|fl\s*oz)\b/.test(u)) return 'volume'
  return 'count'
}

/** Format a quantity for display; rounding depends on the unit (grams → whole numbers, etc.). */
export function formatServingQuantity(value: number, unit: string): string {
  if (!Number.isFinite(value) || value <= 0) return '1'

  switch (servingUnitKind(unit)) {
    case 'gram':
    case 'milliliter':
      return String(Math.round(value))
    case 'ounce':
    case 'pound':
      if (isNearInteger(value)) return String(Math.round(value))
      return trimTrailingZeros(value.toFixed(1))
    case 'liter':
      if (value >= 10 || isNearInteger(value)) return String(Math.round(value))
      return trimTrailingZeros(value.toFixed(2))
    case 'volume':
      if (isNearInteger(value)) return String(Math.round(value))
      if (value < 1) return trimTrailingZeros(value.toFixed(2))
      return trimTrailingZeros(value.toFixed(1))
    case 'count':
    default:
      if (isNearInteger(value)) return String(Math.round(value))
      return trimTrailingZeros(value.toFixed(2))
  }
}

/** Format a serving count multiplier (e.g. 1.25 servings) — not unit-aware. */
export function formatMultiplier(m: number): string {
  return formatServingQuantity(m, 'serving')
}

export type ServingDefinition = {
  servingSize: number
  servingUnit: string
  /** Human-readable label for one base portion (e.g. "1/2 cup prepared"). */
  label: string
}

function parseFractionToken(raw: string): number | null {
  const m = raw.replace(/\s/g, '').match(/^(\d+)\/(\d+)$/)
  if (!m) return null
  const num = parseInt(m[1]!, 10)
  const den = parseInt(m[2]!, 10)
  if (!Number.isFinite(num) || !Number.isFinite(den) || den <= 0) return null
  return num / den
}

/** Split a base serving string into numeric size, unit, and display label. */
export function parseServingDefinition(text: string): ServingDefinition {
  const trimmed = text.trim()
  if (!trimmed) return { servingSize: 1, servingUnit: 'serving', label: '1 serving' }

  const fracMatch = trimmed.match(/^(\d+\s*\/\s*\d+)\s+(.*)$/i)
  if (fracMatch) {
    const size = parseFractionToken(fracMatch[1]!)
    const unit = fracMatch[2]!.trim() || 'serving'
    if (size != null && size > 0) {
      return { servingSize: size, servingUnit: unit, label: trimmed }
    }
  }

  const numMatch = trimmed.match(/^([\d.]+)\s+(.*)$/)
  if (numMatch) {
    const size = parseFloat(numMatch[1]!)
    const unit = numMatch[2]!.trim()
    if (Number.isFinite(size) && size > 0 && unit) {
      return { servingSize: size, servingUnit: unit, label: trimmed }
    }
  }

  const compact = trimmed.match(/^([\d.]+)(oz|g|lb|lbs|ml|l)$/i)
  if (compact) {
    const size = parseFloat(compact[1]!)
    if (Number.isFinite(size) && size > 0) {
      const unit = compact[2]!.toLowerCase()
      return { servingSize: size, servingUnit: unit, label: trimmed }
    }
  }

  if (/^servings?$/i.test(trimmed)) {
    return { servingSize: 1, servingUnit: 'serving', label: '1 serving' }
  }

  return { servingSize: 1, servingUnit: trimmed, label: `1 ${trimmed}` }
}

/** Collapsed-card total: count × base size + unit (e.g. "0.63 cup prepared"). */
export function formatServingTotal(count: number, servingSize: number, servingUnit: string): string {
  const mult = Number.isFinite(count) && count > 0 ? count : 1
  const size = Number.isFinite(servingSize) && servingSize > 0 ? servingSize : 1
  const unit = servingUnit.trim() || 'serving'
  return `${formatServingQuantity(mult * size, unit)} ${unit}`
}

/** Expanded-card read-only base serving label. */
export function formatServingDefinitionLabel(def: ServingDefinition): string {
  return def.label.trim() || formatServingTotal(1, def.servingSize, def.servingUnit)
}

export function servingDefinitionFromFields(item: {
  servingType?: string
  servingSize?: number
  servingUnit?: string
}): ServingDefinition {
  const hasSize = typeof item.servingSize === 'number' && item.servingSize > 0
  const unit = item.servingUnit?.trim()
  if (hasSize && unit) {
    const label = item.servingType?.trim() || formatServingDefinitionLabel({
      servingSize: item.servingSize!,
      servingUnit: unit,
      label: '',
    })
    return { servingSize: item.servingSize!, servingUnit: unit, label }
  }
  return parseServingDefinition(item.servingType?.trim() || '1 serving')
}

/** Display string for total consumed amount (count × base serving). */
export function formatServingDisplay(multiplier: number, servingType: string): string {
  const def = parseServingDefinition(servingType)
  return formatServingTotal(multiplier, def.servingSize, def.servingUnit)
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
  servingSize?: number
  servingUnit?: string
  servingMultiplier?: number
}): {
  servingType: string
  servingSize: number
  servingUnit: string
  servingMultiplier: number
  amount: string
} {
  const mult =
    typeof item.servingMultiplier === 'number' && item.servingMultiplier > 0 ? item.servingMultiplier : 1

  if (item.servingType?.trim() || (typeof item.servingSize === 'number' && item.servingUnit?.trim())) {
    const def = servingDefinitionFromFields(item)
    return {
      servingType: def.label,
      servingSize: def.servingSize,
      servingUnit: def.servingUnit,
      servingMultiplier: mult,
      amount: formatServingTotal(mult, def.servingSize, def.servingUnit),
    }
  }

  const legacy = parseLegacyServing(item.amount || '')
  const def = parseServingDefinition(legacy.servingType)
  return {
    servingType: def.label,
    servingSize: def.servingSize,
    servingUnit: def.servingUnit,
    servingMultiplier: legacy.multiplier,
    amount: formatServingTotal(legacy.multiplier, def.servingSize, def.servingUnit),
  }
}

function applyStructuredServingFields(
  item: MacroDayItem,
  mult: number,
  def: ServingDefinition,
): MacroDayItem {
  return {
    ...item,
    servingType: def.label,
    servingSize: def.servingSize,
    servingUnit: def.servingUnit,
    servingMultiplier: mult,
    amount: formatServingTotal(mult, def.servingSize, def.servingUnit),
  }
}

export function buildDayItemServingFields(
  multiplier: number,
  source: { servingType?: string; servingSize?: number; servingUnit?: string },
): Pick<MacroDayItem, 'amount' | 'servingType' | 'servingSize' | 'servingUnit' | 'servingMultiplier'> {
  const def = servingDefinitionFromFields(source)
  const mult = Number.isFinite(multiplier) && multiplier > 0 ? multiplier : 1
  return {
    servingType: def.label,
    servingSize: def.servingSize,
    servingUnit: def.servingUnit,
    servingMultiplier: mult,
    amount: formatServingTotal(mult, def.servingSize, def.servingUnit),
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

/** 1-based FatSecret food index from a macro estimate snapshot, if any. */
export function macroEstimateFatSecretIndex(snap?: MacroEstimateSnapshot | null): number | null {
  return parseIndex(snap?.fatSecretIndex)
}

export type ResolveMacroEstimateOptions = {
  /** Parser/classification serving (e.g. "4 lbs") — used to correct weight-based multipliers. */
  userAmount?: string
}

/** How many base portions the user ate (editable count in the day log). */
export function resolveItemServingMultiplier(item: MacroDayItem): number {
  if (typeof item.servingMultiplier === 'number' && item.servingMultiplier > 0) {
    return item.servingMultiplier
  }
  const snap = item.macroEstimateSnapshot
  if (typeof snap?.multiplier === 'number' && snap.multiplier > 0) return snap.multiplier
  return parseLegacyServing(item.amount || '').multiplier
}

/** Total macros = per-serving base × portion count. */
export function macrosForServingCount(
  baseCalories: number,
  baseProtein: number,
  servingMultiplier: number,
): { calories: number; protein: number; baseCalories: number; baseProtein: number } {
  const mult = Number.isFinite(servingMultiplier) && servingMultiplier > 0 ? servingMultiplier : 1
  const scaled = scaleFatSecretServing({ calories: baseCalories, protein: baseProtein }, mult)
  return {
    baseCalories,
    baseProtein,
    calories: scaled.calories,
    protein: scaled.protein,
  }
}

function fatSecretServingFromItem(item: MacroDayItem) {
  const snap = item.macroEstimateSnapshot
  const fsIdx = snap ? parseIndex(snap.fatSecretIndex) : null
  if (fsIdx == null || !item.fatSecretResults?.length || fsIdx < 1 || fsIdx > item.fatSecretResults.length) {
    return null
  }
  const food = item.fatSecretResults[fsIdx - 1]!
  const servIdx = parseIndex(snap?.servingIndex)
  if (servIdx != null && servIdx >= 1 && servIdx <= food.servings.length) {
    return food.servings[servIdx - 1]!
  }
  return food.servings.find((s) => s.isDefault) ?? food.servings[0] ?? null
}

/** Per-serving macros from food library or FatSecret when available. */
export function resolveCanonicalBaseMacros(
  item: MacroDayItem,
  customFoods: MacroCustomFood[] = [],
): { baseCalories: number; baseProtein: number } | null {
  if (item.libraryFoodId) {
    const food = customFoods.find((f) => f.id === item.libraryFoodId)
    if (food) return { baseCalories: food.calories, baseProtein: food.protein }
  }

  const serving = fatSecretServingFromItem(item)
  if (serving) return { baseCalories: serving.calories, baseProtein: serving.protein }

  if (item.baseCalories != null && item.baseProtein != null) {
    const mult = resolveItemServingMultiplier(item)
    const synced = macrosForServingCount(item.baseCalories, item.baseProtein, mult)
    const storedCal = item.calories ?? 0
    if (storedCal <= 0 || Math.abs(storedCal - synced.calories) <= 1) {
      return { baseCalories: item.baseCalories, baseProtein: item.baseProtein }
    }
  }

  const cal = item.calories ?? 0
  const pro = item.protein ?? 0
  if (cal > 0 || pro > 0) {
    const mult = resolveItemServingMultiplier(item)
    if (mult > 0) {
      return {
        baseCalories: Math.round(cal / mult),
        baseProtein: Math.round((pro / mult) * 10) / 10,
      }
    }
  }

  return null
}

/** Portion count for count-based servings (tray, piece); weight servings use mass multiplier. */
function resolveCountServingMultiplier(
  userAmount: string | undefined,
  selectedServingDescription: string,
  aiMultiplier: number | undefined,
): number {
  const ai = typeof aiMultiplier === 'number' && aiMultiplier > 0 ? aiMultiplier : 1
  if (parseServingBaseGrams(selectedServingDescription) != null) return ai
  if (userAmount?.trim() && parseMassGrams(userAmount) != null) return ai
  const legacy = parseLegacyServing(userAmount || '')
  return legacy.multiplier > 0 ? legacy.multiplier : ai
}

export function resolveMacroEstimate(
  response: MacroEstimateResponse,
  foods: MacroCustomFood[],
  fatSecretResults: FatSecretFoodRef[] = [],
  options?: ResolveMacroEstimateOptions,
): MacroEstimateResult {
  const adjusted = options?.userAmount?.trim()
    ? applyMassMultiplierCorrection(response, options.userAmount, foods, fatSecretResults)
    : response

  const libIdx = parseIndex(adjusted.libraryIndex)
  if (libIdx !== null && libIdx >= 1 && libIdx <= foods.length) {
    const food = foods[libIdx - 1]!
    const multiplier = typeof adjusted.multiplier === 'number' && adjusted.multiplier > 0 ? adjusted.multiplier : 1
    const scaled = scaleLibraryMacros(food, multiplier)
    const def = parseServingDefinition(food.baseAmount || '1 serving')
    return {
      calories: scaled.calories,
      protein: scaled.protein,
      libraryFoodId: food.id,
      servingType: def.label,
      servingSize: def.servingSize,
      servingUnit: def.servingUnit,
      servingMultiplier: multiplier,
      baseCalories: food.calories,
      baseProtein: food.protein,
    }
  }

  const fsIdx = parseIndex(adjusted.fatSecretIndex)
  if (fsIdx !== null && fsIdx >= 1 && fsIdx <= fatSecretResults.length) {
    const food = fatSecretResults[fsIdx - 1]!
    const servIdx = parseIndex(adjusted.servingIndex)
    const serving =
      servIdx !== null && servIdx >= 1 && servIdx <= food.servings.length
        ? food.servings[servIdx - 1]!
        : food.servings.find((s) => s.isDefault) ?? food.servings[0]!
    const multiplier = resolveCountServingMultiplier(
      options?.userAmount,
      serving.description,
      adjusted.multiplier,
    )
    const scaled = scaleFatSecretServing(serving, multiplier)
    const def = parseServingDefinition(serving.description)
    return {
      calories: scaled.calories,
      protein: scaled.protein,
      servingType: def.label,
      servingSize: def.servingSize,
      servingUnit: def.servingUnit,
      servingMultiplier: multiplier,
      baseCalories: serving.calories,
      baseProtein: serving.protein,
    }
  }

  const multiplier = typeof adjusted.multiplier === 'number' && adjusted.multiplier > 0 ? adjusted.multiplier : 1
  const calories = Math.round(adjusted.calories ?? 0)
  const protein = Math.round((adjusted.protein ?? 0) * 10) / 10
  const def = parseServingDefinition(adjusted.servingType?.trim() || 'serving')
  return {
    calories,
    protein,
    servingType: def.label,
    servingSize: def.servingSize,
    servingUnit: def.servingUnit,
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

/** First emoji character from an AI JSON field; falls back if empty. */
export function parseAiEmoji(raw: unknown, fallback = '🍱'): string {
  const s = typeof raw === 'string' ? raw.trim() : ''
  if (!s) return fallback
  return [...s][0] ?? fallback
}

/** Trim AI diary name to parser rules (max 25 chars). */
export function parseAiDiaryName(raw: unknown, fallback: string): string {
  const s = typeof raw === 'string' ? raw.trim() : ''
  if (!s) return fallback
  return s.length > 25 ? s.slice(0, 25).trim() : s
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
  const base =
    ra !== rb
      ? ra > rb
        ? { ...b, ...a }
        : { ...a, ...b }
      : (a.timestamp ?? 0) > (b.timestamp ?? 0)
        ? { ...b, ...a }
        : { ...a, ...b }
  const fatSecretResults =
    (a.fatSecretResults?.length ? a.fatSecretResults : undefined) ??
    (b.fatSecretResults?.length ? b.fatSecretResults : undefined) ??
    a.fatSecretResults ??
    b.fatSecretResults
  const fatSecretSearch = base.fatSecretSearch ?? a.fatSecretSearch ?? b.fatSecretSearch
  const userInput = base.userInput ?? a.userInput ?? b.userInput
  const parseSnapshot = base.parseSnapshot ?? a.parseSnapshot ?? b.parseSnapshot
  const macroEstimateSnapshot =
    (b.timestamp ?? 0) >= (a.timestamp ?? 0)
      ? b.macroEstimateSnapshot ?? a.macroEstimateSnapshot
      : a.macroEstimateSnapshot ?? b.macroEstimateSnapshot
  return {
    ...base,
    fatSecretResults,
    fatSecretSearch,
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

/** Barcode lookup yields one fixed FatSecret match — hide the database picker. */
export function isBarcodeFatSecretItem(item: MacroDayItem): boolean {
  if (item.fromBarcode) return true
  return Boolean(
    item.fatSecretResults?.length === 1 &&
      !item.parseSnapshot &&
      !item.fatSecretSearch?.trim() &&
      !item.rawText?.trim(),
  )
}

/** Incoming list defines which items exist (so deletes stick). Per-id fields merge for parallel macro races. */
export function mergeMacroDayLists(prev: MacroDayItem[], incoming: MacroDayItem[]): MacroDayItem[] {
  const prevById = new Map(prev.map((item) => [item.id, item]))
  return incoming.map((item) => {
    const existing = prevById.get(item.id)
    return existing ? mergeMacroDayItem(existing, item) : item
  })
}

function servingDefinitionForBackfill(item: MacroDayItem, customFoods: MacroCustomFood[]): ServingDefinition {
  if (item.servingType?.trim() || (typeof item.servingSize === 'number' && item.servingUnit?.trim())) {
    return servingDefinitionFromFields(item)
  }
  const serving = fatSecretServingFromItem(item)
  if (serving) return parseServingDefinition(serving.description)
  if (item.libraryFoodId) {
    const food = customFoods.find((f) => f.id === item.libraryFoodId)
    if (food) return parseServingDefinition(food.baseAmount || '1 serving')
  }
  const legacy = parseLegacyServing(item.amount || '')
  return parseServingDefinition(item.macroEstimateSnapshot?.servingType?.trim() || legacy.servingType)
}

/** Resume macro estimation for items saved before calories were calculated. */
export function backfillMacroItemServingFields(
  item: MacroDayItem,
  customFoods: MacroCustomFood[] = [],
): MacroDayItem {
  const mult = resolveItemServingMultiplier(item)
  const def = servingDefinitionForBackfill(item, customFoods)
  const structured = applyStructuredServingFields(item, mult, def)
  const base = resolveCanonicalBaseMacros(item, customFoods)
  if (base) {
    return { ...structured, ...macrosForServingCount(base.baseCalories, base.baseProtein, mult) }
  }
  return structured
}

function macroItemServingBackfillChanged(before: MacroDayItem, after: MacroDayItem): boolean {
  return (
    before.servingType !== after.servingType ||
    before.servingSize !== after.servingSize ||
    before.servingUnit !== after.servingUnit ||
    before.servingMultiplier !== after.servingMultiplier ||
    before.baseCalories !== after.baseCalories ||
    before.baseProtein !== after.baseProtein ||
    before.calories !== after.calories ||
    before.protein !== after.protein ||
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

/** Parser order is first-mentioned → last-mentioned; timestamps ascend so the list (newest on top) reads bottom-to-top in speech order. */
export function parsedItemsToDayItems(
  items: ParsedFoodItem[],
  overrides: Partial<MacroDayItem> = {},
): MacroDayItem[] {
  const baseTs = Date.now()
  return items.map((it, idx) => parsedItemToDayItem(it, { ...overrides, timestamp: baseTs + idx }))
}
