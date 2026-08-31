/**
 * V7 FatSecret serving normalization + candidate ranking.
 * Prefers unit-family-compatible servings while preserving FatSecret search order.
 */
import type { FatSecretFoodRef, FatSecretServingRef } from '../../types/domain'
import type { UnitFamily } from './macroAiSchemas'
import {
  isPureCountUnit,
  normalizeSingular,
  parseDbCountServing,
  parseServingBaseGrams,
} from './macroMass'

const ML_PER_TSP = 4.92892
const ML_PER_TBSP = 14.7868
const ML_PER_CUP = 236.588
const ML_PER_FL_OZ = 29.5735

export type NormalizedServingKind = 'mass' | 'volume' | 'count' | 'serving' | 'unknown'

export type NormalizedServing = {
  description: string
  kind: NormalizedServingKind
  /** Parsed leading quantity when present. */
  qty: number | null
  /** Canonical unit label when known. */
  unit: string | null
  /** Mass in grams when kind is mass. */
  grams: number | null
  /** Volume in ml when kind is volume. */
  ml: number | null
  /** Count noun when kind is count. */
  countUnit: string | null
  /** Lowercased description tokens for semantic matching. */
  tokens: string[]
}

export type RankedCandidate = {
  /** 0-based index into the original FatSecret results array. */
  foodIndex: number
  food: FatSecretFoodRef
  /** 0-based index into food.servings. */
  servingIndex: number
  serving: FatSecretServingRef
  normalized: NormalizedServing
  /** FatSecret original search rank (1-based). */
  fatSecretRank: number
  score: number
}

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
}

function parseVolumeMlFromDescription(description: string): { qty: number; unit: string; ml: number } | null {
  const d = description.trim().toLowerCase()
  const patterns: { re: RegExp; unit: string; toMl: (n: number) => number }[] = [
    { re: /^([\d.]+)\s*(?:tsp|teaspoons?)\b/, unit: 'tsp', toMl: (n) => n * ML_PER_TSP },
    { re: /^([\d.]+)\s*(?:tbsp|tablespoons?)\b/, unit: 'tbsp', toMl: (n) => n * ML_PER_TBSP },
    { re: /^([\d.]+)\s*(?:cups?)\b/, unit: 'cup', toMl: (n) => n * ML_PER_CUP },
    { re: /^([\d.]+)\s*(?:ml|milliliters?|millilitres?)\b/, unit: 'ml', toMl: (n) => n },
    { re: /^([\d.]+)\s*(?:fl\.?\s*oz|fluid\s*ounces?)\b/, unit: 'fl oz', toMl: (n) => n * ML_PER_FL_OZ },
  ]
  for (const { re, unit, toMl } of patterns) {
    const m = d.match(re)
    if (m) {
      const qty = parseFloat(m[1]!)
      if (Number.isFinite(qty) && qty > 0) return { qty, unit, ml: toMl(qty) }
    }
  }
  return null
}

/** Parse a FatSecret serving description into a normalized physical representation. */
export function normalizeFatSecretServing(description: string): NormalizedServing {
  const desc = description.trim()
  const tokens = tokenize(desc)
  const grams = parseServingBaseGrams(desc)
  if (grams != null && grams > 0) {
    let unit: string | null = null
    const lower = desc.toLowerCase()
    if (/\b(kg|kilograms?)\b/.test(lower)) unit = 'kg'
    else if (/\b(lbs?|pounds?)\b/.test(lower)) unit = 'lb'
    else if (/\b(oz|ounces?)\b/.test(lower)) unit = 'oz'
    else unit = 'g'
    const leading = desc.match(/^([\d.]+)/)
    return {
      description: desc,
      kind: 'mass',
      qty: leading ? parseFloat(leading[1]!) : grams,
      unit,
      grams,
      ml: null,
      countUnit: null,
      tokens,
    }
  }

  const vol = parseVolumeMlFromDescription(desc)
  if (vol) {
    return {
      description: desc,
      kind: 'volume',
      qty: vol.qty,
      unit: vol.unit,
      grams: null,
      ml: vol.ml,
      countUnit: null,
      tokens,
    }
  }

  const count = parseDbCountServing(desc)
  if (count) {
    const normUnit = normalizeSingular(count.unit)
    const isGeneric = /^(serving|servings|portion|portions|order|orders)$/i.test(normUnit)
    if (isGeneric) {
      return {
        description: desc,
        kind: 'serving',
        qty: count.qty,
        unit: normUnit,
        grams: null,
        ml: null,
        countUnit: null,
        tokens,
      }
    }
    return {
      description: desc,
      kind: 'count',
      qty: count.qty,
      unit: count.unit,
      grams: null,
      ml: null,
      countUnit: count.unit,
      tokens,
    }
  }

  return {
    description: desc,
    kind: 'unknown',
    qty: null,
    unit: null,
    grams: null,
    ml: null,
    countUnit: null,
    tokens,
  }
}

function familyCompatible(family: UnitFamily, kind: NormalizedServingKind): boolean {
  if (family === 'mass') return kind === 'mass'
  if (family === 'volume') return kind === 'volume'
  if (family === 'count') return kind === 'count' || kind === 'serving'
  if (family === 'serving') return kind === 'serving' || kind === 'count'
  return false
}

function nameMatchScore(query: string, food: FatSecretFoodRef): number {
  const qTokens = tokenize(query)
  if (qTokens.length === 0) return 0
  const label = `${food.brandName ?? ''} ${food.name}`.trim()
  const fTokens = new Set(tokenize(label))
  let hits = 0
  for (const t of qTokens) {
    if (fTokens.has(t)) hits++
  }
  return hits / qTokens.length
}

function portionPhraseScore(originalPortion: string | undefined, normalized: NormalizedServing): number {
  if (!originalPortion?.trim()) return 0
  const phrase = tokenize(originalPortion)
  if (phrase.length === 0) return 0
  let hits = 0
  for (const t of phrase) {
    if (normalized.tokens.includes(t)) hits++
  }
  return hits / phrase.length
}

export type RankCandidatesInput = {
  foods: FatSecretFoodRef[]
  unitFamily: UnitFamily
  foodName: string
  fatSecretSearch: string
  /** When estimated=true, boost servings that match the original phrase (e.g. "handful"). */
  estimated?: boolean
  originalPortion?: string
}

/**
 * Rank all (food, serving) pairs from up to 50 FatSecret results.
 * Higher score = better. Preserves FatSecret order as a relevance signal.
 *
 * Unit-family compatibility is a ranking bonus, not an absolute filter —
 * a strong exact product match stays eligible even with a less convenient serving unit.
 */
export function rankFatSecretCandidates(input: RankCandidatesInput): RankedCandidate[] {
  const { foods, unitFamily, foodName, fatSecretSearch, estimated, originalPortion } = input
  const searchLabel = fatSecretSearch.trim() || foodName.trim()
  const ranked: RankedCandidate[] = []

  foods.forEach((food, foodIndex) => {
    const fatSecretRank = foodIndex + 1
    const nameScore = Math.max(nameMatchScore(searchLabel, food), nameMatchScore(foodName, food))
    food.servings.forEach((serving, servingIndex) => {
      const normalized = normalizeFatSecretServing(serving.description)
      let score = 0
      // FatSecret original rank (earlier = better): up to 40 points
      score += Math.max(0, 40 - (fatSecretRank - 1) * 0.8)
      // Name/brand match: up to 40 (strong identity can outweigh unit-family fit)
      score += nameScore * 40
      // Unit-family compatibility: bonus only — never exclude mismatched units
      if (familyCompatible(unitFamily, normalized.kind)) score += 20
      else if (normalized.kind === 'unknown') score += 5
      // Useful structured serving: up to 10
      if (normalized.kind === 'mass' || normalized.kind === 'volume' || normalized.kind === 'count') {
        score += 10
      }
      // Estimated portions: prefer FS servings matching original phrase
      if (estimated) {
        score += portionPhraseScore(originalPortion, normalized) * 25
      }
      // Prefer pure count nouns for count family
      if (unitFamily === 'count' && normalized.countUnit && isPureCountUnit(normalized.countUnit)) {
        score += 5
      }

      ranked.push({
        foodIndex,
        food,
        servingIndex,
        serving,
        normalized,
        fatSecretRank,
        score,
      })
    })
  })

  ranked.sort((a, b) => b.score - a.score || a.fatSecretRank - b.fatSecretRank)
  return ranked
}

/** Take a batch of ranked candidates, deduped by food (best serving per food). */
export function takeCandidateBatch(
  ranked: RankedCandidate[],
  offset: number,
  limit: number,
): RankedCandidate[] {
  const out: RankedCandidate[] = []
  const seenFoods = new Set<number>()
  let skipped = 0
  for (const c of ranked) {
    if (seenFoods.has(c.foodIndex)) continue
    seenFoods.add(c.foodIndex)
    if (skipped < offset) {
      skipped++
      continue
    }
    out.push(c)
    if (out.length >= limit) break
  }
  return out
}

/** Build pass-2 AI batch: remaining ranked foods (13+) plus optional carry from pass 1. */
export function buildPass2Candidates(
  ranked: RankedCandidate[],
  pass1Size: number,
  carryFromPass1: RankedCandidate | null,
): RankedCandidate[] {
  const rest = takeCandidateBatch(ranked, pass1Size, 50)
  if (!carryFromPass1) return rest
  const withoutCarry = rest.filter((c) => c.foodIndex !== carryFromPass1.foodIndex)
  return [carryFromPass1, ...withoutCarry]
}

/** Build FatSecretFoodRef[] for AI prompt from a ranked batch (one serving list per food, preferred serving first). */
export function foodsFromCandidateBatch(batch: RankedCandidate[]): FatSecretFoodRef[] {
  return batch.map((c) => {
    const preferred = c.serving
    const rest = c.food.servings.filter((s) => s.servingId !== preferred.servingId)
    return {
      ...c.food,
      servings: [preferred, ...rest],
    }
  })
}
