import type { FatSecretFoodRef, MacroCustomFood, MacroEstimateSnapshot } from '../../types/domain'

const G_PER_OZ = 28.3495
const G_PER_LB = 453.592

/** Parse a user or serving size string into total grams, or null if not a mass amount. */
export function parseMassGrams(text: string): number | null {
  const trimmed = text.trim().toLowerCase()
  if (!trimmed) return null

  const patterns: { re: RegExp; toGrams: (n: number) => number }[] = [
    { re: /^([\d.]+)\s*(?:lbs?|pounds?)\b/, toGrams: (n) => n * G_PER_LB },
    { re: /^([\d.]+)\s*(?:oz|ounces?)\b/, toGrams: (n) => n * G_PER_OZ },
    { re: /^([\d.]+)\s*(?:g|grams?)\b/, toGrams: (n) => n },
    { re: /^([\d.]+)\s*lb\b/, toGrams: (n) => n * G_PER_LB },
    { re: /^([\d.]+)lbs?\b/, toGrams: (n) => n * G_PER_LB },
    { re: /^([\d.]+)oz\b/, toGrams: (n) => n * G_PER_OZ },
    { re: /^([\d.]+)g\b/, toGrams: (n) => n },
  ]

  for (const { re, toGrams } of patterns) {
    const m = trimmed.match(re)
    if (m) {
      const n = parseFloat(m[1]!)
      if (Number.isFinite(n) && n > 0) return toGrams(n)
    }
  }
  return null
}

/** Gram weight for one FatSecret/library serving line (e.g. "100g", "3 oz (84g)"). */
export function parseServingBaseGrams(description: string): number | null {
  const d = description.trim().toLowerCase()
  if (!d) return null

  const parenG = d.match(/\(([\d.]+)\s*g\)/)
  if (parenG) {
    const n = parseFloat(parenG[1]!)
    if (Number.isFinite(n) && n > 0) return n
  }

  const gOnly = d.match(/^([\d.]+)\s*g\b/) ?? d.match(/([\d.]+)\s*g\b/)
  if (gOnly) {
    const n = parseFloat(gOnly[1]!)
    if (Number.isFinite(n) && n > 0) return n
  }

  const ozMatch = d.match(/([\d.]+)\s*(?:oz|ounces?)\b/)
  if (ozMatch) {
    const n = parseFloat(ozMatch[1]!)
    if (Number.isFinite(n) && n > 0) return n * G_PER_OZ
  }

  const lbMatch = d.match(/([\d.]+)\s*(?:lbs?|pounds?)\b/)
  if (lbMatch) {
    const n = parseFloat(lbMatch[1]!)
    if (Number.isFinite(n) && n > 0) return n * G_PER_LB
  }

  return null
}

function parseIndex(raw: unknown): number | null {
  if (typeof raw === 'number' && Number.isFinite(raw)) return Math.trunc(raw)
  if (typeof raw === 'string' && raw.trim()) {
    const n = parseInt(raw, 10)
    if (Number.isFinite(n)) return n
  }
  return null
}

export function roundMultiplier(n: number): number {
  return Math.round(n * 100) / 100
}

/**
 * When the user's serving is a weight and the database serving has a parseable mass,
 * set multiplier = userGrams / baseGrams (fixes AI using the digit "4" as multiplier for "4 lbs").
 */
export function applyMassMultiplierCorrection(
  response: MacroEstimateSnapshot,
  userAmount: string,
  foods: MacroCustomFood[],
  fatSecretResults: FatSecretFoodRef[] = [],
): MacroEstimateSnapshot {
  const userGrams = parseMassGrams(userAmount)
  if (userGrams == null) return response

  const fsIdx = parseIndex(response.fatSecretIndex)
  if (fsIdx !== null && fsIdx >= 1 && fsIdx <= fatSecretResults.length) {
    const food = fatSecretResults[fsIdx - 1]!
    const servIdx = parseIndex(response.servingIndex)
    const serving =
      servIdx !== null && servIdx >= 1 && servIdx <= food.servings.length
        ? food.servings[servIdx - 1]!
        : food.servings.find((s) => s.isDefault) ?? food.servings[0]
    if (!serving) return response
    const baseGrams = parseServingBaseGrams(serving.description)
    if (baseGrams != null && baseGrams > 0) {
      return { ...response, multiplier: roundMultiplier(userGrams / baseGrams) }
    }
  }

  const libIdx = parseIndex(response.libraryIndex)
  if (libIdx !== null && libIdx >= 1 && libIdx <= foods.length) {
    const food = foods[libIdx - 1]!
    const base = food.baseAmount?.trim()
    if (base) {
      const baseGrams = parseServingBaseGrams(base)
      if (baseGrams != null && baseGrams > 0) {
        return { ...response, multiplier: roundMultiplier(userGrams / baseGrams) }
      }
    }
  }

  return response
}

// ─── Resolved-amount parsing ─────────────────────────────────────────────────
// AI outputs "resolvedAmount" as a machine-readable "<number> <unit>" string.
// These helpers parse that string and the FatSecret serving description to
// compute the correct DB multiplier without any AI unit math.

/**
 * Common plural-to-singular (and alternate-form) unit mappings.
 * Mass units normalize to their abbreviations so parseMassGrams() works
 * when we reconstruct "<qty> <unit>" strings.
 */
const UNIT_SYNONYMS: Record<string, string> = {
  // Mass — normalize to abbreviations used by parseMassGrams
  gram: 'g', grams: 'g',
  ounce: 'oz', ounces: 'oz',
  pound: 'lb', pounds: 'lb', lbs: 'lb',
  // Volume
  milliliter: 'ml', milliliters: 'ml', millilitre: 'ml', millilitres: 'ml',
  liter: 'l', liters: 'l', litre: 'l', litres: 'l',
  // Count items — plurals → singular
  gummies: 'gummy',
  candy: 'candy', candies: 'candy',
  pieces: 'piece', pcs: 'piece', pc: 'piece',
  slices: 'slice',
  sandwiches: 'sandwich',
  cookies: 'cookie',
  crackers: 'cracker',
  chips: 'chip',
  tablets: 'tablet',
  capsules: 'capsule',
  pills: 'pill',
  bars: 'bar',
  eggs: 'egg',
  scoops: 'scoop',
  patties: 'patty',
  nuggets: 'nugget',
  wraps: 'wrap',
  tacos: 'taco',
  tortillas: 'tortilla',
  strips: 'strip',
  balls: 'ball',
  cakes: 'cake',
  muffins: 'muffin',
  donuts: 'donut',
  doughnuts: 'doughnut',
  pancakes: 'pancake',
  waffles: 'waffle',
  wings: 'wing',
  servings: 'serving',
  bites: 'bite',
  sausages: 'sausage',
  links: 'link',
  fillets: 'fillet',
  steaks: 'steak',
  chops: 'chop',
  ribs: 'rib',
  meatballs: 'meatball',
}

/** Normalize a unit to its canonical singular/abbreviated form. */
export function normalizeSingular(unit: string): string {
  const u = unit.toLowerCase().trim()
  return UNIT_SYNONYMS[u] ?? u
}

/** Two units are compatible if they normalize to the same canonical form. */
export function unitsCompatible(a: string, b: string): boolean {
  return normalizeSingular(a) === normalizeSingular(b)
}

/**
 * Parse a machine-readable resolved-amount string like "6 gummy", "4 oz",
 * "0.5 sandwich", "25 g", "1/2 cup".
 * Returns { qty, unit } where unit is the raw string (not normalized), or null.
 *
 * Format: "<number> <unit>" — number can be integer, decimal, or N/D fraction.
 * Compact forms like "25g" or "4oz" are also accepted.
 */
export function parseResolvedAmount(text: string): { qty: number; unit: string } | null {
  const trimmed = text.trim()
  if (!trimmed) return null

  // "<number> <unit>" — handles "6 gummy", "0.5 sandwich", "1/2 cup", "4 oz"
  const spaceMatch = trimmed.match(/^(\d+(?:\.\d+)?|\d+\/\d+)\s+(.+)$/)
  if (spaceMatch) {
    const rawNum = spaceMatch[1]!
    const unit = spaceMatch[2]!.trim()
    let qty: number
    if (rawNum.includes('/')) {
      const parts = rawNum.split('/')
      qty = parseInt(parts[0]!, 10) / parseInt(parts[1]!, 10)
    } else {
      qty = parseFloat(rawNum)
    }
    if (Number.isFinite(qty) && qty > 0 && unit) {
      return { qty, unit }
    }
  }

  // Compact: "25g", "4oz", "100ml"
  const compactMatch = trimmed.match(/^(\d+(?:\.\d+)?)(g|oz|ml|lb|lbs)$/i)
  if (compactMatch) {
    const qty = parseFloat(compactMatch[1]!)
    const unit = compactMatch[2]!.toLowerCase()
    if (Number.isFinite(qty) && qty > 0) return { qty, unit }
  }

  return null
}

/**
 * Parse a FatSecret serving description for count-based items (non-mass).
 * Returns null if the description contains a parseable mass (handled elsewhere).
 *
 * Examples:
 *   "3 gummies"  → { qty: 3, unit: "gummies" }
 *   "1 sandwich" → { qty: 1, unit: "sandwich" }
 *   "100 g"      → null  (mass — use parseServingBaseGrams)
 *   "1 oz (28g)" → null  (mass)
 */
export function parseDbCountServing(description: string): { qty: number; unit: string } | null {
  if (parseServingBaseGrams(description) !== null) return null

  const d = description.trim()
  // "N unit" pattern
  const match = d.match(/^(\d+(?:\.\d+)?)\s+(.+)$/)
  if (match) {
    const qty = parseFloat(match[1]!)
    const unit = match[2]!.trim()
    if (Number.isFinite(qty) && qty > 0 && unit) {
      return { qty, unit }
    }
  }

  // No leading number — treat as qty=1 (e.g. bare "sandwich", "serving")
  if (d && !/^\d/.test(d)) {
    return { qty: 1, unit: d }
  }

  return null
}

/** Returns true for volume measure units that are NOT interchangeable via simple count ratio. */
function isVolumeUnit(unit: string): boolean {
  return /^(cups?|tbsp|tablespoons?|tsp|teaspoons?|ml|millilite?rs?|fl\.?\s*oz|fluid\s*oz|pints?|quarts?|gallons?|liters?|litres?)$/i.test(
    unit.toLowerCase().trim(),
  )
}

/**
 * Returns true when a unit is a pure count noun — not mass, not volume.
 * Only pure-count units are safe for the tier-3 ratio fallback where unit
 * names don't match (e.g. "gummy" vs "candy").
 */
function isPureCountUnit(unit: string): boolean {
  const u = unit.trim()
  if (!u || !/[a-zA-Z]/.test(u)) return false
  if (isVolumeUnit(u)) return false
  if (parseMassGrams(`1 ${u}`) !== null) return false
  return true
}

/**
 * Compute how many times a FatSecret serving line must be multiplied to match
 * the user's resolved amount.
 *
 * Tier 1 — mass: both amounts converted to grams, no AI math needed.
 * Tier 2 — count with matching unit names (after normalization).
 * Tier 3 — count with mismatched unit names (e.g. "gummy" vs "candy"): safe only
 *   when both sides are pure count nouns (not mass/volume).  The AI has already
 *   confirmed the food match; the word difference is cosmetic.
 * Returns null only for truly incompatible types (mass vs count, volume vs count, etc.)
 * so the caller can fall back to the AI's multiplier.
 *
 * Examples:
 *   "6 gummy"   + FS "3 gummies"  → 2      (tier 2)
 *   "6 gummy"   + FS "7 candies"  → 0.86   (tier 3)
 *   "4 oz"      + FS "100 g"      → 1.13   (tier 1)
 *   "0.5 sandwich" + FS "1 sandwich" → 0.5 (tier 2)
 *   "25 g"      + FS "28 g"       → 0.89   (tier 1)
 */
export function resolveDbMultiplier(
  resolved: { qty: number; unit: string },
  fsDescription: string,
): number | null {
  // Tier 1 — mass: convert both to grams and divide
  const userGrams = parseMassGrams(`${resolved.qty} ${resolved.unit}`)
  const baseGrams = parseServingBaseGrams(fsDescription)
  if (userGrams !== null && baseGrams !== null && baseGrams > 0) {
    return roundMultiplier(userGrams / baseGrams)
  }

  const dbCount = parseDbCountServing(fsDescription)

  // Tier 2 — count with matching unit names (e.g. "gummy" vs "gummies")
  if (dbCount && unitsCompatible(resolved.unit, dbCount.unit) && dbCount.qty > 0) {
    return roundMultiplier(resolved.qty / dbCount.qty)
  }

  // Tier 3 — count with mismatched unit names (e.g. "gummy" vs "candy")
  // Safe when both are pure count nouns; AI confirmed the food match already.
  if (
    dbCount &&
    dbCount.qty > 0 &&
    isPureCountUnit(resolved.unit) &&
    isPureCountUnit(dbCount.unit)
  ) {
    return roundMultiplier(resolved.qty / dbCount.qty)
  }

  return null
}
