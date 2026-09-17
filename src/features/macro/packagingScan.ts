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
}

export type PackagingAmountResolve = {
  /** How many label base servings were eaten. */
  multiplier: number
  /** Diary amount text (keeps phrases like “whole bag” when useful). */
  amountLabel: string
  usedContainerServings: boolean
}

const CONTAINER_NOUN =
  '(?:bag|container|package|pack|box|bottle|pouch|tub|jar|can|tray|sleeve|salad)s?'

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
 * Map Quick Scan amount text (e.g. "whole bag", "2 servings") onto a multiplier
 * of the nutrition-label base serving.
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
    if (!spc) {
      throw new Error(
        'Could not read servings per container — enter how many servings (e.g. "3 servings")',
      )
    }
    return { multiplier: spc, amountLabel: raw, usedContainerServings: true }
  }

  const halfRe = new RegExp(`^(?:a\\s+)?half(?:\\s+(?:a\\s+)?${CONTAINER_NOUN})?$`)
  if (halfRe.test(t)) {
    if (!spc) {
      throw new Error(
        'Could not read servings per container — enter how many servings (e.g. "1.5 servings")',
      )
    }
    return { multiplier: spc / 2, amountLabel: raw, usedContainerServings: true }
  }

  const quarterRe = new RegExp(`^(?:a\\s+)?quarter(?:\\s+(?:of\\s+)?(?:a\\s+)?${CONTAINER_NOUN})?$`)
  if (quarterRe.test(t)) {
    if (!spc) {
      throw new Error(
        'Could not read servings per container — enter how many servings (e.g. "1 serving")',
      )
    }
    return { multiplier: spc / 4, amountLabel: raw, usedContainerServings: true }
  }

  const servingsMatch = t.match(
    /^((?:\d+\s+\d+\/\d+)|(?:\d+\/\d+)|(?:\d+(?:\.\d+)?)|½|¼|¾|⅓|⅔)\s*servings?$/,
  )
  if (servingsMatch) {
    const n = parseLooseQuantity(servingsMatch[1]!)
    if (n != null && n > 0) {
      return { multiplier: n, amountLabel: raw, usedContainerServings: false }
    }
  }

  const bare = parseLooseQuantity(t)
  if (bare != null && bare > 0 && /^[\d½¼¾⅓⅔./\s]+$/.test(t)) {
    return { multiplier: bare, amountLabel: `${bare} serving${bare === 1 ? '' : 's'}`, usedContainerServings: false }
  }

  // Default: one label serving (same as empty / "1 serving")
  if (/^(1\s+)?servings?$/.test(t) || t === 'one serving') {
    return { multiplier: 1, amountLabel: raw, usedContainerServings: false }
  }

  // Unrecognized phrase without container math — still log one base serving; keep user text.
  return { multiplier: 1, amountLabel: raw, usedContainerServings: false }
}

export function parsePackagingFront(data: Record<string, unknown> | null | undefined): PackagingFrontData {
  if (!data || typeof data !== 'object') throw new Error('Front package photo failed')
  const name = typeof data.name === 'string' ? data.name.trim() : ''
  if (!name) throw new Error('Could not read product name from front photo')
  const emoji = typeof data.emoji === 'string' && data.emoji.trim() ? data.emoji.trim() : '🥗'
  return { name, emoji }
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
  const fat = Number(data.fat)
  const carbs = Number(data.carbs)
  if (!Number.isFinite(calories) || calories < 0) throw new Error('Could not read calories from label')
  if (!Number.isFinite(protein) || protein < 0) throw new Error('Could not read protein from label')
  const servingsRaw = Number(data.servingsPerContainer)
  const servingsPerContainer =
    Number.isFinite(servingsRaw) && servingsRaw > 0 ? servingsRaw : 0
  return {
    baseAmount,
    calories,
    protein: Number.isFinite(protein) ? protein : 0,
    fat: Number.isFinite(fat) && fat >= 0 ? fat : 0,
    carbs: Number.isFinite(carbs) && carbs >= 0 ? carbs : 0,
    servingsPerContainer,
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
    resolved.multiplier,
  )

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
    calories: scaled.calories,
    protein: scaled.protein,
    servingType: def.label,
    servingSize: def.servingSize,
    servingUnit: def.servingUnit,
    servingMultiplier: resolved.multiplier,
    baseCalories: input.nutrition.calories,
    baseProtein: input.nutrition.protein,
    libraryFoodId,
    fromPackagingScan: true,
    userInput: `Scanning: ${amountText}`,
    timestamp: input.timestamp ?? Date.now(),
  }

  return { item, libraryFood }
}
