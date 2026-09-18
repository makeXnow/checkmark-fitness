import type { MacroCustomFood, MacroDayItem, MacroPackagingSnapshot } from '../../types/domain'
import { parseLeadingQuantity } from './macroMass'
import {
  parseAiEmoji,
  parseServingDefinition,
  scaleLibraryMacros,
  stripLeadingEmojiFromName,
} from './macroLib'

export type PackagingFrontData = {
  name: string
  emoji: string
}

/** Nutrition-label form. Optional label lines are null when not printed. */
export type PackagingNutritionData = {
  baseAmount: string
  calories: number
  protein: number
  fat: number
  carbs: number
  servingsPerContainer: number | null
  caloriesPerContainer: number | null
  proteinPerContainer: number | null
  fatPerContainer: number | null
  carbsPerContainer: number | null
  /** Net / package amount when printed (e.g. "10 oz (284 g)"); null if absent. */
  packageAmount: string | null
}

export type PackagingAmountResolve = {
  multiplier: number
  amountLabel: string
  /** 1 = whole container, 0.5 = half, etc. Null when not a container phrase. */
  containerFraction: number | null
}

export type PackagingResolveMode =
  | 'per_container'
  | 'servings_per_container'
  | 'explicit_servings'
  | 'one_serving'

export type PackagingResolveResult = {
  multiplier: number
  amountLabel: string
  mode: PackagingResolveMode
  containerFraction: number | null
  calories: number
  protein: number
}

export class PackagingResolveError extends Error {
  front: PackagingFrontData
  nutrition: PackagingNutritionData
  amountText: string

  constructor(
    message: string,
    opts: { front: PackagingFrontData; nutrition: PackagingNutritionData; amountText: string },
  ) {
    super(message)
    this.name = 'PackagingResolveError'
    this.front = opts.front
    this.nutrition = opts.nutrition
    this.amountText = opts.amountText
  }
}

const CONTAINER_NOUN =
  '(?:bag|container|package|pack|box|bottle|pouch|tub|jar|can|tray|sleeve|salad|kit)s?'

function stripScanningPrefix(text: string): string {
  return text.replace(/^Scanning:\s*/i, '').trim()
}

function parseLooseQuantity(raw: string): number | null {
  const t = raw.trim().toLowerCase()
  if (!t) return null
  if (t === '½' || t === '1/2') return 0.5
  if (t === '¼' || t === '1/4') return 0.25
  if (t === '¾' || t === '3/4') return 0.75
  if (t === '⅓' || t === '1/3') return 1 / 3
  if (t === '⅔' || t === '2/3') return 2 / 3
  return parseLeadingQuantity(t)
}

/**
 * Map Quick Scan amount text onto a container fraction and/or explicit serving count.
 * Does not invent servings-per-container.
 */
export function resolvePackagingAmount(amountText: string): PackagingAmountResolve {
  const raw = stripScanningPrefix(amountText) || '1 serving'
  const t = raw.toLowerCase().replace(/\s+/g, ' ').trim()

  const wholeRe = new RegExp(
    `^(?:the\\s+)?(?:whole|entire|full)(?:\\s+${CONTAINER_NOUN})?$`,
  )
  if (wholeRe.test(t) || t === 'all' || t === 'the whole thing') {
    return { multiplier: 1, amountLabel: raw, containerFraction: 1 }
  }

  const halfRe = new RegExp(`^(?:a\\s+)?half(?:\\s+(?:a\\s+)?${CONTAINER_NOUN})?$`)
  if (halfRe.test(t)) {
    return { multiplier: 1, amountLabel: raw, containerFraction: 0.5 }
  }

  const quarterRe = new RegExp(`^(?:a\\s+)?quarter(?:\\s+(?:of\\s+)?(?:a\\s+)?${CONTAINER_NOUN})?$`)
  if (quarterRe.test(t)) {
    return { multiplier: 1, amountLabel: raw, containerFraction: 0.25 }
  }

  const servingsMatch = t.match(
    /^((?:\d+\s+\d+\/\d+)|(?:\d+\/\d+)|(?:\d+(?:\.\d+)?)|½|¼|¾|⅓|⅔)\s*servings?$/,
  )
  if (servingsMatch) {
    const n = parseLooseQuantity(servingsMatch[1]!)
    if (n != null && n > 0) {
      return { multiplier: n, amountLabel: raw, containerFraction: null }
    }
  }

  const bare = parseLooseQuantity(t)
  if (bare != null && bare > 0 && /^[\d½¼¾⅓⅔./\s]+$/.test(t)) {
    return {
      multiplier: bare,
      amountLabel: `${bare} serving${bare === 1 ? '' : 's'}`,
      containerFraction: null,
    }
  }

  if (/^(1\s+)?servings?$/.test(t) || t === 'one serving') {
    return { multiplier: 1, amountLabel: raw, containerFraction: null }
  }

  return { multiplier: 1, amountLabel: raw, containerFraction: null }
}

/**
 * Deterministic whole/half/quarter bag math from the label form.
 * Prefer per-container column; else servings×per-serving; else ask (throw).
 */
export function resolvePackagingConsumption(
  front: PackagingFrontData,
  nutrition: PackagingNutritionData,
  amountText: string,
): PackagingResolveResult {
  const resolved = resolvePackagingAmount(amountText)

  if (resolved.containerFraction == null) {
    const mult = resolved.multiplier > 0 ? resolved.multiplier : 1
    const scaled = scaleLibraryMacros(
      {
        id: 'tmp',
        name: front.name,
        calories: nutrition.calories,
        protein: nutrition.protein,
        fat: nutrition.fat,
        carbs: nutrition.carbs,
      },
      mult,
    )
    return {
      multiplier: mult,
      amountLabel: resolved.amountLabel,
      mode: mult === 1 ? 'one_serving' : 'explicit_servings',
      containerFraction: null,
      calories: scaled.calories,
      protein: scaled.protein,
    }
  }

  const fraction = resolved.containerFraction

  if (nutrition.caloriesPerContainer != null && nutrition.caloriesPerContainer > 0) {
    const calories = Math.round(nutrition.caloriesPerContainer * fraction)
    const protein =
      nutrition.proteinPerContainer != null && nutrition.proteinPerContainer > 0
        ? Math.round(nutrition.proteinPerContainer * fraction * 10) / 10
        : Math.round(
            nutrition.protein *
              (nutrition.caloriesPerContainer / Math.max(nutrition.calories, 1)) *
              fraction *
              10,
          ) / 10
    const multiplier =
      nutrition.calories > 0
        ? (nutrition.caloriesPerContainer / nutrition.calories) * fraction
        : fraction
    return {
      multiplier,
      amountLabel: resolved.amountLabel,
      mode: 'per_container',
      containerFraction: fraction,
      calories,
      protein,
    }
  }

  if (nutrition.servingsPerContainer != null && nutrition.servingsPerContainer > 0) {
    const multiplier = nutrition.servingsPerContainer * fraction
    const scaled = scaleLibraryMacros(
      {
        id: 'tmp',
        name: front.name,
        calories: nutrition.calories,
        protein: nutrition.protein,
        fat: nutrition.fat,
        carbs: nutrition.carbs,
      },
      multiplier,
    )
    return {
      multiplier,
      amountLabel: resolved.amountLabel,
      mode: 'servings_per_container',
      containerFraction: fraction,
      calories: scaled.calories,
      protein: scaled.protein,
    }
  }

  throw new PackagingResolveError(
    'Label has no servings-per-container or per-container calories — enter how many servings (e.g. "2 servings")',
    { front, nutrition, amountText },
  )
}

export function parsePackagingFront(data: Record<string, unknown> | null | undefined): PackagingFrontData {
  if (!data || typeof data !== 'object') throw new Error('Front package photo failed')
  const name = typeof data.name === 'string' ? data.name.trim() : ''
  if (!name) throw new Error('Could not read product name from front photo')
  const emoji = typeof data.emoji === 'string' && data.emoji.trim() ? data.emoji.trim() : '🥗'
  return { name, emoji }
}

function optionalNonNegNumber(raw: unknown): number | null {
  if (raw === null || raw === undefined) return null
  if (typeof raw === 'string' && !raw.trim()) return null
  const n = Number(raw)
  if (!Number.isFinite(n) || n < 0) return null
  // Treat 0 as absent for optional container fields (legacy / model filler).
  if (n === 0) return null
  return n
}

function requiredNonNegNumber(raw: unknown, label: string): number {
  const n = Number(raw)
  if (!Number.isFinite(n) || n < 0) throw new Error(`Could not read ${label} from label`)
  return n
}

function optionalAmountString(raw: unknown): string | null {
  if (raw === null || raw === undefined) return null
  if (typeof raw !== 'string') return null
  const t = raw.trim()
  return t ? t : null
}

const BOGUS_BASE_AMOUNTS = /^(unknown|n\/?a|none|null|undefined|unreadable|not\s*found|—|-)?$/i

export function parsePackagingNutrition(
  data: Record<string, unknown> | null | undefined,
): PackagingNutritionData {
  if (!data || typeof data !== 'object') throw new Error('Nutrition label photo failed')
  const baseAmount =
    typeof data.baseAmount === 'string' && data.baseAmount.trim()
      ? data.baseAmount.trim()
      : ''
  if (!baseAmount || BOGUS_BASE_AMOUNTS.test(baseAmount)) {
    throw new Error('Could not read nutrition label — retake a clearer photo of the facts panel')
  }
  const calories = requiredNonNegNumber(data.calories, 'calories')
  const protein = requiredNonNegNumber(data.protein, 'protein')
  // All-zero macros with a placeholder serving usually means the model failed to read the panel.
  if (calories === 0 && protein === 0) {
    throw new Error('Could not read nutrition label — retake a clearer photo of the facts panel')
  }

  return {
    baseAmount,
    calories,
    protein,
    fat: requiredNonNegNumber(data.fat ?? 0, 'fat'),
    carbs: requiredNonNegNumber(data.carbs ?? 0, 'carbs'),
    servingsPerContainer: optionalNonNegNumber(data.servingsPerContainer),
    caloriesPerContainer: optionalNonNegNumber(data.caloriesPerContainer),
    proteinPerContainer: optionalNonNegNumber(data.proteinPerContainer),
    fatPerContainer: optionalNonNegNumber(data.fatPerContainer),
    carbsPerContainer: optionalNonNegNumber(data.carbsPerContainer),
    packageAmount: optionalAmountString(data.packageAmount),
  }
}

export function toPackagingSnapshot(
  front: PackagingFrontData,
  nutrition: PackagingNutritionData,
  amountText: string,
  resolve?: Pick<PackagingResolveResult, 'multiplier' | 'mode'>,
  imageKeys?: { frontKey?: string; nutritionKey?: string },
): MacroPackagingSnapshot {
  return {
    name: front.name,
    emoji: front.emoji,
    baseAmount: nutrition.baseAmount,
    calories: nutrition.calories,
    protein: nutrition.protein,
    fat: nutrition.fat,
    carbs: nutrition.carbs,
    servingsPerContainer: nutrition.servingsPerContainer,
    caloriesPerContainer: nutrition.caloriesPerContainer,
    proteinPerContainer: nutrition.proteinPerContainer,
    fatPerContainer: nutrition.fatPerContainer,
    carbsPerContainer: nutrition.carbsPerContainer,
    packageAmount: nutrition.packageAmount,
    amountText: stripScanningPrefix(amountText) || '1 serving',
    resolvedMultiplier: resolve?.multiplier,
    resolveMode: resolve?.mode,
    frontImageKey: imageKeys?.frontKey,
    nutritionImageKey: imageKeys?.nutritionKey,
  }
}

export function nutritionFromPackagingSnapshot(snap: MacroPackagingSnapshot): PackagingNutritionData {
  return {
    baseAmount: snap.baseAmount,
    calories: snap.calories,
    protein: snap.protein,
    fat: snap.fat,
    carbs: snap.carbs,
    servingsPerContainer: snap.servingsPerContainer,
    caloriesPerContainer: snap.caloriesPerContainer,
    proteinPerContainer: snap.proteinPerContainer,
    fatPerContainer: snap.fatPerContainer ?? null,
    carbsPerContainer: snap.carbsPerContainer ?? null,
    packageAmount: snap.packageAmount,
  }
}

export function frontFromPackagingSnapshot(snap: MacroPackagingSnapshot): PackagingFrontData {
  return { name: snap.name, emoji: snap.emoji || '🥗' }
}

export function buildPackagingDayItem(input: {
  id: string
  amountText: string
  front: PackagingFrontData
  nutrition: PackagingNutritionData
  addToDatabase: boolean
  timestamp?: number
  imageKeys?: { frontKey?: string; nutritionKey?: string }
}): { item: MacroDayItem; libraryFood: MacroCustomFood | null } {
  const emoji = parseAiEmoji(input.front.emoji, '🥗')
  let name = stripLeadingEmojiFromName(String(input.front.name || '').trim())
  if (name.length > 40) name = name.slice(0, 40).trim()
  if (!name) name = 'Food'
  const front = { name, emoji }
  const consumption = resolvePackagingConsumption(front, input.nutrition, input.amountText)
  const def = parseServingDefinition(input.nutrition.baseAmount)
  const snapshot = toPackagingSnapshot(
    front,
    input.nutrition,
    input.amountText,
    consumption,
    input.imageKeys,
  )

  let libraryFood: MacroCustomFood | null = null
  let libraryFoodId: string | undefined
  if (input.addToDatabase) {
    libraryFood = {
      id: crypto.randomUUID(),
      name: front.name,
      emoji: front.emoji,
      baseAmount: input.nutrition.baseAmount,
      calories: input.nutrition.calories,
      protein: input.nutrition.protein,
      fat: input.nutrition.fat,
      carbs: input.nutrition.carbs,
      createdAt: Date.now(),
    }
    libraryFoodId = libraryFood.id
  }

  const amountText = stripScanningPrefix(input.amountText) || '1 serving'
  const item: MacroDayItem = {
    id: input.id,
    status: 'ready',
    name: front.name,
    emoji: front.emoji,
    amount: consumption.amountLabel,
    calories: consumption.calories,
    protein: consumption.protein,
    servingType: def.label,
    servingSize: def.servingSize,
    servingUnit: def.servingUnit,
    servingMultiplier: consumption.multiplier,
    baseCalories: input.nutrition.calories,
    baseProtein: input.nutrition.protein,
    libraryFoodId,
    fromPackagingScan: true,
    packagingSnapshot: snapshot,
    userInput: `Scanning: ${amountText}`,
    timestamp: input.timestamp ?? Date.now(),
  }

  return { item, libraryFood }
}

/** Partial day item when container math cannot close — keep the label form for retry. */
export function buildPackagingAskItem(input: {
  id: string
  error: PackagingResolveError
  timestamp?: number
  imageKeys?: { frontKey?: string; nutritionKey?: string }
}): MacroDayItem {
  const emoji = parseAiEmoji(input.error.front.emoji, '🥗')
  let name = stripLeadingEmojiFromName(String(input.error.front.name || '').trim())
  if (name.length > 40) name = name.slice(0, 40).trim()
  if (!name) name = 'Food'
  const front = { name, emoji }
  const amountText = stripScanningPrefix(input.error.amountText) || '1 serving'
  const snapshot = toPackagingSnapshot(front, input.error.nutrition, amountText)
  if (input.imageKeys?.frontKey) snapshot.frontImageKey = input.imageKeys.frontKey
  if (input.imageKeys?.nutritionKey) snapshot.nutritionImageKey = input.imageKeys.nutritionKey
  return {
    id: input.id,
    status: 'editing_raw',
    name: front.name,
    emoji: front.emoji,
    amount: '',
    rawText: input.error.message,
    fromPackagingScan: true,
    packagingSnapshot: snapshot,
    userInput: `Scanning: ${amountText}`,
    timestamp: input.timestamp ?? Date.now(),
  }
}

/**
 * Failure card that still keeps photo keys / any partial label form for debugging and retry.
 */
export function buildPackagingFailItem(input: {
  id: string
  message: string
  amountText: string
  front?: PackagingFrontData | null
  nutrition?: PackagingNutritionData | null
  imageKeys?: { frontKey?: string; nutritionKey?: string }
  timestamp?: number
}): MacroDayItem {
  const emoji = parseAiEmoji(input.front?.emoji, '🥗')
  let name = stripLeadingEmojiFromName(String(input.front?.name || '').trim())
  if (name.length > 40) name = name.slice(0, 40).trim()

  const amountText = stripScanningPrefix(input.amountText) || '1 serving'
  const nutrition: PackagingNutritionData = input.nutrition ?? {
    baseAmount: '',
    calories: 0,
    protein: 0,
    fat: 0,
    carbs: 0,
    servingsPerContainer: null,
    caloriesPerContainer: null,
    proteinPerContainer: null,
    fatPerContainer: null,
    carbsPerContainer: null,
    packageAmount: null,
  }
  const front = { name: name || 'Food', emoji }
  const snapshot = toPackagingSnapshot(front, nutrition, amountText, undefined, input.imageKeys)

  return {
    id: input.id,
    status: 'editing_raw',
    name: name || '',
    emoji,
    amount: '',
    rawText: input.message,
    fromPackagingScan: true,
    packagingSnapshot: snapshot,
    userInput: `Scanning: ${amountText}`,
    timestamp: input.timestamp ?? Date.now(),
  }
}
