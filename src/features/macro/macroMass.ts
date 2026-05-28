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

function roundMultiplier(n: number): number {
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
