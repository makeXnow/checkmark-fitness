/**
 * Nutrition numbers the user said out loud ("620 calories and 26 grams of protein for the
 * whole container") beat any database match. Parsed from the parser's per-item notes.
 */

export type StatedNutritionScope =
  /** Numbers describe one whole container/package the user's unit counts (× quantity). */
  | 'per_container'
  /** Numbers describe one unit/serving (× quantity). */
  | 'per_unit'
  /** Numbers are the total of what was eaten (no scaling). */
  | 'total_eaten'

export type StatedNutrition = {
  calories: number
  protein: number | null
  scope: StatedNutritionScope
}

const CAL_RE = /(\d{1,4}(?:\.\d+)?)\s*(?:k?cals?|calories|kcal)\b/i
const PROTEIN_AFTER_RE = /(\d{1,3}(?:\.\d+)?)\s*(?:g|grams?)\s*(?:of\s+)?protein\b/i
const PROTEIN_BEFORE_RE = /\bprotein\s*[:=]?\s*(\d{1,3}(?:\.\d+)?)\s*(?:g|grams?)?\b/i

const PER_CONTAINER_RE =
  /\b(whole|entire|full)\s+(container|thing|bag|box|package|pack|can|bottle|tub|carton|pint|bowl|meal|tray|jar|pouch)\b|\b(per|a|each|one)\s+(container|package|bag|box|can|bottle|tub|pint|tray|jar|pouch)\b/i
const TOTAL_EATEN_RE = /\b(in total|total|altogether|all together|combined|for all of (it|them))\b/i
const PER_UNIT_RE = /\b(per|each|a|every)\s+(serving|piece|bar|cookie|slice|scoop|unit|one)\b|\beach\b/i

export function parseStatedNutrition(text: string | undefined | null): StatedNutrition | null {
  const t = text?.trim()
  if (!t) return null
  const cal = t.match(CAL_RE)
  if (!cal) return null
  const calories = parseFloat(cal[1]!)
  if (!Number.isFinite(calories) || calories <= 0 || calories > 5000) return null
  const proMatch = t.match(PROTEIN_AFTER_RE) ?? t.match(PROTEIN_BEFORE_RE)
  const protein = proMatch ? parseFloat(proMatch[1]!) : null

  let scope: StatedNutritionScope = 'per_unit'
  if (PER_CONTAINER_RE.test(t)) scope = 'per_container'
  else if (TOTAL_EATEN_RE.test(t)) scope = 'total_eaten'
  else if (PER_UNIT_RE.test(t)) scope = 'per_unit'

  return {
    calories,
    protein: protein != null && Number.isFinite(protein) && protein >= 0 ? protein : null,
    scope,
  }
}

/**
 * Total macros for what was eaten, or null when the stated numbers cannot be applied
 * without a unit conversion (e.g. "1 cup" of a soup whose label total is per container).
 */
export function applyStatedNutrition(
  stated: StatedNutrition,
  portion: { quantity: number; unit: string; unitFamily?: string },
): { calories: number; protein: number } | null {
  const qty = Number.isFinite(portion.quantity) && portion.quantity > 0 ? portion.quantity : 1
  const protein = stated.protein ?? 0
  if (stated.scope === 'total_eaten') {
    return { calories: Math.round(stated.calories), protein: Math.round(protein * 10) / 10 }
  }
  const countLike = portion.unitFamily === 'count' || portion.unitFamily === 'serving' || !portion.unitFamily
  if (!countLike) return null
  return {
    calories: Math.round(stated.calories * qty),
    protein: Math.round(protein * qty * 10) / 10,
  }
}
