import type { ConsumptionPortion } from '../../features/macro/macroAiSchemas'
import type { FatSecretFoodRef, FatSecretServingRef, MacroCustomFood } from '../../types/domain'
import { parseDbServingDescription } from '../../features/macro/macroMass'
import {
  effectiveFatSecretServingDescription,
} from '../../features/macro/macroServingResolve'
import { resolveMacroEstimate, resolveParserPortion, type MacroEstimateResponse } from '../../features/macro/macroLib'

export type ServingPipelineTrace = {
  /** V6 parser quantity */
  parserQuantity: number | null
  /** V6 parser unit */
  parserUnit: string
  /** @deprecated V5 */
  consumption: ConsumptionPortion | null
  selectedFood: FatSecretFoodRef | null
  selectedServing: FatSecretServingRef | null
  effectiveServingDescription: string
  dbServingQty: number | null
  dbServingUnit: string
  /** AI #2 multiplier (V6 primary) */
  aiMultiplier: number | null
  /** @deprecated V5 relationship classification */
  relationship: string
  /** @deprecated V5 normalized estimate */
  normalizedEstimate: MacroEstimateResponse['normalizedEstimate']
  normalizedEstimatedLabel: string
  /** Legacy computed multiplier (V5 audit) */
  computedMultiplier: number | null
  result: ReturnType<typeof resolveMacroEstimate> | null
}

export function buildServingPipelineTrace(input: {
  /** V6 parser fields */
  quantity?: number
  unit?: string
  /** @deprecated V5 */
  consumption?: ConsumptionPortion | null | undefined
  userAmount: string
  foodName?: string
  userInput?: string
  macroSnap?: MacroEstimateResponse | null
  selectedFood: FatSecretFoodRef | null
  selectedServing: FatSecretServingRef | null
  customFoods: MacroCustomFood[]
  fatSecretResults: FatSecretFoodRef[]
}): ServingPipelineTrace {
  const portion = resolveParserPortion({
    quantity: input.quantity,
    unit: input.unit,
    amount: input.userAmount,
    consumption: input.consumption ?? null,
    foodName: input.foodName,
    userInput: input.userInput,
  })

  const selectedServing = input.selectedServing
  const effectiveServingDescription =
    input.selectedFood && selectedServing
      ? effectiveFatSecretServingDescription(input.selectedFood, selectedServing)
      : selectedServing?.description ?? ''

  const dbParts = effectiveServingDescription
    ? parseDbServingDescription(effectiveServingDescription)
    : null

  const aiMultiplier =
    typeof input.macroSnap?.multiplier === 'number' && input.macroSnap.multiplier > 0
      ? input.macroSnap.multiplier
      : null

  const result = input.macroSnap
    ? resolveMacroEstimate(input.macroSnap, input.customFoods, input.fatSecretResults, {
        userAmount: input.userAmount,
        quantity: portion?.qty ?? input.quantity,
        unit: portion?.unit ?? input.unit,
        consumption: input.consumption ?? undefined,
        foodName: input.foodName,
        userInput: input.userInput,
      })
    : null

  const norm = input.macroSnap?.normalizedEstimate ?? null
  let normalizedEstimatedLabel = ''
  if (norm) {
    normalizedEstimatedLabel = norm.estimated ? 'yes' : 'no'
  } else if (input.macroSnap?.relationship === 'estimate_required') {
    normalizedEstimatedLabel = 'needed'
  }

  return {
    parserQuantity: portion?.qty ?? input.quantity ?? null,
    parserUnit: portion?.unit ?? input.unit ?? '',
    consumption: input.consumption ?? null,
    selectedFood: input.selectedFood,
    selectedServing,
    effectiveServingDescription,
    dbServingQty: dbParts?.qty ?? null,
    dbServingUnit: dbParts?.unit ?? '',
    aiMultiplier,
    relationship: input.macroSnap?.relationship ?? '',
    normalizedEstimate: norm,
    normalizedEstimatedLabel,
    computedMultiplier: aiMultiplier,
    result,
  }
}
