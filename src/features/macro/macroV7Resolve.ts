/**
 * V7 deterministic multiplier calculation.
 * Exact mass/volume/identical-count math always wins over AI #2 classification.
 * AI #2 relationship is only used when code cannot convert directly.
 */
import type { FatSecretServingRef } from '../../types/domain'
/** V7 relationships including deprecated NEEDS_ESTIMATE (tests / stored snapshots). */
type V7ResolveRelationship =
  | 'DIRECT'
  | 'EQUIVALENT_COUNT'
  | 'WHOLE_ITEM'
  | 'NEEDS_ESTIMATE'
  | 'NEEDS_UNIT_BRIDGE'
  | 'WRONG_MATCH'
  | 'NEED_MORE_CANDIDATES'
import {
  parseDbCountServing,
  parseMassGrams,
  parseServingBaseGrams,
  resolveDbMultiplier,
  resolveExactConvertibleMultiplier,
  roundMultiplier,
  unitsCompatible,
} from './macroMass'
import { effectiveFatSecretServingDescription } from './macroServingResolve'
import type { FatSecretFoodRef } from '../../types/domain'

const ML_PER_TSP = 4.92892
const ML_PER_TBSP = 14.7868
const ML_PER_CUP = 236.588
const ML_PER_FL_OZ = 29.5735

function parseVolumeMl(text: string): number | null {
  const trimmed = text.trim().toLowerCase()
  const m = trimmed.match(/^([\d.]+|\d+\/\d+)\s*(.*)$/)
  if (!m) return null
  let qty: number
  if (m[1]!.includes('/')) {
    const [a, b] = m[1]!.split('/')
    qty = parseInt(a!, 10) / parseInt(b!, 10)
  } else {
    qty = parseFloat(m[1]!)
  }
  if (!Number.isFinite(qty) || qty <= 0) return null
  const unit = (m[2] ?? '').trim()
  if (/^(tsp|teaspoons?)$/.test(unit)) return qty * ML_PER_TSP
  if (/^(tbsp|tablespoons?)$/.test(unit)) return qty * ML_PER_TBSP
  if (/^(cups?)$/.test(unit)) return qty * ML_PER_CUP
  if (/^(ml|milliliters?|millilitres?)$/.test(unit)) return qty
  if (/^(fl\.?\s*oz|fluid\s*ounces?)$/.test(unit)) return qty * ML_PER_FL_OZ
  if (/^(l|liters?|litres?)$/.test(unit)) return qty * 1000
  return null
}

export type V7MultiplierInput = {
  quantity: number
  unit: string
  relationship: V7ResolveRelationship
  servingDescription: string
  /** For NEEDS_ESTIMATE: AI-supplied bridge (e.g. 6 fries ≈ 45 g). */
  estimateQuantity?: number | null
  estimateUnit?: string | null
}

/**
 * Compute nutrition multiplier from AI #1 quantity and AI #2 relationship.
 * Returns null when conversion is impossible (caller should use direct AI fallback).
 *
 * Precedence: if AI #1's unit is directly convertible to the selected serving
 * (mass↔mass, volume↔volume, identical count unit), code calculates the answer
 * regardless of AI #2's relationship — including NEEDS_ESTIMATE.
 */
export function computeV7Multiplier(input: V7MultiplierInput): number | null {
  const { quantity, unit, relationship, servingDescription, estimateQuantity, estimateUnit } = input
  if (!Number.isFinite(quantity) || quantity <= 0) return null
  const desc = servingDescription.trim()
  if (!desc) return null

  // Deterministic conversion always beats AI #2 classification.
  const exact = resolveExactConvertibleMultiplier({ qty: quantity, unit }, desc)
  if (exact != null) return exact

  switch (relationship) {
    case 'DIRECT': {
      // Includes mismatched-noun count ratios (tier 3) after exact path missed.
      return resolveDbMultiplier({ qty: quantity, unit }, desc)
    }
    case 'EQUIVALENT_COUNT': {
      const db = parseDbCountServing(desc)
      if (!db || db.qty <= 0) return null
      // One-for-one physical items even when nouns differ (taco ↔ piece)
      return roundMultiplier(quantity / db.qty)
    }
    case 'WHOLE_ITEM': {
      // FatSecret serving represents one whole user item (e.g. 1 sandwich)
      const db = parseDbCountServing(desc)
      const wholeQty = db?.qty && db.qty > 0 ? db.qty : 1
      return roundMultiplier(quantity / wholeQty)
    }
    case 'NEEDS_UNIT_BRIDGE':
    case 'NEEDS_ESTIMATE': {
      // Only reached when user qty/unit is not directly convertible to the serving.
      if (
        typeof estimateQuantity !== 'number' ||
        !Number.isFinite(estimateQuantity) ||
        estimateQuantity <= 0 ||
        !estimateUnit?.trim()
      ) {
        return null
      }
      const bridge = { qty: estimateQuantity, unit: estimateUnit.trim() }
      // Prefer converting bridge → FS serving
      const viaDb = resolveDbMultiplier(bridge, desc)
      if (viaDb != null) return viaDb

      // Mass bridge vs mass FS
      const bridgeG = parseMassGrams(`${bridge.qty} ${bridge.unit}`)
      const baseG = parseServingBaseGrams(desc)
      if (bridgeG != null && baseG != null && baseG > 0) {
        return roundMultiplier(bridgeG / baseG)
      }

      // Volume bridge
      const bridgeMl = parseVolumeMl(`${bridge.qty} ${bridge.unit}`)
      const baseMl = parseVolumeMl(desc)
      if (bridgeMl != null && baseMl != null && baseMl > 0) {
        return roundMultiplier(bridgeMl / baseMl)
      }

      // Count bridge with compatible units
      const db = parseDbCountServing(desc)
      if (db && db.qty > 0 && unitsCompatible(bridge.unit, db.unit)) {
        return roundMultiplier(bridge.qty / db.qty)
      }
      return null
    }
    case 'WRONG_MATCH':
    case 'NEED_MORE_CANDIDATES':
      return null
    default:
      return null
  }
}

export function computeV7MultiplierForServing(
  input: Omit<V7MultiplierInput, 'servingDescription'> & {
    food: FatSecretFoodRef
    serving: FatSecretServingRef
  },
): number | null {
  const desc = effectiveFatSecretServingDescription(input.food, input.serving)
  return computeV7Multiplier({ ...input, servingDescription: desc })
}
