import type { MacroCustomFood, MacroDayItem } from '../../types/domain'
import { parseLeadingQuantity } from './macroMass'
import {
  normalizeDiaryLabel,
  parseServingDefinition,
  scaleLibraryMacros,
} from './macroLib'

export type PackagingFrontData = {
  name: string
  emoji: string
}

export type PackagingNutritionData = {
  baseAmount: string
  calories: number
  protein: number
  fat: number
  carbs: number
  /** Label “about N servings per container”; 0 when missing/unreadable. */
  servingsPerContainer: number
  /** Per-container column when printed; 0 if absent. */
  caloriesPerContainer: number
  /** Per-container protein when printed; 0 if absent. */
  proteinPerContainer: number
}

export type PackagingAmountResolve = {
  /** Provisional multiplier before container resolution. */
  multiplier: number
  /** Diary amount text (keeps phrases like “whole bag”). */
  amountLabel: string
  /** 1 = whole container, 0.5 = half, etc. Null when not a container phrase. */
  containerFraction: number | null
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

function containerPhraseError(example: string): Error {
  return new Error(
    `Could not read container servings — enter how many servings (e.g. "${example}")`,
  )
}

/**
 * Map Quick Scan amount text (e.g. "whole bag", "2 servings") onto a multiplier
 * of the nutrition-label base serving. Container phrases set containerFraction;
 * final multiplier is resolved later with label per-container data.
 */
export function resolvePackagingAmount(
  amountText: string,
  servingsPerContainer: number | null | undefined,
): PackagingAmountResolve {
  const raw = stripScanningPrefix(amountText) || '1 serving'
  const t = raw.toLowerCase().replace(/\s+/g, ' ').trim()
  const spc =
    typeof servingsPerContainer === 'number' &&
    Number.isFinite(servingsPerContainer) &&
    servingsPerContainer > 0
      ? servingsPerContainer
      : null

  const wholeRe = new RegExp(
    `^(?:the\\s+)?(?:whole|entire|full)(?:\\s+${CONTAINER_NOUN})?$`,
  )
  if (wholeRe.test(t) || t === 'all' || t === 'the whole thing') {
    return {
      multiplier: spc ?? 1,
      amountLabel: raw,
      containerFraction: 1,
    }
  }

  const halfRe = new RegExp(`^(?:a\\s+)?half(?:\\s+(?:a\\s+)?${CONTAINER_NOUN})?$`)
  if (halfRe.test(t)) {
    return {
      multiplier: spc != null ? spc / 2 : 0.5,
      amountLabel: raw,
      containerFraction: 0.5,
    }
  }

  const quarterRe = new RegExp(`^(?:a\\s+)?quarter(?:\\s+(?:of\\s+)?(?:a\\s+)?${CONTAINER_NOUN})?$`)
  if (quarterRe.test(t)) {
    return {
      multiplier: spc != null ? spc / 4 : 0.25,
      amountLabel: raw,
      containerFraction: 0.25,
    }
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
 * Resolve how many label servings a container phrase means.
 * Prefers per-container calorie column; sanitizes salad-kit style misreads
 * where a bulky cup serving is multiplied by servings-per-container.
 */
export function resolvePackagingMultiplier(
  nutrition: PackagingNutritionData,
  resolved: PackagingAmountResolve,
): number {
  if (resolved.containerFraction == null) {
    return resolved.multiplier > 0 ? resolved.multiplier : 1
  }

  const fraction = resolved.containerFraction

  if (nutrition.caloriesPerContainer > 0 && nutrition.calories > 0) {
    const implied = nutrition.caloriesPerContainer / nutrition.calories
    if (Number.isFinite(implied) && implied > 0) {
      return implied * fraction
    }
  }

  const spc = nutrition.servingsPerContainer
  if (!(spc > 0)) {
    throw containerPhraseError(fraction === 1 ? '3 servings' : '1.5 servings')
  }

  // Large cup “serving size” on bagged salad kits is usually one prepared portion
  // of the bag — multiplying by SPC double-counts package yield.
  const def = parseServingDefinition(nutrition.baseAmount)
  const bulkyCupServing = /cups?/i.test(def.servingUnit) && def.servingSize >= 3
  if (bulkyCupServing && spc >= 2) {
    return fraction
  }

  return spc * fraction
}

export function parsePackagingFront(data: Record<string, unknown> | null | undefined): PackagingFrontData {
  if (!data || typeof data !== 'object') throw new Error('Front package photo failed')
  const name = typeof data.name === 'string' ? data.name.trim() : ''
  if (!name) throw new Error('Could not read product name from front photo')
  const emoji = typeof data.emoji === 'string' && data.emoji.trim() ? data.emoji.trim() : '🥗'
  return { name, emoji }
}

function nonNegNumber(raw: unknown, fallback = 0): number {
  const n = Number(raw)
  return Number.isFinite(n) && n >= 0 ? n : fallback
}

export function parsePackagingNutrition(
  data: Record<string, unknown> | null | undefined,
): PackagingNutritionData {
  if (!data || typeof data !== 'object') throw new Error('Nutrition label photo failed')
  const baseAmount =
    typeof data.baseAmount === 'string' && data.baseAmount.trim()
      ? data.baseAmount.trim()
      : '1 serving'
  const calories = Number(data.calories)
  const protein = Number(data.protein)
  if (!Number.isFinite(calories) || calories < 0) throw new Error('Could not read calories from label')
  if (!Number.isFinite(protein) || protein < 0) throw new Error('Could not read protein from label')

  let servingsPerContainer = nonNegNumber(data.servingsPerContainer)
  const caloriesPerContainer = nonNegNumber(data.caloriesPerContainer)
  const proteinPerContainer = nonNegNumber(data.proteinPerContainer)

  // Prefer SPC implied by per-container / per-serving when both columns exist.
  if (caloriesPerContainer > 0 && calories > 0) {
    const implied = caloriesPerContainer / calories
    if (Number.isFinite(implied) && implied > 0) {
      const rounded = Math.round(implied * 100) / 100
      if (servingsPerContainer <= 0 || Math.abs(servingsPerContainer - implied) > 0.35) {
        servingsPerContainer = rounded
      }
    }
  }

  return {
    baseAmount,
    calories,
    protein: Number.isFinite(protein) ? protein : 0,
    fat: nonNegNumber(data.fat),
    carbs: nonNegNumber(data.carbs),
    servingsPerContainer,
    caloriesPerContainer,
    proteinPerContainer,
  }
}

export function buildPackagingDayItem(input: {
  id: string
  amountText: string
  front: PackagingFrontData
  nutrition: PackagingNutritionData
  addToDatabase: boolean
  timestamp?: number
}): { item: MacroDayItem; libraryFood: MacroCustomFood | null } {
  const label = normalizeDiaryLabel({
    name: input.front.name,
    emoji: input.front.emoji,
    fallbackName: input.front.name || 'Food',
  })
  const resolved = resolvePackagingAmount(
    input.amountText,
    input.nutrition.servingsPerContainer || null,
  )
  const multiplier = resolvePackagingMultiplier(input.nutrition, resolved)
  const def = parseServingDefinition(input.nutrition.baseAmount)

  const scaled = scaleLibraryMacros(
    {
      id: 'tmp',
      name: label.name,
      calories: input.nutrition.calories,
      protein: input.nutrition.protein,
      fat: input.nutrition.fat,
      carbs: input.nutrition.carbs,
    },
    multiplier,
  )

  let finalCalories = scaled.calories
  let finalProtein = scaled.protein

  // Prefer explicit per-container column when logging a container fraction.
  if (
    resolved.containerFraction != null &&
    resolved.containerFraction > 0 &&
    input.nutrition.caloriesPerContainer > 0
  ) {
    finalCalories = Math.round(input.nutrition.caloriesPerContainer * resolved.containerFraction)
    if (input.nutrition.proteinPerContainer > 0) {
      finalProtein =
        Math.round(input.nutrition.proteinPerContainer * resolved.containerFraction * 10) / 10
    }
  }

  let libraryFood: MacroCustomFood | null = null
  let libraryFoodId: string | undefined
  if (input.addToDatabase) {
    libraryFood = {
      id: crypto.randomUUID(),
      name: label.name,
      emoji: label.emoji,
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
    name: label.name,
    emoji: label.emoji,
    amount: resolved.amountLabel,
    calories: finalCalories,
    protein: finalProtein,
    servingType: def.label,
    servingSize: def.servingSize,
    servingUnit: def.servingUnit,
    servingMultiplier: multiplier,
    baseCalories: input.nutrition.calories,
    baseProtein: input.nutrition.protein,
    libraryFoodId,
    fromPackagingScan: true,
    userInput: `Scanning: ${amountText}`,
    timestamp: input.timestamp ?? Date.now(),
  }

  return { item, libraryFood }
}
