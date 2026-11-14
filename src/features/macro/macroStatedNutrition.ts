import { normalizeSingular, resolveExactConvertibleMultiplier } from './macroMass'

type Scope = 'per_container' | 'per_unit' | 'total_eaten'
type Nutrient = 'calories' | 'protein'
type Fact = { value: number; scope?: Scope; unit?: string }
export type StatedNutrition = Partial<Record<Nutrient, Fact[]>>
export type StatedNutritionTotals = Partial<Record<Nutrient, number>>

const NUTRIENT_RE = /(?<![\d.\w-])(?:(\d{1,4}(?:\.\d+)?)\s*(?:k?cals?|calories)\b|(\d{1,3}(?:\.\d+)?)\s*(?:g|grams?)\s*(?:of\s+)?protein\b|\bprotein\s*[:=]?\s*(\d{1,3}(?:\.\d+)?)(?:\s*(?:g|grams?)\b|\b(?!\.\d)))/gi
const PACKAGE_UNITS = 'container|thing|bag|box|package|pack|can|bottle|tub|carton|pint|bowl|meal|tray|jar|pouch'
const CONTAINER_SCOPE_RE = new RegExp(`\\b(?:whole|entire|full)\\s+(?:${PACKAGE_UNITS})\\b`, 'i')
const PACKAGE_UNIT_RE = new RegExp(`^(?:${PACKAGE_UNITS})$`, 'i')
const UNIT_SCOPE_RE = /\b(?:per|each|every)\s+((?:\d+(?:\.\d+|\/\d+)?\s*)?[a-z]+)\b|\ba\s+(serving|portion|piece|bar|cookie|slice|scoop|unit|container|bag|box|package|pack|can|bottle|tub|carton|pint|bowl|meal|tray|jar|pouch)\b/i
const TOTAL_SCOPE_RE = /\b(in total|total|altogether|all together|combined|for all of (it|them))\b/i

/** Read each label value with its own basis, including notes with both per-serving and total values. */
export function parseStatedNutrition(text: string | undefined | null): StatedNutrition | null {
  if (!text?.trim()) return null
  const matches = [...text.matchAll(NUTRIENT_RE)]
  const result: StatedNutrition = {}
  let shared: Fact[] = []
  matches.forEach((match, index) => {
    const nutrient = match[1] != null ? 'calories' : 'protein'
    const value = Number(match[1] ?? match[2] ?? match[3])
    if (nutrient === 'calories' && value > 5000) return
    const next = matches[index + 1]
    const gap = text.slice(match.index + match[0].length, next?.index)
    // Stop at a clause boundary, so "per serving, 680 calories total" is two facts.
    const suffix = gap.split(/[,;!?]|\.(?!\d)/, 1)[0]!
    const unitMatch = suffix.match(UNIT_SCOPE_RE)
    const unit = (unitMatch?.[1] ?? unitMatch?.[2])?.toLowerCase()
    const scope = unit && unit !== 'whole' && unit !== 'entire' && unit !== 'full' ? 'per_unit'
      : CONTAINER_SCOPE_RE.test(suffix) ? 'per_container'
        : TOTAL_SCOPE_RE.test(suffix) ? 'total_eaten'
          : /\beach\b/i.test(suffix) ? 'per_unit' : undefined
    const fact: Fact = { value, scope, unit }
    const nutrientFacts = result[nutrient] ??= []
    nutrientFacts.push(fact)
    if (scope) {
      // A shared qualifier in "620 calories, 26 g protein for the whole container".
      for (const previous of shared) Object.assign(previous, { scope, unit })
      shared = []
    } else if (/^\s*(?:,\s*)?(?:and\s*)?$/i.test(gap)) {
      shared.push(fact)
    } else {
      shared = []
    }
  })
  return Object.keys(result).length ? result : null
}

const isServing = (unit: string) => unit === 'serving' || unit === 'portion'

/** Scale only values whose basis is compatible with the amount eaten. Missing values stay missing. */
export function applyStatedNutrition(
  stated: StatedNutrition,
  portion: { quantity: number; unit: string; unitFamily?: string },
): StatedNutritionTotals | null {
  const { quantity, unitFamily } = portion
  if (!Number.isFinite(quantity) || quantity <= 0) return null
  const unit = normalizeSingular(portion.unit)
  const countLike = unitFamily === 'count' || unitFamily === 'serving' || !unitFamily
  const totals: StatedNutritionTotals = {}
  for (const nutrient of ['calories', 'protein'] as const) {
    const facts = [...(stated[nutrient] ?? [])].reverse()
    const explicitTotal = facts.find((fact) => fact.scope === 'total_eaten')
    let value = explicitTotal?.value
    for (const fact of facts) {
      if (value != null) break
      const multiplier = fact.scope === 'per_container'
        ? (countLike && PACKAGE_UNIT_RE.test(unit) ? quantity : null)
        : !fact.unit ? (countLike ? quantity : null)
          : isServing(normalizeSingular(fact.unit)) && (unitFamily === 'serving' || isServing(unit))
            ? quantity
            : resolveExactConvertibleMultiplier({ qty: quantity, unit }, /^\d/.test(fact.unit) ? fact.unit : `1 ${fact.unit}`)
      if (multiplier != null) value = fact.value * multiplier
    }
    if (value != null) totals[nutrient] = nutrient === 'calories' ? Math.round(value) : Math.round(value * 10) / 10
  }
  return Object.keys(totals).length ? totals : null
}
