import type { MacroDayItem } from '../../types/domain'
import type { MacroFoodEditFields } from './MacroFoodCard'
import { libraryMeasurement } from './foodLibrary'
import { buildDayItemServingFields, macroDayItemHasStoredMacros, scaleFatSecretServing } from './macroLib'

export function canCopyDiaryFood(item: MacroDayItem): boolean {
  return Boolean(item.name?.trim()) && (!item.status || item.status === 'ready') && macroDayItemHasStoredMacros(item)
}

export function copyDiaryFood(item: MacroDayItem): MacroDayItem {
  return {
    ...structuredClone(item),
    id: crypto.randomUUID(),
    status: 'ready',
    timestamp: Date.now(),
    estimateError: undefined,
    audioPending: undefined,
    barcodeLookup: undefined,
  }
}

/** Share the same portion conversion for single-food logging and bulk copying. */
export function libraryFoodDayItem(libraryFoodId: string, fields: MacroFoodEditFields): MacroDayItem {
  const measurement = libraryMeasurement(fields.amount)
  const baseLabel = measurement ? `1 ${measurement.unit}` : fields.amount.trim() || '1 serving'
  const mult =
    (typeof fields.servingMultiplier === 'number' && fields.servingMultiplier > 0 ? fields.servingMultiplier : 1)
    * (measurement?.quantity ?? 1)
  const baseCalories = (fields.calories ?? 0) / (measurement?.quantity ?? 1)
  const baseProtein = (fields.protein ?? 0) / (measurement?.quantity ?? 1)
  const scaled = scaleFatSecretServing({ calories: baseCalories, protein: baseProtein }, mult)
  return {
    id: crypto.randomUUID(),
    emoji: fields.emoji || '🍱',
    name: fields.name,
    ...buildDayItemServingFields(mult, { servingType: baseLabel }),
    baseCalories,
    baseProtein,
    calories: scaled.calories,
    protein: scaled.protein,
    libraryFoodId,
    status: 'ready',
    timestamp: Date.now(),
  }
}
