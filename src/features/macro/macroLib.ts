import type {
  FatSecretFoodRef,
  MacroCustomFood,
  MacroDayItem,
  MacroEstimateSnapshot,
  MacroParseSnapshot,
} from '../../types/domain'
import type {
  ConsumptionPortion,
  NormalizedEstimate,
  ServingRelationship,
  UnitFamily,
  V7ServingRelationship,
} from './macroAiSchemas'
import { isValidPositiveNumber, isValidUnitFamily } from './macroAiValidate'
import { parseLeadingQuantity, parseMassGrams, parseResolvedAmount, parseServingBaseGrams, resolveDbMultiplier, roundMultiplier } from './macroMass'
import { consumptionIntentToResolved, parseConsumptionIntent } from './consumptionIntent'
import {
  consumptionDisplayResolved,
  consumptionToMatchResolved,
  enrichAmountText,
  ensureConsumption,
} from './consumptionNormalize'
import {
  computeMacroMultiplier,
  effectiveFatSecretServingDescription,
} from './macroServingResolve'
import { computeV7Multiplier } from './macroV7Resolve'
import { computeV8Multiplier, displayUnitForQuantity, formatQuantityUnitDisplay } from './macroV8Resolve'

export type ParsedFoodItem = {
  emoji?: string
  name: string
  /** Resolved numeric quantity from parser. */
  quantity?: number
  /** V8 singular display unit */
  unitSingular?: string
  /** V8 plural display unit */
  unitPlural?: string
  /** Display / math unit (derived from singular/plural, or V7 `unit`) */
  unit?: string
  /** mass | volume | count | serving */
  unitFamily?: UnitFamily
  /** Quantity was inferred from vague language. */
  estimated?: boolean
  /** Original vague wording when estimated. */
  originalPortion?: string
  /** @deprecated V5 — legacy parser field */
  amount?: string
  /** @deprecated V5 */
  amountText?: string
  /** @deprecated V5 */
  consumption?: ConsumptionPortion
  notes?: string
  fatSecretSearch?: string
}

export type MacroEstimateResponse = {
  libraryIndex?: number | null
  fatSecretIndex?: number | null
  servingIndex?: number | null
  /**
   * Nutrition multiplier. V8/V7: set by deterministic code from relationship.
   * V6 may still store AI-produced values on old diary entries.
   */
  multiplier?: number
  /** AI #2 relationship classification. */
  relationshipV7?: V7ServingRelationship | null
  /** @deprecated V7 NEEDS_ESTIMATE bridge — V9 uses unitsPerServing from AI #2 */
  estimateQuantity?: number | null
  estimateUnit?: string | null
  /** V9 AI #2: how many user-units are in one database serving when NEEDS_UNIT_BRIDGE */
  unitsPerServing?: number | null
  unitBridgeQuestion?: string | null
  unitBridgeRan?: boolean
  deterministicOk?: boolean
  relationshipRetryRan?: boolean
  rawMacrosPass1Json?: string
  rawMacrosPass2Json?: string
  rawMacrosRetryJson?: string
  candidateAnnotationsJson?: string
  /** @deprecated V8 AI #3 */
  rawUnitBridgeJson?: string
  servingType?: string
  calories?: number
  protein?: number
  /** @deprecated V5 */
  relationship?: ServingRelationship | null
  /** @deprecated V5 */
  normalizedEstimate?: NormalizedEstimate | null
  /** @deprecated V5 */
  resolvedQty?: number
  /** @deprecated V5 */
  resolvedUnit?: string
  /** @deprecated V5 */
  resolvedAmount?: string
}

/** Map structured MACROS AI output (field `relationship`) onto MacroEstimateResponse. */
export function macrosAiToEstimateResponse(raw: {
  libraryIndex?: number | null
  fatSecretIndex?: number | null
  servingIndex?: number | null
  relationship?: V7ServingRelationship | null
  relationshipV7?: V7ServingRelationship | null
  estimateQuantity?: number | null
  estimateUnit?: string | null
  unitsPerServing?: number | null
  bridgeQuestion?: string | null
  calories?: number
  protein?: number
  servingType?: string
  multiplier?: number
}): MacroEstimateResponse {
  return {
    libraryIndex: raw.libraryIndex ?? null,
    fatSecretIndex: raw.fatSecretIndex ?? null,
    servingIndex: raw.servingIndex ?? null,
    relationshipV7: raw.relationshipV7 ?? raw.relationship ?? null,
    estimateQuantity: raw.estimateQuantity ?? null,
    estimateUnit: raw.estimateUnit ?? null,
    unitsPerServing: raw.unitsPerServing ?? null,
    unitBridgeQuestion: raw.bridgeQuestion ?? null,
    calories: raw.calories ?? 0,
    protein: raw.protein ?? 0,
    servingType: raw.servingType ?? '',
    ...(typeof raw.multiplier === 'number' ? { multiplier: raw.multiplier } : {}),
  }
}

/** Format parser quantity + unit for diary display (e.g. "2 cookie", "183 g"). */
export function formatAmountFromQuantityUnit(quantity: number, unit: string): string {
  const qty = formatServingQuantity(quantity, unit)
  return `${qty} ${unit.trim()}`
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

/** @deprecated Prefer formatNumberedFatSecretAnnotated with user unit. */
export function formatNumberedFatSecret(results: FatSecretFoodRef[]): string {
  if (results.length === 0) return ''
  const lines = results.map((f, i) => {
    const label = f.brandName ? `${f.brandName} ${f.name}`.trim() : f.name
    const servingParts = f.servings
      .map((s, si) => `${si + 1}) ${s.description}: ${s.calories} cal, ${s.protein}g protein`)
      .join('; ')
    return `${i + 1}. ${label} | servings: ${servingParts}`
  })
  return `\n\nFATSECRET CANDIDATES (use fatSecretIndex + servingIndex + relationship — do NOT calculate a multiplier):\n${lines.join('\n')}`
}

export function buildMacroEstimatePrompt(
  name: string,
  quantity: number,
  unit: string,
  notes?: string,
  userInput?: string,
  extraCtx = '',
): string {
  const notesLine = notes?.trim() ? `\nNotes: ${notes.trim()}` : ''
  const userLine = userInput?.trim() ? `\nOriginal user input: ${userInput.trim()}` : ''
  return `Match this parsed food to our food library or FatSecret results:\nItem: ${name}\nQuantity: ${quantity}\nUnit: ${unit}${notesLine}${userLine}${extraCtx}`
}

/** Natural-language case brief for V7 AI #2 (preferred over dumping raw variables). */
export function buildV7MacrosCaseBrief(input: {
  userInput?: string
  name: string
  quantity: number
  unit: string
  unitFamily?: UnitFamily
  estimated?: boolean
  originalPortion?: string
  notes?: string
  fatSecretSearch?: string
}): string {
  const userSaid = input.userInput?.trim() || `${input.quantity} ${input.unit} ${input.name}`
  const estimated = Boolean(input.estimated)
  const portion = input.originalPortion?.trim()
  let estimateSentence = ''
  if (estimated && portion) {
    estimateSentence = ` AI #1 identified ${input.name} and estimated the portion as ${input.quantity} ${input.unit}. This amount was estimated because the user said "${portion}."`
  } else if (estimated) {
    estimateSentence = ` AI #1 identified ${input.name} and estimated the portion as ${input.quantity} ${input.unit}.`
  } else {
    estimateSentence = ` AI #1 identified ${input.name} with an explicit portion of ${input.quantity} ${input.unit}${input.unitFamily ? ` (${input.unitFamily})` : ''}.`
  }
  const notesLine = input.notes?.trim() ? ` Notes: ${input.notes.trim()}.` : ''
  const searchLine = input.fatSecretSearch?.trim()
    ? ` FatSecret search used: "${input.fatSecretSearch.trim()}".`
    : ''
  return `The user said "${userSaid}."${estimateSentence}${notesLine}${searchLine} Below are the best FatSecret candidates for this batch. Classify relationship; do not calculate the multiplier.`
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
    if (typeof snap.quantity === 'number' && snap.unit?.trim()) {
      lines.push(`Quantity: ${snap.quantity}`)
      lines.push(`Unit: ${snap.unit.trim()}`)
    } else if (snap.amount?.trim()) {
      lines.push(`Amount: ${snap.amount.trim()}`)
    }
    if (snap.unitFamily) lines.push(`Unit family: ${snap.unitFamily}`)
    if (typeof snap.estimated === 'boolean') lines.push(`Estimated: ${snap.estimated}`)
    if (snap.originalPortion?.trim()) lines.push(`Original portion: ${snap.originalPortion.trim()}`)
    if (snap.consumption) lines.push(`Consumption (legacy): ${JSON.stringify(snap.consumption)}`)
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
  userInput?: string
}): {
  name: string
  amount: string
  quantity: number
  unit: string
  unitFamily?: UnitFamily
  estimated?: boolean
  originalPortion?: string
  notes?: string
  consumption?: ConsumptionPortion
} {
  const snap = item.parseSnapshot
  const name = snap?.name?.trim() || item.name
  const amount = snap?.amount?.trim() || item.amount
  // Prefer singular unit for math (V8); display unit may be pluralized.
  const mathUnit =
    (typeof snap?.unitSingular === 'string' && snap.unitSingular.trim()) ||
    (typeof snap?.unit === 'string' && snap.unit.trim()) ||
    undefined
  const portion = resolveParserPortion({
    quantity: snap?.quantity,
    unit: mathUnit,
    amount,
    consumption: snap?.consumption ?? null,
    foodName: name,
    userInput: item.userInput,
  })
  const consumption =
    snap?.consumption ??
    (portion
      ? ensureConsumption(amount, null, { name, userInput: item.userInput }) ?? undefined
      : undefined)
  return {
    name,
    amount: portion ? formatAmountFromQuantityUnit(portion.qty, portion.unit) : amount,
    quantity: portion?.qty ?? 1,
    unit: portion?.unit ?? mathUnit ?? 'serving',
    unitFamily: snap?.unitFamily,
    estimated: snap?.estimated,
    originalPortion: snap?.originalPortion,
    notes: snap?.notes?.trim() || item.notes,
    consumption,
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

  const leadingQty = parseLeadingQuantity(trimmed)
  if (leadingQty != null) {
    const unitPart = trimmed
      .replace(/^\s*(\d+\s+\d+\s*\/\s*\d+|\d+\s*\/\s*\d+|\d+(?:\.\d+)?)\s*/i, '')
      .trim()
    if (unitPart) {
      return { servingSize: leadingQty, servingUnit: unitPart, label: trimmed }
    }
  }

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
  /** V6: parser quantity (authoritative for card display). */
  quantity?: number
  /** V6: parser unit (authoritative for card display). */
  unit?: string
  /** Legacy display / fallback amount text. */
  userAmount?: string
  /** @deprecated V5 structured parser consumption */
  consumption?: ConsumptionPortion | null
  foodName?: string
  userInput?: string
}

function validNutritionMultiplier(n: unknown): number | null {
  return typeof n === 'number' && Number.isFinite(n) && n > 0 ? n : null
}

/** Resolve parser quantity + unit from V6 or legacy snapshot fields. */
export function resolveParserPortion(input: {
  quantity?: number
  unit?: string
  amount?: string
  consumption?: ConsumptionPortion | null
  foodName?: string
  userInput?: string
}): { qty: number; unit: string } | null {
  if (isValidPositiveNumber(input.quantity) && input.unit?.trim()) {
    return { qty: input.quantity, unit: input.unit.trim() }
  }

  const amount = input.amount?.trim() ?? ''
  const foodCtx = { name: input.foodName, userInput: input.userInput }
  const ensured = ensureConsumption(amount, input.consumption ?? null, foodCtx)
  if (ensured) {
    const fromConsumption = consumptionToMatchResolved(ensured)
    if (fromConsumption) {
      return consumptionDisplayResolved(amount, fromConsumption, foodCtx)
    }
  }

  if (amount) {
    const intent = parseConsumptionIntent(amount)
    if (intent) {
      return consumptionDisplayResolved(amount, consumptionIntentToResolved(intent), foodCtx)
    }
  }

  return null
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
  const baseGrams = parseServingBaseGrams(selectedServingDescription)
  if (baseGrams !== null) {
    // Gram-based FS serving: compute mass ratio from user input rather than trusting the
    // AI multiplier (AI often sets multiplier = userGrams ÷ 1, giving e.g. 200× instead of 2×).
    const userGrams = userAmount?.trim() ? parseMassGrams(userAmount) : null
    if (userGrams !== null && baseGrams > 0) return roundMultiplier(userGrams / baseGrams)
    return ai
  }
  // User gave a mass input but FS serving has no gram info (e.g. "1/2 cup").
  // The AI multiplier is unreliable here — return 1 as a safe neutral fallback.
  if (userAmount?.trim() && parseMassGrams(userAmount) != null) return 1

  // Count path: try parser intent then resolveDbMultiplier
  if (userAmount?.trim()) {
    const intent = parseConsumptionIntent(userAmount)
    if (intent) {
      const dbMult = resolveDbMultiplier(consumptionIntentToResolved(intent), selectedServingDescription)
      if (dbMult !== null) return dbMult
    }
    const userParsed = parseResolvedAmount(userAmount)
    if (userParsed) {
      const dbMult = resolveDbMultiplier(userParsed, selectedServingDescription)
      if (dbMult !== null) return dbMult
    }
  }

  return ai
}

/**
 * Returns the user's resolved portion as { qty, unit } from whichever format is present.
 * Prefers the structured resolvedQty + resolvedUnit fields (new format) over the
 * legacy resolvedAmount string. Returns a fresh object so callers can mutate unit freely.
 */
function getResolvedParsed(
  r: Pick<MacroEstimateResponse, 'resolvedQty' | 'resolvedUnit' | 'resolvedAmount'>,
): { qty: number; unit: string } | null {
  if (typeof r.resolvedQty === 'number' && r.resolvedUnit?.trim()) {
    return { qty: r.resolvedQty, unit: r.resolvedUnit.trim() }
  }
  const str = r.resolvedAmount?.trim()
  return str ? parseResolvedAmount(str) : null
}

function getResolvedStr(
  r: Pick<MacroEstimateResponse, 'resolvedQty' | 'resolvedUnit' | 'resolvedAmount'>,
): string | null {
  if (typeof r.resolvedQty === 'number' && r.resolvedUnit?.trim()) {
    return `${r.resolvedQty} ${r.resolvedUnit.trim()}`
  }
  return r.resolvedAmount?.trim() || null
}

export function resolveMacroEstimate(
  response: MacroEstimateResponse,
  foods: MacroCustomFood[],
  fatSecretResults: FatSecretFoodRef[] = [],
  options?: ResolveMacroEstimateOptions,
): MacroEstimateResult {
  const displayPortion = resolveParserPortion({
    quantity: options?.quantity,
    unit: options?.unit,
    amount: options?.userAmount,
    consumption: options?.consumption ?? null,
    foodName: options?.foodName,
    userInput: options?.userInput,
  })

  const buildDisplayResult = (
    totalCal: number,
    totalPro: number,
    extras: Partial<MacroEstimateResult> = {},
  ): MacroEstimateResult => {
    if (displayPortion) {
      const { qty, unit } = displayPortion
      return {
        calories: Math.round(totalCal),
        protein: Math.round(totalPro * 10) / 10,
        servingType: unit,
        servingSize: 1,
        servingUnit: unit,
        servingMultiplier: qty,
        baseCalories: qty > 0 ? Math.round(totalCal / qty) : Math.round(totalCal),
        baseProtein: qty > 0 ? Math.round((totalPro / qty) * 10) / 10 : Math.round(totalPro * 10) / 10,
        ...extras,
      }
    }

    const mult = validNutritionMultiplier(response.multiplier) ?? 1
    const def = parseServingDefinition(response.servingType?.trim() || 'serving')
    return {
      calories: Math.round(totalCal),
      protein: Math.round(totalPro * 10) / 10,
      servingType: def.label,
      servingSize: def.servingSize,
      servingUnit: def.servingUnit,
      servingMultiplier: mult,
      baseCalories: Math.round(totalCal / mult),
      baseProtein: Math.round((totalPro / mult) * 10) / 10,
      ...extras,
    }
  }

  const libIdx = parseIndex(response.libraryIndex)
  if (libIdx !== null && libIdx >= 1 && libIdx <= foods.length) {
    const food = foods[libIdx - 1]!
    let nutritionMult = validNutritionMultiplier(response.multiplier)
    if (nutritionMult === null && displayPortion && response.relationshipV7) {
      const v8 = computeV8Multiplier({
        quantity: displayPortion.qty,
        unit: displayPortion.unit,
        relationship: response.relationshipV7,
        servingDescription: food.baseAmount || '1 serving',
        unitsPerServing: response.unitsPerServing,
      })
      nutritionMult = v8.multiplier
      // V7 NEEDS_ESTIMATE fallback for stored snapshots
      if (nutritionMult === null && response.estimateQuantity != null) {
        nutritionMult = computeV7Multiplier({
          quantity: displayPortion.qty,
          unit: displayPortion.unit,
          relationship: response.relationshipV7 as 'NEEDS_ESTIMATE',
          servingDescription: food.baseAmount || '1 serving',
          estimateQuantity: response.estimateQuantity,
          estimateUnit: response.estimateUnit,
        })
      }
    }
    // Hard invariant: never invent multiplier from user quantity when bridge failed.
    if (nutritionMult === null && response.relationshipV7 === 'NEEDS_UNIT_BRIDGE') {
      return buildDisplayResult(0, 0, { libraryFoodId: food.id })
    }
    nutritionMult =
      nutritionMult ??
      (displayPortion ? resolveDbMultiplier(displayPortion, food.baseAmount || '1 serving') : null)
    if (nutritionMult === null) {
      return buildDisplayResult(0, 0, { libraryFoodId: food.id })
    }
    const scaled = scaleLibraryMacros(food, nutritionMult)
    return buildDisplayResult(scaled.calories, scaled.protein, { libraryFoodId: food.id })
  }

  const fsIdx = parseIndex(response.fatSecretIndex)
  if (fsIdx !== null && fsIdx >= 1 && fsIdx <= fatSecretResults.length) {
    const food = fatSecretResults[fsIdx - 1]!
    const servIdx = parseIndex(response.servingIndex)
    const serving =
      servIdx !== null && servIdx >= 1 && servIdx <= food.servings.length
        ? food.servings[servIdx - 1]!
        : food.servings.find((s) => s.isDefault) ?? food.servings[0]!

    const effectiveDesc = effectiveFatSecretServingDescription(food, serving)

    let nutritionMult: number | null = null
    if (response.relationshipV7) {
      const v8 = computeV8Multiplier({
        quantity: displayPortion?.qty ?? options?.quantity ?? 1,
        unit: displayPortion?.unit ?? options?.unit ?? 'serving',
        relationship: response.relationshipV7,
        servingDescription: effectiveDesc,
        unitsPerServing: response.unitsPerServing,
      })
      nutritionMult = v8.multiplier
      if (nutritionMult === null && response.estimateQuantity != null) {
        nutritionMult = computeV7Multiplier({
          quantity: displayPortion?.qty ?? options?.quantity ?? 1,
          unit: displayPortion?.unit ?? options?.unit ?? 'serving',
          relationship: response.relationshipV7 as 'NEEDS_ESTIMATE',
          servingDescription: effectiveDesc,
          estimateQuantity: response.estimateQuantity,
          estimateUnit: response.estimateUnit,
        })
      }
    }
    if (nutritionMult === null) {
      nutritionMult = validNutritionMultiplier(response.multiplier)
    }
    // Hard invariant: never treat userQuantity as databaseServingMultiplier.
    if (nutritionMult === null && response.relationshipV7 === 'NEEDS_UNIT_BRIDGE') {
      return buildDisplayResult(0, 0)
    }
    if (nutritionMult !== null) {
      const scaled = scaleFatSecretServing(serving, nutritionMult)
      return buildDisplayResult(scaled.calories, scaled.protein)
    }

    // Legacy V5 fallback when stored snapshot lacks AI multiplier / V7 relationship
    const legacyMult =
      displayPortion &&
      (computeMacroMultiplier(
        displayPortion,
        effectiveDesc,
        response.relationship,
        response.normalizedEstimate,
      ) ??
        resolveDbMultiplier(displayPortion, effectiveDesc))
    if (legacyMult != null) {
      const scaled = scaleFatSecretServing(serving, legacyMult)
      return buildDisplayResult(scaled.calories, scaled.protein)
    }

    const fallbackMult = resolveCountServingMultiplier(options?.userAmount, effectiveDesc, response.multiplier)
    const scaled = scaleFatSecretServing(serving, fallbackMult)
    return buildDisplayResult(scaled.calories, scaled.protein)
  }

  // Direct AI estimate
  const calories = Math.round(response.calories ?? 0)
  const protein = Math.round((response.protein ?? 0) * 10) / 10
  return buildDisplayResult(calories, protein)
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

    // When a resolved portion is present, compute actual DB multiplier for accurate audit total
    const resolvedParsed = getResolvedParsed(snap)
    const resolvedStr = getResolvedStr(snap)
    const auditMult =
      resolvedParsed !== null
        ? (resolveDbMultiplier(resolvedParsed, serving.description) ?? mult)
        : mult

    const scaled = scaleFatSecretServing(serving, auditMult)
    const label = food.brandName ? `${food.brandName} ${food.name}`.trim() : food.name
    return {
      method: 'FatSecret match',
      summary: `${scaled.calories} cal · ${scaled.protein}g protein`,
      details: [
        { label: 'FatSecret #', value: String(fsIdx) },
        { label: 'Product', value: label },
        { label: 'Serving #', value: servIdx !== null ? String(servIdx) : 'default' },
        { label: 'Serving type', value: serving.description },
        ...(snap.relationshipV7 ? [{ label: 'Relationship', value: snap.relationshipV7 }] : []),
        ...(resolvedStr ? [{ label: 'Your portion', value: resolvedStr }] : []),
        { label: 'Quantity', value: formatMultiplier(auditMult) },
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

/** Display name from parser classification; library match uses the library entry. */
export function macroItemDisplayName(
  item: {
    name: string
    parseSnapshot?: MacroParseSnapshot
    libraryFoodId?: string
  },
  customFoods: MacroCustomFood[] = [],
): string {
  if (item.libraryFoodId) {
    const food = customFoods.find((f) => f.id === item.libraryFoodId)
    if (food?.name?.trim()) return stripLeadingEmojiFromName(food.name.trim())
  }
  const raw = item.parseSnapshot?.name?.trim() || item.name
  return stripLeadingEmojiFromName(raw)
}

export function macroItemDisplayEmoji(
  item: {
    emoji?: string
    parseSnapshot?: MacroParseSnapshot
    libraryFoodId?: string
  },
  customFoods: MacroCustomFood[] = [],
): string {
  if (item.libraryFoodId) {
    const food = customFoods.find((f) => f.id === item.libraryFoodId)
    if (food?.emoji?.trim()) return parseAiEmoji(food.emoji)
  }
  return parseAiEmoji(item.parseSnapshot?.emoji || item.emoji)
}

/** One leading emoji grapheme (incl. ZWJ sequences). */
const LEADING_EMOJI_CLUSTER =
  /^(?:\p{Extended_Pictographic}(?:\uFE0F|\uFE0E)?(?:\u200D\p{Extended_Pictographic}(?:\uFE0F|\uFE0E)?)*)/u

/** Remove emoji prefix so the icon column is the only emoji on food cards. */
export function stripLeadingEmojiFromName(name: string): string {
  let rest = name.trimStart()
  if (!rest) return name.trim()
  let prev = ''
  while (rest !== prev) {
    prev = rest
    const m = rest.match(LEADING_EMOJI_CLUSTER)
    if (!m) break
    rest = rest.slice(m[0].length).trimStart()
    rest = rest.replace(/^[\s.,\-–—]+/, '').trimStart()
  }
  return rest.length > 0 ? rest : name.trim()
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

/** Normalize AI/parser name + emoji: single emoji, no duplicate emoji in name. */
export function normalizeDiaryLabel(input: {
  name?: unknown
  emoji?: unknown
  fallbackName: string
  fallbackEmoji?: string
}): { name: string; emoji: string } {
  const fallbackEmoji = input.fallbackEmoji ?? '🍱'
  const emoji = parseAiEmoji(input.emoji, fallbackEmoji)
  const fallbackTrimmed = input.fallbackName.trim() || 'Food'
  const rawName = typeof input.name === 'string' ? input.name.trim() : ''
  let name = rawName
    ? parseAiDiaryName(rawName, fallbackTrimmed)
    : parseAiDiaryName(fallbackTrimmed, fallbackTrimmed)
  name = stripLeadingEmojiFromName(name)
  if (!name) {
    name = stripLeadingEmojiFromName(parseAiDiaryName(fallbackTrimmed, fallbackTrimmed))
  }
  if (!name) name = parseAiDiaryName(fallbackTrimmed, fallbackTrimmed)
  return { name, emoji }
}

export function normalizeMacroCustomFood(food: MacroCustomFood): MacroCustomFood {
  const label = normalizeDiaryLabel({
    name: food.name,
    emoji: food.emoji,
    fallbackName: food.name,
    fallbackEmoji: food.emoji,
  })
  if (label.name === food.name && label.emoji === (food.emoji || '🍱')) return food
  return { ...food, name: label.name, emoji: label.emoji }
}

function normalizeStoredMacroDayItem(item: MacroDayItem): MacroDayItem {
  const emoji = parseAiEmoji(item.emoji ?? item.parseSnapshot?.emoji)
  let name = stripLeadingEmojiFromName(item.name)
  let parseSnapshot = item.parseSnapshot
  let changed = name !== item.name || emoji !== (item.emoji || '🍱')

  if (parseSnapshot) {
    const snapName = stripLeadingEmojiFromName(parseSnapshot.name)
    const snapEmoji = parseAiEmoji(parseSnapshot.emoji, emoji)
    if (snapName !== parseSnapshot.name || snapEmoji !== parseSnapshot.emoji) {
      parseSnapshot = { ...parseSnapshot, name: snapName, emoji: snapEmoji }
      changed = true
    }
  }

  if (!changed) return item
  return { ...item, name, emoji, parseSnapshot }
}

export function normalizeMacroCustomFoodsOnLoad(
  foods: MacroCustomFood[],
): { foods: MacroCustomFood[]; changed: boolean } {
  let changed = false
  const next = foods.map((f) => {
    const n = normalizeMacroCustomFood(f)
    if (n !== f) changed = true
    return n
  })
  return { foods: changed ? next : foods, changed }
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

export function parseSnapshotFromItem(
  it: ParsedFoodItem,
  context?: { userInput?: string },
): MacroParseSnapshot {
  const fallbackName = (it.name || '').trim() || 'Food'
  const { name, emoji } = normalizeDiaryLabel({
    name: it.name,
    emoji: it.emoji,
    fallbackName,
  })
  const foodCtx = { name, userInput: context?.userInput }
  const amountText = (it.amountText || it.amount || '').trim()

  const unitSingular =
    (typeof it.unitSingular === 'string' && it.unitSingular.trim()) ||
    (typeof it.unit === 'string' && it.unit.trim()) ||
    ''
  const unitPlural =
    (typeof it.unitPlural === 'string' && it.unitPlural.trim()) || unitSingular

  const portion = resolveParserPortion({
    quantity: it.quantity,
    unit: unitSingular || it.unit,
    amount: amountText,
    consumption: it.consumption ?? null,
    foodName: name,
    userInput: context?.userInput,
  })

  const quantity = portion?.qty ?? (isValidPositiveNumber(it.quantity) ? it.quantity : 1)
  const singular = portion?.unit ?? (unitSingular || 'serving')
  const plural = unitPlural || singular
  const unit = displayUnitForQuantity(quantity, singular, plural)
  const amount = formatQuantityUnitDisplay(quantity, singular, plural)

  // amountText path no longer needs foodCtx after V8 display helper
  void foodCtx
  void amountText
  void enrichAmountText

  const fatSecretSearch = it.fatSecretSearch?.trim() || undefined
  const unitFamily = isValidUnitFamily(it.unitFamily) ? it.unitFamily : undefined
  const estimated = typeof it.estimated === 'boolean' ? it.estimated : undefined
  const originalPortion =
    typeof it.originalPortion === 'string' && it.originalPortion.trim()
      ? it.originalPortion.trim()
      : undefined
  return {
    emoji,
    name,
    quantity,
    unit,
    unitSingular: singular,
    unitPlural: plural,
    unitFamily,
    estimated,
    originalPortion,
    amount,
    notes: it.notes?.trim() || undefined,
    fatSecretSearch,
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

/** Item already has macro data from a prior estimate or manual save. */
export function macroDayItemHasStoredMacros(item: MacroDayItem): boolean {
  if (item.status === 'ready') return true
  if (item.libraryFoodId || item.macroEstimateSnapshot) return true
  if (item.baseCalories != null || item.baseProtein != null) return true
  if ((item.calories ?? 0) > 0 || (item.protein ?? 0) > 0) return true
  if (item.fromBarcode) return true
  return false
}

/** Pending/editing_raw item still waiting on its first macro estimate. */
export function macroDayItemNeedsEstimate(item: MacroDayItem): boolean {
  if (!item.name?.trim()) return false
  if (macroDayItemHasStoredMacros(item)) return false
  return item.status === 'pending' || item.status === 'editing_raw'
}

/** Heal stale statuses without wiping saved macro values. */
export function normalizeMacroDayItemStatus(item: MacroDayItem): MacroDayItem {
  if (!item.name?.trim() || item.status === 'ready') return item
  if (macroDayItemHasStoredMacros(item)) {
    return { ...item, status: 'ready' as const }
  }
  if (item.status === 'editing_raw') {
    return { ...item, status: 'pending' as const }
  }
  return item
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
      const statusNorm = normalizeMacroDayItemStatus(item)
      if (statusNorm !== item) {
        changed = true
        nextItem = statusNorm
      }
      const backfilled = backfillMacroItemServingFields(nextItem, customFoods)
      if (macroItemServingBackfillChanged(nextItem, backfilled)) {
        changed = true
        nextItem = backfilled
      }
      const normalized = normalizeStoredMacroDayItem(nextItem)
      if (normalized !== nextItem) {
        changed = true
        nextItem = normalized
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

export function parsedItemToDayItem(
  it: ParsedFoodItem,
  overrides: Partial<MacroDayItem> = {},
): MacroDayItem {
  const snap = parseSnapshotFromItem(it, { userInput: overrides.userInput })
  return {
    id: crypto.randomUUID(),
    emoji: snap.emoji,
    name: snap.name,
    amount: snap.amount,
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
