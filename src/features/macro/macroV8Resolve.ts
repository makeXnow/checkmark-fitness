/**
 * V8 deterministic serving multiplier.
 * AI chooses meaning; AI #3 may supply unitsPerServing; code does all arithmetic.
 */
import type { FatSecretFoodRef, FatSecretServingRef } from '../../types/domain'
import type { UnitFamily, V8ServingRelationship } from './macroAiSchemas'
import {
  parseDbCountServing,
  resolveDbMultiplier,
  resolveExactConvertibleMultiplier,
  roundMultiplier,
} from './macroMass'
import { effectiveFatSecretServingDescription } from './macroServingResolve'

export type V8MultiplierInput = {
  quantity: number
  unit: string
  relationship: V8ServingRelationship
  servingDescription: string
  /** From AI #3: how many user-units are in ONE database serving. */
  unitsPerServing?: number | null
}

export type V8MultiplierResult = {
  multiplier: number | null
  /** True when exact mass/volume/identical-count conversion succeeded without AI #3. */
  deterministicOk: boolean
  /** True when multiplier came from userQuantity / unitsPerServing. */
  usedUnitBridge: boolean
}

/**
 * Hard invariant: never treat userQuantity as the database serving multiplier
 * when the relationship is unresolved and no valid unitsPerServing exists.
 */
export function computeV8Multiplier(input: V8MultiplierInput): V8MultiplierResult {
  const { quantity, unit, relationship, servingDescription, unitsPerServing } = input
  if (!Number.isFinite(quantity) || quantity <= 0) {
    return { multiplier: null, deterministicOk: false, usedUnitBridge: false }
  }
  const desc = servingDescription.trim()
  if (!desc) {
    return { multiplier: null, deterministicOk: false, usedUnitBridge: false }
  }

  // Exact arithmetic always beats AI #2 classification.
  const exact = resolveExactConvertibleMultiplier({ qty: quantity, unit }, desc)
  if (exact != null) {
    return { multiplier: exact, deterministicOk: true, usedUnitBridge: false }
  }

  switch (relationship) {
    case 'DIRECT': {
      const m = resolveDbMultiplier({ qty: quantity, unit }, desc)
      return { multiplier: m, deterministicOk: m != null, usedUnitBridge: false }
    }
    case 'EQUIVALENT_COUNT': {
      const db = parseDbCountServing(desc)
      if (!db || db.qty <= 0) {
        return { multiplier: null, deterministicOk: false, usedUnitBridge: false }
      }
      return {
        multiplier: roundMultiplier(quantity / db.qty),
        deterministicOk: true,
        usedUnitBridge: false,
      }
    }
    case 'WHOLE_ITEM': {
      const db = parseDbCountServing(desc)
      const wholeQty = db?.qty && db.qty > 0 ? db.qty : 1
      return {
        multiplier: roundMultiplier(quantity / wholeQty),
        deterministicOk: true,
        usedUnitBridge: false,
      }
    }
    case 'NEEDS_UNIT_BRIDGE': {
      if (
        typeof unitsPerServing !== 'number' ||
        !Number.isFinite(unitsPerServing) ||
        unitsPerServing <= 0
      ) {
        // Structurally refuse userQuantity-as-multiplier fallback.
        return { multiplier: null, deterministicOk: false, usedUnitBridge: false }
      }
      return {
        multiplier: roundMultiplier(quantity / unitsPerServing),
        deterministicOk: false,
        usedUnitBridge: true,
      }
    }
    case 'WRONG_MATCH':
    case 'NEED_MORE_CANDIDATES':
      return { multiplier: null, deterministicOk: false, usedUnitBridge: false }
    default:
      return { multiplier: null, deterministicOk: false, usedUnitBridge: false }
  }
}

export function computeV8MultiplierForServing(
  input: Omit<V8MultiplierInput, 'servingDescription'> & {
    food: FatSecretFoodRef
    serving: FatSecretServingRef
  },
): V8MultiplierResult {
  const desc = effectiveFatSecretServingDescription(input.food, input.serving)
  return computeV8Multiplier({ ...input, servingDescription: desc })
}

/** Display unit: singular when quantity is effectively 1, else plural. */
export function displayUnitForQuantity(
  quantity: number,
  unitSingular: string,
  unitPlural: string,
): string {
  const singular = unitSingular.trim() || 'serving'
  const plural = unitPlural.trim() || singular
  if (Math.abs(quantity - 1) < 1e-9) return singular
  return plural
}

export function formatQuantityUnitDisplay(
  quantity: number,
  unitSingular: string,
  unitPlural: string,
): string {
  const unit = displayUnitForQuantity(quantity, unitSingular, unitPlural)
  const q =
    Number.isInteger(quantity) || Math.abs(quantity - Math.round(quantity)) < 1e-9
      ? String(Math.round(quantity))
      : String(Math.round(quantity * 1000) / 1000)
  return `${q} ${unit}`
}

/**
 * Build the narrow real-world question for AI #3.
 * Asks how many user-units are in ONE selected database serving.
 */
export function buildUnitBridgeQuestion(input: {
  foodName: string
  brandName?: string | null
  servingDescription: string
  unitSingular: string
  unitPlural: string
  unitFamily?: UnitFamily
}): string {
  const food = [input.brandName?.trim(), input.foodName.trim()].filter(Boolean).join(' ').trim()
  const serving = input.servingDescription.trim()
  const family = input.unitFamily
  const singular = input.unitSingular.trim()
  const plural = input.unitPlural.trim() || singular

  let userUnitsAsk: string
  if (family === 'count' || (!family && !/^(g|oz|lb|tsp|tbsp|cup|ml)$/i.test(singular))) {
    userUnitsAsk = `individual ${plural}`
  } else if (family === 'mass' || /^(g|grams?|oz|ounces?|lb|lbs)$/i.test(singular)) {
    userUnitsAsk = plural
  } else if (family === 'volume' || /^(tsp|tbsp|cups?|ml)$/i.test(singular)) {
    userUnitsAsk = plural
  } else {
    userUnitsAsk = plural
  }

  return `How many ${userUnitsAsk} are represented by ${serving} of ${food}?`
}
