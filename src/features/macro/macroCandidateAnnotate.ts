/**
 * Deterministic serving annotations for AI #2 (V9).
 * Code owns objective unit compatibility; AI owns semantic relationships.
 */
import type { FatSecretFoodRef } from '../../types/domain'
import {
  parseDbServingDescription,
  resolveExactConvertibleMultiplier,
} from './macroMass'
import { effectiveFatSecretServingDescription } from './macroServingResolve'

export type ServingUnitAnnotation = {
  foodName: string
  servingDescription: string
  servingIndex: number
  normalizedServingQuantity: number | null
  normalizedServingUnit: string | null
  deterministicUnitMatch: boolean
}

export type AnnotatedFatSecretCandidate = {
  foodIndex: number
  foodName: string
  brandName: string | null
  servings: ServingUnitAnnotation[]
}

/** Objective facts about one serving vs the user's unit. */
export function annotateServingForUserUnit(
  servingDescription: string,
  userUnit: string,
): Pick<
  ServingUnitAnnotation,
  'normalizedServingQuantity' | 'normalizedServingUnit' | 'deterministicUnitMatch'
> {
  const desc = servingDescription.trim()
  const parsed = desc ? parseDbServingDescription(desc) : null
  const unit = userUnit.trim()
  const deterministicUnitMatch =
    Boolean(desc && unit) &&
    resolveExactConvertibleMultiplier({ qty: 1, unit }, desc) != null
  return {
    normalizedServingQuantity: parsed?.qty ?? null,
    normalizedServingUnit: parsed?.unit ?? null,
    deterministicUnitMatch,
  }
}

export function annotateFatSecretCandidates(
  results: FatSecretFoodRef[],
  userUnit: string,
): AnnotatedFatSecretCandidate[] {
  return results.map((f, foodIndex) => {
    const foodName = f.brandName ? `${f.brandName} ${f.name}`.trim() : f.name
    return {
      foodIndex: foodIndex + 1,
      foodName: f.name,
      brandName: f.brandName ?? null,
      servings: f.servings.map((s, si) => {
        const servingDescription = effectiveFatSecretServingDescription(f, s)
        const ann = annotateServingForUserUnit(servingDescription, userUnit)
        return {
          foodName,
          servingDescription,
          servingIndex: si + 1,
          ...ann,
        }
      }),
    }
  })
}

/** 1-based numbered FatSecret list with pre-computed unit annotations for AI #2. */
export function formatNumberedFatSecretAnnotated(
  results: FatSecretFoodRef[],
  userUnit: string,
): string {
  if (results.length === 0) return ''
  const annotated = annotateFatSecretCandidates(results, userUnit)
  const lines = annotated.map((f) => {
    const label = f.brandName ? `${f.brandName} ${f.foodName}`.trim() : f.foodName
    const servingParts = f.servings
      .map((s) => {
        const food = results[f.foodIndex - 1]!
        const serving = food.servings[s.servingIndex - 1]!
        const cal = `${serving.calories} cal, ${serving.protein}g protein`
        return (
          `${s.servingIndex}) ${s.servingDescription}: ${cal}` +
          ` | normalizedServingQuantity=${s.normalizedServingQuantity ?? 'null'}` +
          ` | normalizedServingUnit=${s.normalizedServingUnit ?? 'null'}` +
          ` | deterministicUnitMatch=${s.deterministicUnitMatch}`
        )
      })
      .join('; ')
    return `${f.foodIndex}. ${label} | servings: ${servingParts}`
  })
  return `\n\nFATSECRET CANDIDATES (use fatSecretIndex + servingIndex + relationship — do NOT calculate a multiplier):\n${lines.join('\n')}`
}

export function formatNumberedFoodLibraryAnnotated(
  foods: Array<{ name: string; baseAmount?: string; calories: number; protein: number }>,
  userUnit: string,
): string {
  if (foods.length === 0) return ''
  const lines = foods.map((f, i) => {
    const base = f.baseAmount || '1 serving'
    const ann = annotateServingForUserUnit(base, userUnit)
    return (
      `${i + 1}. ${f.name} | base: ${base} | ${f.calories} cal | ${f.protein}g protein` +
      ` | normalizedServingQuantity=${ann.normalizedServingQuantity ?? 'null'}` +
      ` | normalizedServingUnit=${ann.normalizedServingUnit ?? 'null'}` +
      ` | deterministicUnitMatch=${ann.deterministicUnitMatch}`
    )
  })
  return `\n\nFOOD LIBRARY (use libraryIndex only when the item is essentially the same product as a library entry — not merely a shared ingredient):\n${lines.join('\n')}`
}
