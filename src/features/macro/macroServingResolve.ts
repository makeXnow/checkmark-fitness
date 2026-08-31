import type {
  ConsumptionPortion,
  NormalizedEstimate,
  ServingRelationship,
} from './macroAiSchemas'
import {
  isPureCountUnit,
  normalizeSingular,
  parseDbCountServing,
  parseDbServingDescription,
  parseMassGrams,
  parseServingBaseGrams,
  resolveDbMultiplier,
  roundMultiplier,
  unitsCompatible,
} from './macroMass'
import {
  consumptionToMatchResolved,
} from './consumptionNormalize'

/** Convert authoritative parser consumption to a resolved qty/unit pair for DB matching. */
export function consumptionToResolved(
  consumption: ConsumptionPortion,
): { qty: number; unit: string } | null {
  return consumptionToMatchResolved(consumption)
}

export function formatConsumptionForPrompt(consumption: ConsumptionPortion): string {
  return JSON.stringify(consumption)
}

/**
 * Deterministic nutrition multiplier from user consumption + DB serving + AI relationship.
 * Returns null when no safe conversion exists (caller should use estimate nutrition).
 */
export function computeMacroMultiplier(
  consumption: { qty: number; unit: string },
  fsDescription: string,
  relationship?: ServingRelationship | null,
  normalizedEstimate?: NormalizedEstimate | null,
): number | null {
  const direct = resolveDbMultiplier(consumption, fsDescription)
  if (direct !== null) return direct

  const dbCount = parseDbCountServing(fsDescription)

  if (
    relationship === 'fraction_of_whole' &&
    dbCount &&
    dbCount.qty > 0 &&
    (unitsCompatible(consumption.unit, dbCount.unit) ||
      normalizeSingular(dbCount.unit) === 'serving' ||
      normalizeSingular(dbCount.unit) === 'order')
  ) {
    return roundMultiplier(consumption.qty / dbCount.qty)
  }

  if (
    (relationship === 'count_equivalent' || relationship === 'same_unit') &&
    dbCount &&
    dbCount.qty > 0
  ) {
    if (unitsCompatible(consumption.unit, dbCount.unit)) {
      return roundMultiplier(consumption.qty / dbCount.qty)
    }
    if (
      isPureCountUnit(consumption.unit) &&
      isPureCountUnit(dbCount.unit) &&
      relationship === 'count_equivalent'
    ) {
      return roundMultiplier(consumption.qty / dbCount.qty)
    }
    // User still has generic "serving" but FS has a count line — treat as count ratio
    if (
      normalizeSingular(consumption.unit) === 'serving' &&
      isPureCountUnit(dbCount.unit) &&
      relationship === 'count_equivalent'
    ) {
      return roundMultiplier(consumption.qty / dbCount.qty)
    }
  }

  // Whole-number count vs FS count serving even when relationship was mis-tagged
  if (
    dbCount &&
    dbCount.qty > 0 &&
    consumption.qty >= 1 &&
    (normalizeSingular(consumption.unit) === 'serving' || isPureCountUnit(consumption.unit)) &&
    isPureCountUnit(dbCount.unit) &&
    relationship !== 'estimate_required' &&
    relationship !== 'unresolved' &&
    relationship !== 'fraction_of_whole'
  ) {
    const retry = resolveDbMultiplier(
      {
        qty: consumption.qty,
        unit: normalizeSingular(consumption.unit) === 'serving' ? dbCount.unit : consumption.unit,
      },
      fsDescription,
    )
    if (retry !== null) return retry
  }

  if (relationship === 'unit_conversion') {
    const retry = resolveDbMultiplier(consumption, fsDescription)
    if (retry !== null) return retry
  }

  if (relationship === 'estimate_required' && normalizedEstimate?.estimated) {
    return resolveDbMultiplier(
      { qty: normalizedEstimate.quantity, unit: normalizedEstimate.unit },
      fsDescription,
    )
  }

  return null
}

const FS_NAME_COUNT_RE =
  /\b(\d+)\s*(pieces?|pcs?|tacos?|nuggets?|wings?|strips?|bites?|cookies?|bars?|slices?|tablets?|capsules?|items?|counts?|packs?)\b/i

/** FS serving line used for multiplier math (count may live in food name). */
export function effectiveFatSecretServingDescription(
  food: { name: string },
  serving: { description: string },
): string {
  const rawDesc = serving.description.trim().toLowerCase()
  if (rawDesc === '1 serving' || rawDesc === 'serving') {
    const countMatch = food.name.match(FS_NAME_COUNT_RE)
    if (countMatch) {
      return `${countMatch[1]} ${countMatch[2]!.toLowerCase()}`
    }
  }
  return serving.description
}

export function inferServingRelationship(
  consumption: ConsumptionPortion,
  fsDescription: string,
): ServingRelationship | null {
  const match = consumptionToMatchResolved(consumption)
  if (!match) {
    return consumption.kind === 'vague' ? 'estimate_required' : null
  }

  // Reinterpret generic "serving" as the FS count unit for relationship inference
  const dbCount = parseDbCountServing(fsDescription)
  const matchForDb =
    normalizeSingular(match.unit) === 'serving' && dbCount && isPureCountUnit(dbCount.unit)
      ? { qty: match.qty, unit: normalizeSingular(dbCount.unit) }
      : match

  if (resolveDbMultiplier(matchForDb, fsDescription) !== null) {
    if (parseMassGrams(`${match.qty} ${match.unit}`) !== null && parseServingBaseGrams(fsDescription) !== null) {
      return 'unit_conversion'
    }
    if (dbCount && unitsCompatible(matchForDb.unit, dbCount.unit)) {
      return matchForDb.qty === dbCount.qty && matchForDb.unit === normalizeSingular(dbCount.unit)
        ? 'same_unit'
        : 'count_equivalent'
    }
    return 'count_equivalent'
  }

  // True fractions of a whole item (half sandwich, 20% fries) — not bare whole-number counts
  if (
    (consumption.kind === 'fraction_of_item' || consumption.kind === 'fraction_of_container') &&
    match.qty > 0 &&
    match.qty < 1
  ) {
    return 'fraction_of_whole'
  }

  if (isPureCountUnit(matchForDb.unit) && parseServingBaseGrams(fsDescription) !== null) {
    return 'estimate_required'
  }

  // Count food vs bare "1 serving" restaurant order with no piece count in name
  if (
    isPureCountUnit(matchForDb.unit) &&
    /^(1\s+)?servings?$/i.test(fsDescription.trim()) &&
    !dbCount
  ) {
    return 'estimate_required'
  }

  return 'unresolved'
}

export function parseDbServingParts(description: string): { qty: number; unit: string } | null {
  return parseDbServingDescription(description)
}
