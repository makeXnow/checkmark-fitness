import { normalizeSingular, parseMassGrams, parseResolvedAmount, parseLeadingQuantity } from './macroMass'

export type ConsumptionQuantityType = 'count' | 'mass' | 'volume' | 'fraction_of_item' | 'unknown'

export type ConsumptionIntent = {
  quantity: number
  unit: string
  quantityType: ConsumptionQuantityType
  raw: string
}

const WORD_FRACTIONS: Record<string, number> = {
  half: 0.5,
  quarter: 0.25,
  third: 1 / 3,
}

const VOLUME_UNITS =
  /^(cups?|tbsp|tablespoons?|tsp|teaspoons?|ml|milliliters?|fl\s*oz|fluid\s*oz|pints?|quarts?|gallons?|liters?|litres?)$/i

function classifyUnit(unit: string): ConsumptionQuantityType {
  const u = unit.trim()
  if (!u) return 'unknown'
  if (parseMassGrams(`1 ${u}`) !== null || /^(g|oz|lb|lbs)$/i.test(u)) return 'mass'
  if (VOLUME_UNITS.test(u)) return 'volume'
  // "serving" alone is ambiguous; callers with a whole-number qty treat it as count.
  if (normalizeSingular(u) === 'serving') return 'count'
  return 'count'
}

/**
 * Deterministic parse of parser `amount` strings into immutable consumption intent.
 * Examples: "2", "2 cookies", "1/3 sandwich", "half a potato", "6 oz", "1 teaspoon"
 */
export function parseConsumptionIntent(amount: string): ConsumptionIntent | null {
  const raw = amount.trim()
  if (!raw) return null

  const resolved = parseResolvedAmount(raw)
  if (resolved) {
    return {
      quantity: resolved.qty,
      unit: resolved.unit,
      quantityType: classifyUnit(resolved.unit),
      raw,
    }
  }

  const lower = raw.toLowerCase()

  for (const [word, qty] of Object.entries(WORD_FRACTIONS)) {
    const re = new RegExp(`\\b${word}\\b(?:\\s+(?:of\\s+)?(?:a\\s+|an\\s+|the\\s+)?)?(.+)?$`, 'i')
    const m = lower.match(re)
    if (m) {
      const rest = (m[1] || 'serving').trim()
      const unit = rest || 'serving'
      return {
        quantity: qty,
        unit,
        quantityType: unit === 'serving' ? 'fraction_of_item' : classifyUnit(unit),
        raw,
      }
    }
  }

  const bareNum = parseFloat(raw)
  if (Number.isFinite(bareNum) && String(bareNum) === raw) {
    // Bare quantity alone — unit must be recovered from food name/context by ensureConsumption.
    // Whole numbers are counts, not fractions of a serving.
    return {
      quantity: bareNum,
      unit: 'serving',
      quantityType: bareNum > 0 && bareNum < 1 ? 'fraction_of_item' : 'count',
      raw,
    }
  }

  const qtyFirst = parseLeadingQuantity(raw)
  if (qtyFirst != null) {
    const unitPart = raw.replace(/^\s*(\d+\s+\d+\s*\/\s*\d+|\d+\s*\/\s*\d+|\d+(?:\.\d+)?)\s*/i, '').trim()
    const unit = unitPart || 'serving'
    const quantityType =
      (!unitPart || normalizeSingular(unit) === 'serving') && qtyFirst >= 1
        ? 'count'
        : classifyUnit(unit)
    return {
      quantity: qtyFirst,
      unit,
      quantityType,
      raw,
    }
  }

  return null
}

export function consumptionIntentToResolved(intent: ConsumptionIntent): { qty: number; unit: string } {
  return { qty: intent.quantity, unit: normalizeSingular(intent.unit) }
}
