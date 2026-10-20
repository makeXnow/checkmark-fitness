import {
  buildV7MacrosCaseBrief,
  formatClassificationContext,
  macroEstimateInputFields,
  macrosAiToEstimateResponse,
  resolveMacroEstimate,
  type MacroEstimateResponse,
} from '../src/features/macro/macroLib'
import type { FatSecretFoodRef } from './fatsecret'
import type { MacroParseSnapshot } from '../src/types/domain'
import { fatSecretEnrichServings, fatSecretSearchFoods } from './fatsecret'
import { rewriteFatSecretSearch } from '../src/features/macro/macroBrandAliases'
import { OPENAI_MODELS } from './openaiModels'
import { getMacroPrompt } from './macroPromptsStore'
import { callOpenAiJsonWithRetry } from './openaiJson'
import {
  MACROS_CROSSCHECK_JSON_SCHEMA,
  MACROS_JSON_SCHEMA,
  type UnitFamily,
  type V7ServingRelationship,
} from '../src/features/macro/macroAiSchemas'
import { MACROS_CROSSCHECK_PROMPT } from '../src/features/macro/macroPromptContent'
import { applyStatedNutrition, parseStatedNutrition } from '../src/features/macro/macroStatedNutrition'
import { parseServingBaseGrams } from '../src/features/macro/macroMass'
import {
  describeMemoryEntry,
  loadPersonalMemory,
  matchPersonalMemory,
  type PersonalMemoryEntry,
} from './macroMemory'
import {
  hasValidUnitsPerServing,
  macrosValidationErrors,
  validateMacrosResponse,
} from '../src/features/macro/macroAiValidate'
import {
  buildPass2Candidates,
  foodsFromCandidateBatch,
  normalizeFatSecretServing,
  rankFatSecretCandidates,
  takeCandidateBatch,
  type RankedCandidate,
} from '../src/features/macro/macroCandidateRank'
import {
  annotateFatSecretCandidates,
  formatNumberedFatSecretAnnotated,
  formatNumberedFoodLibraryAnnotated,
} from '../src/features/macro/macroCandidateAnnotate'
import { computeV8Multiplier } from '../src/features/macro/macroV8Resolve'
import { effectiveFatSecretServingDescription } from '../src/features/macro/macroServingResolve'

export type MacroEstimateApiFood = {
  id: string
  name: string
  emoji?: string
  baseAmount?: string
  calories: number
  protein: number
}

export type MacroEstimateApiBody = {
  name: string
  amount: string
  notes?: string
  fatSecretSearch?: string
  fatSecretResults?: FatSecretFoodRef[]
  /** When set, only these foods are sent to the AI (full cache stays in fatSecretResults). */
  aiFatSecretResults?: FatSecretFoodRef[]
  /** 1-based index into fatSecretResults for remapping AI fatSecretIndex after a user pick. */
  fatSecretSelectedIndex?: number
  /** Omit FatSecret from the AI prompt (user chose None). */
  skipFatSecretForAi?: boolean
  /** User changed the database match — use classification + chosen option only. */
  userDatabasePick?: boolean
  parseSnapshot?: MacroParseSnapshot
  userInput?: string
  skipFatSecretFetch?: boolean
  customFoods?: MacroEstimateApiFood[]
  extraCtx?: string
  /** Override default chat model (bakeoffs / experiments). */
  model?: string
  /**
   * Cache hit: reuse prior FatSecret selection + relationship; skip AI #2.
   * Bridge unitsPerServing must already be on the cache entry when needed.
   */
  v7CachedResolution?: {
    fatSecretIndex: number
    servingIndex: number
    relationship: V7ServingRelationship
    estimateQuantity?: number | null
    estimateUnit?: string | null
    unitsPerServing?: number | null
  }
}

export type MacroEstimateApiResult = {
  calories: number
  protein: number
  libraryFoodId?: string
  servingType?: string
  servingSize?: number
  servingUnit?: string
  servingMultiplier?: number
  baseCalories?: number
  baseProtein?: number
  fatSecretResults: FatSecretFoodRef[]
  fatSecretSource: 'cache' | 'search' | 'none'
  macroEstimateSnapshot: MacroEstimateResponse
  /** True when AI #2 was skipped due to 30-day resolution cache. */
  v7CacheHit?: boolean
}

type EnvMacro = {
  DB: D1Database
  OPENAI_API_KEY?: string
  FATSECRET_CLIENT_ID?: string
  FATSECRET_CLIENT_SECRET?: string
}

const PASS1_CANDIDATE_COUNT = 12
/** Search hits that get food.get full servings (with grams) before ranking. */
const ENRICH_SERVINGS_COUNT = 10

function remapBatchSelection(
  normalized: MacroEstimateResponse,
  batchFoods: FatSecretFoodRef[],
  batchToFull: number[],
  fatSecretResults: FatSecretFoodRef[],
): MacroEstimateResponse {
  if (
    typeof normalized.fatSecretIndex !== 'number' ||
    normalized.fatSecretIndex < 1 ||
    normalized.fatSecretIndex > batchToFull.length
  ) {
    return normalized
  }
  const fullIdx = batchToFull[normalized.fatSecretIndex - 1]!
  const batchFood = batchFoods[normalized.fatSecretIndex - 1]!
  const fullFood = fatSecretResults[fullIdx - 1]!
  const servIdx =
    typeof normalized.servingIndex === 'number' && normalized.servingIndex >= 1
      ? normalized.servingIndex
      : 1
  const chosenServing = batchFood.servings[servIdx - 1]
  let fullServingIndex = servIdx
  if (chosenServing && fullFood) {
    const found = fullFood.servings.findIndex((s) => s.servingId === chosenServing.servingId)
    if (found >= 0) fullServingIndex = found + 1
  }
  return {
    ...normalized,
    fatSecretIndex: fullIdx,
    servingIndex: fullServingIndex,
  }
}

function candidateAtBatchIndex(
  batch: RankedCandidate[],
  batchLocalIndex: number | null | undefined,
): RankedCandidate | null {
  if (typeof batchLocalIndex !== 'number' || batchLocalIndex < 1 || batchLocalIndex > batch.length) {
    return null
  }
  return batch[batchLocalIndex - 1] ?? null
}

function inferUnitFamily(unit: string, snap?: MacroParseSnapshot): UnitFamily {
  if (snap?.unitFamily) return snap.unitFamily
  const u = unit.trim().toLowerCase()
  if (/^(g|grams?|kg|oz|ounces?|lb|lbs|pounds?)$/.test(u)) return 'mass'
  if (/^(tsp|teaspoons?|tbsp|tablespoons?|cups?|ml|milliliters?|fl\.?\s*oz)$/.test(u)) return 'volume'
  if (/^(serving|servings)$/.test(u)) return 'serving'
  return 'count'
}

function resolveSelectedServingDescription(
  json: MacroEstimateResponse,
  fatSecretForResolve: FatSecretFoodRef[],
  customFoods: MacroEstimateApiFood[],
): { servingDescription: string; foodName: string } | null {
  const libIdx = typeof json.libraryIndex === 'number' ? json.libraryIndex : null
  if (libIdx != null && libIdx >= 1 && libIdx <= customFoods.length) {
    const food = customFoods[libIdx - 1]!
    return { servingDescription: food.baseAmount || '1 serving', foodName: food.name }
  }
  const fsIdx = typeof json.fatSecretIndex === 'number' ? json.fatSecretIndex : null
  if (fsIdx != null && fsIdx >= 1 && fsIdx <= fatSecretForResolve.length) {
    const food = fatSecretForResolve[fsIdx - 1]!
    const servIdx = typeof json.servingIndex === 'number' ? json.servingIndex : null
    const serving =
      servIdx != null && servIdx >= 1 && servIdx <= food.servings.length
        ? food.servings[servIdx - 1]!
        : food.servings.find((s) => s.isDefault) ?? food.servings[0]
    if (!serving) return null
    return {
      servingDescription: effectiveFatSecretServingDescription(food, serving),
      foodName: food.name,
    }
  }
  return null
}

type ApplyV9Result = MacroEstimateResponse & {
  needsRelationshipRetry?: 'direct_no_convert' | 'bridge_missing_units' | null
}

/** V9: code-only arithmetic from AI #2 relationship (+ optional unitsPerServing). No AI #3. */
function applyV9ServingMath(
  json: MacroEstimateResponse,
  estimateFields: ReturnType<typeof macroEstimateInputFields>,
  fatSecretForResolve: FatSecretFoodRef[],
  customFoods: MacroEstimateApiFood[],
  parseSnapshot?: MacroParseSnapshot,
): ApplyV9Result {
  const rel = json.relationshipV7
  if (!rel || rel === 'WRONG_MATCH' || rel === 'NEED_MORE_CANDIDATES') {
    return { ...json, multiplier: undefined, unitBridgeRan: false, deterministicOk: false, needsRelationshipRetry: null }
  }

  const qty = estimateFields.quantity
  const unit =
    parseSnapshot?.unitSingular?.trim() ||
    estimateFields.unit ||
    parseSnapshot?.unit ||
    'serving'

  const selected = resolveSelectedServingDescription(json, fatSecretForResolve, customFoods)
  if (!selected) {
    return { ...json, multiplier: undefined, unitBridgeRan: false, needsRelationshipRetry: null }
  }

  const { servingDescription } = selected
  const unitsPerServing = json.unitsPerServing ?? null
  const bridgeQuestion =
    typeof json.unitBridgeQuestion === 'string' && json.unitBridgeQuestion.trim()
      ? json.unitBridgeQuestion.trim()
      : null

  const computed = computeV8Multiplier({
    quantity: qty,
    unit,
    relationship: rel,
    servingDescription,
    unitsPerServing,
  })

  if (computed.multiplier != null) {
    return {
      ...json,
      multiplier: computed.multiplier,
      deterministicOk: computed.deterministicOk,
      unitBridgeRan: computed.usedUnitBridge,
      unitsPerServing: computed.usedUnitBridge ? unitsPerServing : json.unitsPerServing,
      unitBridgeQuestion: computed.usedUnitBridge ? bridgeQuestion : json.unitBridgeQuestion,
      needsRelationshipRetry: null,
    }
  }

  // Invalid DIRECT that code cannot convert → retry AI #2 (do not silently invent a bridge).
  if (rel === 'DIRECT') {
    return {
      ...json,
      multiplier: undefined,
      deterministicOk: false,
      unitBridgeRan: false,
      needsRelationshipRetry: 'direct_no_convert',
    }
  }

  if (rel === 'NEEDS_UNIT_BRIDGE' && !hasValidUnitsPerServing({ unitsPerServing })) {
    return {
      ...json,
      multiplier: undefined,
      deterministicOk: false,
      unitBridgeRan: false,
      needsRelationshipRetry: 'bridge_missing_units',
    }
  }

  return {
    ...json,
    multiplier: undefined,
    deterministicOk: false,
    unitBridgeRan: false,
    needsRelationshipRetry: null,
  }
}

const RELATIONSHIP_RETRY_HINTS: Record<'direct_no_convert' | 'bridge_missing_units', string> = {
  direct_no_convert:
    '\n\nCORRECTION: Your selected relationship was DIRECT, but the selected serving cannot be deterministically converted to the user\'s unit. Re-evaluate the relationship. Use WHOLE_ITEM or EQUIVALENT_COUNT if semantically appropriate, otherwise use NEEDS_UNIT_BRIDGE with bridgeQuestion and a positive unitsPerServing.',
  bridge_missing_units:
    '\n\nCORRECTION: You returned NEEDS_UNIT_BRIDGE without a valid positive unitsPerServing. Re-answer with bridgeQuestion (about ONE database serving → how many user units) and a finite positive unitsPerServing. Do not default to 1, the user quantity, or the database serving quantity.',
}

/**
 * Plain unbranded whole foods ("grilled salmon", "200 g chicken thigh", "brown rice") often
 * search to skin-on, raw, or recipe entries. A second "<food> cooked" search surfaces the
 * standard reference entries (USDA-style generics), which become trusted candidates.
 */
const PREP_WORDS = new Set([
  'grilled', 'baked', 'roasted', 'broiled', 'cooked', 'boiled', 'steamed', 'poached', 'braised',
  'stewed', 'smoked', 'seared', 'pan', 'sauteed', 'sautéed', 'air', 'oven', 'plain', 'fried',
])
const FILLER_WORDS = new Set(['of', 'a', 'an', 'the', 'some', 'and', 'with', 'my'])
/** Database descriptors — the lean ranking prefers them, but a name need not contain them. */
const DESCRIPTOR_WORDS = new Set([
  'meat', 'only', 'skinless', 'boneless', 'lean', 'trimmed', 'plain', 'fresh', 'unsalted', 'without',
  'no', 'salt', 'added', 'fat', 'not', 'eaten', 'skin', 'dry', 'heat', 'moist', 'drained',
])
const COOKED_MARKER_RE = /\b(cooked|roasted|broiled|baked|grilled|steamed|poached|boiled|braised|stewed|dry heat|moist heat)\b/i
const LEAN_MARKER_RE = /\b(skin not eaten|skinless|meat only|lean only|lean|trimmed|fat not added)\b/i
/** Variants we only offer when the user said the matching word. */
const CONDITIONAL_VARIANTS: { kind: string; re: RegExp; userRe: RegExp }[] = [
  { kind: 'fried', re: /\bfried\b/i, userRe: /\bfried\b/i },
  { kind: 'breaded', re: /\b(breaded|battered|coated|coating)\b/i, userRe: /\b(breaded|battered|coated|crispy|fried)\b/i },
  { kind: 'skin', re: /\b(skin eaten|with skin)\b/i, userRe: /\b(skin|skin-on)\b/i },
  { kind: 'raw', re: /\braw\b/i, userRe: /\braw\b/i },
  { kind: 'fat_added', re: /\bfat added\b/i, userRe: /\b(fried|sauteed|sautéed|oil|butter)\b/i },
]

function excludedVariant(name: string, userText: string, allowKinds: string[] = []): boolean {
  return CONDITIONAL_VARIANTS.some(
    (v) => !allowKinds.includes(v.kind) && v.re.test(name) && !v.userRe.test(userText),
  )
}
const COOKED_GENERIC_MAX_CORE_TOKENS = 3
const COOKED_GENERIC_PIN_COUNT = 3
const COOKED_GENERIC_NOTE =
  'Standard unbranded reference entry for the cooked food. Default for plain prepared whole foods (no brand named): lean/skinless, no added fat, not fried or breaded — unless the user said otherwise.'

function stem(token: string): string {
  return token.length > 3 && token.endsWith('s') ? token.slice(0, -1) : token
}

function wordTokens(s: string): string[] {
  return s.toLowerCase().split(/[^a-zà-ÿ]+/).filter(Boolean)
}

/** Core food words ("grilled chicken breast" → chicken breast) when the item is a plain whole food. */
export function plainWholeFoodCore(input: {
  name: string
  search: string
  unitFamily: string
}): { core: string[]; fried: boolean } | null {
  const tokens = wordTokens(input.search || input.name)
  if (tokens.length === 0) return null
  const hasPrep = tokens.some((t) => PREP_WORDS.has(t)) || wordTokens(input.name).some((t) => PREP_WORDS.has(t))
  if (!hasPrep && input.unitFamily !== 'mass') return null
  if (/\braw\b|\buncooked\b|\bdry\b/i.test(`${input.name} ${input.search}`)) return null
  const core = tokens.filter((t) => !PREP_WORDS.has(t) && !FILLER_WORDS.has(t))
  if (core.length === 0 || core.length > COOKED_GENERIC_MAX_CORE_TOKENS) return null
  return { core, fried: tokens.includes('fried') }
}

/**
 * Branded when a search word appears in a returned brand name but in no generic food name
 * ("kirkland" is a brand word; "apple" is not, even though "Apple & Eve" exists).
 */
export function searchNamesBrand(search: string, results: FatSecretFoodRef[]): boolean {
  const words = new Set(wordTokens(search).filter((t) => t.length > 2).map(stem))
  const genericWords = new Set<string>()
  for (const f of results) {
    if (!f.brandName) for (const t of wordTokens(f.name)) genericWords.add(stem(t))
  }
  for (const f of results) {
    if (!f.brandName) continue
    for (const b of wordTokens(f.brandName)) {
      const s = stem(b)
      if (b.length > 2 && words.has(s) && !genericWords.has(s)) return true
    }
  }
  return false
}

/** Unbranded plain-food core words, regardless of prep or unit ("half an avocado" → avocado). */
export function plainFoodCore(search: string): string[] | null {
  const core = wordTokens(search).filter((t) => !PREP_WORDS.has(t) && !FILLER_WORDS.has(t))
  return core.length > 0 && core.length <= COOKED_GENERIC_MAX_CORE_TOKENS ? core : null
}

const REFERENCE_MAX_CORE_TOKENS = 4

/**
 * Search for the standard reference entry named by the cross-check ("chicken breast grilled",
 * "avocado raw"). State words are dropped from the core; prepared or weighed foods search the
 * cooked form so skin-on / mixed-cut dish entries ("Grilled Chicken Breast") don't qualify.
 */
export function referenceFoodQuery(
  reference: string,
  plainCore: { fried: boolean } | null,
): { query: string; core: string[]; cooked: boolean } | null {
  const tokens = wordTokens(reference)
  const core = tokens.filter(
    (t) => !PREP_WORDS.has(t) && !FILLER_WORDS.has(t) && !DESCRIPTOR_WORDS.has(t) && t !== 'raw',
  )
  if (core.length === 0 || core.length > REFERENCE_MAX_CORE_TOKENS) return null
  const saysRaw = tokens.includes('raw')
  const cooked = !saysRaw && (plainCore != null || tokens.some((t) => PREP_WORDS.has(t)))
  if (!cooked) return { query: core.join(' '), core, cooked: false }
  const fried = plainCore?.fried || tokens.includes('fried')
  return { query: `${core.join(' ')} ${fried ? 'fried' : 'cooked'}`, core, cooked: true }
}

const PLAIN_GENERIC_PIN_COUNT = 2
const PLAIN_GENERIC_EXTRA_TOKENS = 2
const PLAIN_GENERIC_NOTE =
  'Standard unbranded entry for this plain food. The user named no brand or restaurant — prefer this over store-, restaurant-, or product-specific versions (which often use smaller or unusual portions).'

/** Generic entries from the main search whose name is essentially the plain food itself. */
export function pickPlainGenerics(
  foods: FatSecretFoodRef[],
  core: string[],
  userText: string,
  count = PLAIN_GENERIC_PIN_COUNT,
): FatSecretFoodRef[] {
  const coreStems = core.map(stem)
  return foods
    .filter((f) => !f.brandName && (!f.foodType || f.foodType === 'Generic'))
    .filter((f) => {
      const tokens = wordTokens(f.name)
      const stems = new Set(tokens.map(stem))
      return coreStems.every((c) => stems.has(c)) && tokens.length <= core.length + PLAIN_GENERIC_EXTRA_TOKENS
    })
    // Raw is the normal state of plain produce, nuts, and dairy.
    .filter((f) => !excludedVariant(f.name, userText, ['raw']))
    .sort((a, b) => wordTokens(a.name).length - wordTokens(b.name).length)
    .slice(0, count)
}

export function pickCookedGenerics(
  foods: FatSecretFoodRef[],
  core: string[],
  userText: string,
  count = COOKED_GENERIC_PIN_COUNT,
): FatSecretFoodRef[] {
  const coreStems = core.map(stem)
  const scored: { food: FatSecretFoodRef; score: number }[] = []
  for (const f of foods) {
    if (f.foodType && f.foodType !== 'Generic') continue
    if (f.brandName) continue
    const nameStems = new Set(wordTokens(f.name).map(stem))
    if (!coreStems.every((c) => nameStems.has(c))) continue
    const userSaidFried = /\bfried\b/i.test(userText)
    if (!COOKED_MARKER_RE.test(f.name) && !(userSaidFried && /\bfried\b/i.test(f.name))) continue
    if (excludedVariant(f.name, userText)) continue
    scored.push({ food: f, score: LEAN_MARKER_RE.test(f.name) ? 1 : 0 })
  }
  // Stable sort: lean entries first, otherwise FatSecret's relevance order.
  return scored
    .sort((a, b) => b.score - a.score)
    .slice(0, count)
    .map((s) => s.food)
}

const WHOLE_ITEM_MAX_GRAMS = 700
const CROSSCHECK_DISAGREEMENT_RATIO = 1.5
const CROSSCHECK_MIN_CAL_DIFF = 40
/** After a strong-model re-check, a gap this large means the database math is still broken. */
const CROSSCHECK_FALLBACK_RATIO = 3

type ResolvedResult = ReturnType<typeof resolveMacroEstimate>

type CrossCheck = { calories: number; protein: number; assumedProduct: string; referenceFood?: string }

type PassContext = {
  batchFoods: FatSecretFoodRef[]
  batchToFull: number[]
  promptUser: string
}

const FLAG_TEXT: Record<string, string> = {
  whole_item_recipe_serving: 'WHOLE_ITEM was used on a very large serving (likely a whole recipe or family-size total, not one portion)',
  calories_over_1500: 'the total is over 1500 calories for a single item',
  protein_exceeds_calories: 'protein grams × 4 exceed the calories (impossible)',
  zero_calories: 'the result is 0 calories',
  crosscheck_disagree: 'the result disagrees with an independent estimate by more than 1.5×',
  whole_item_measured_serving: 'one measured serving (cups/grams) was treated as the whole package the user ate — a measured serving is usually a fraction of a multi-serving package',
}

function calorieRatio(a: number, b: number): number {
  const hi = Math.max(a, b)
  const lo = Math.max(Math.min(a, b), 1)
  return hi / lo
}

function disagrees(a: number, b: number, ratio = CROSSCHECK_DISAGREEMENT_RATIO): boolean {
  return Math.abs(a - b) > CROSSCHECK_MIN_CAL_DIFF && calorieRatio(a, b) > ratio
}

function selectedServingInfo(
  json: MacroEstimateResponse,
  fatSecretResults: FatSecretFoodRef[],
  customFoods: MacroEstimateApiFood[],
): { description: string; grams: number | null; measured: boolean; label: string } | null {
  const sel = resolveSelectedServingDescription(json, fatSecretResults, customFoods)
  if (!sel) return null
  const fsIdx = typeof json.fatSecretIndex === 'number' ? json.fatSecretIndex : null
  const fsFood = fsIdx != null && json.libraryIndex == null ? fatSecretResults[fsIdx - 1] : undefined
  const label = fsFood?.brandName ? `${fsFood.brandName} ${sel.foodName}` : sel.foodName
  const kind = normalizeFatSecretServing(sel.servingDescription).kind
  return {
    description: sel.servingDescription,
    grams: parseServingBaseGrams(sel.servingDescription),
    measured: kind === 'mass' || kind === 'volume',
    label,
  }
}

/** A measured serving (cups/grams) bridged as ≥ this share of a package ≈ "the package is one serving". */
const WHOLE_PACKAGE_UNITS_PER_SERVING = 0.9
const PACKAGE_UNIT_RE = /^(containers?|bags?|packages?|packs?|box(es)?|kits?|tubs?|pints?|cartons?|jars?|pouch(es)?|trays?)$/i

export function plausibilityFlags(
  json: MacroEstimateResponse,
  result: Pick<ResolvedResult, 'calories' | 'protein'>,
  selected: { grams: number | null; measured: boolean } | null,
  userUnit: string,
): string[] {
  const flags: string[] = []
  if (json.relationshipV7 === 'WHOLE_ITEM' && selected?.grams != null && selected.grams > WHOLE_ITEM_MAX_GRAMS) {
    flags.push('whole_item_recipe_serving')
  }
  const wholePackageAsOneServing =
    json.relationshipV7 === 'WHOLE_ITEM' ||
    (json.relationshipV7 === 'NEEDS_UNIT_BRIDGE' &&
      typeof json.unitsPerServing === 'number' &&
      json.unitsPerServing >= WHOLE_PACKAGE_UNITS_PER_SERVING)
  if (wholePackageAsOneServing && selected?.measured && PACKAGE_UNIT_RE.test(userUnit.trim())) {
    flags.push('whole_item_measured_serving')
  }
  if (result.calories > 1500) flags.push('calories_over_1500')
  if (result.calories > 20 && result.protein * 4 > result.calories * 1.1) flags.push('protein_exceeds_calories')
  if (result.calories <= 0) flags.push('zero_calories')
  return flags
}

function toApiResult(
  result: ResolvedResult,
  fatSecretResults: FatSecretFoodRef[],
  fatSecretSource: MacroEstimateApiResult['fatSecretSource'],
  snapshot: MacroEstimateResponse,
): MacroEstimateApiResult {
  return {
    calories: result.calories,
    protein: result.protein,
    libraryFoodId: result.libraryFoodId,
    servingType: result.servingType,
    servingSize: result.servingSize,
    servingUnit: result.servingUnit,
    servingMultiplier: result.servingMultiplier,
    baseCalories: result.baseCalories,
    baseProtein: result.baseProtein,
    fatSecretResults,
    fatSecretSource,
    macroEstimateSnapshot: snapshot,
  }
}

export async function runMacroEstimate(
  env: EnvMacro,
  body: MacroEstimateApiBody,
  ctx: { profileId?: string | null } = {},
): Promise<MacroEstimateApiResult> {
  const customFoods = body.customFoods ?? []
  let fatSecretResults = body.fatSecretResults ?? []
  let fatSecretSource: MacroEstimateApiResult['fatSecretSource'] = fatSecretResults.length > 0 ? 'cache' : 'none'
  const userDatabasePick = Boolean(body.userDatabasePick)
  const skipFs = Boolean(body.skipFatSecretForAi)
  const userPickPath = userDatabasePick || skipFs || Boolean(body.aiFatSecretResults?.length)

  const estimateFields = macroEstimateInputFields({
    name: body.name,
    amount: body.amount,
    notes: body.notes,
    parseSnapshot: body.parseSnapshot,
    userInput: body.userInput,
  })
  const unitFamily = inferUnitFamily(estimateFields.unit, body.parseSnapshot)
  const userUnit =
    body.parseSnapshot?.unitSingular?.trim() || estimateFields.unit || body.parseSnapshot?.unit || 'serving'
  const resolveOpts = {
    userAmount: estimateFields.amount,
    quantity: estimateFields.quantity,
    unit: estimateFields.unit,
    consumption: body.parseSnapshot?.consumption ?? estimateFields.consumption,
    foodName: estimateFields.name,
    userInput: body.userInput,
  }
  const directResult = (calories: number, protein: number): ResolvedResult =>
    resolveMacroEstimate(
      { libraryIndex: null, fatSecretIndex: null, calories, protein, servingType: estimateFields.unit },
      [],
      [],
      resolveOpts,
    )

  // Numbers the user said beat any database pick (unless they hand-picked a match).
  if (!userPickPath) {
    const stated = parseStatedNutrition(body.parseSnapshot?.notes || body.notes)
    const applied = stated
      ? applyStatedNutrition(stated, {
          quantity: estimateFields.quantity,
          unit: estimateFields.unit,
          unitFamily,
        })
      : null
    if (applied) {
      const result = directResult(applied.calories, applied.protein)
      return toApiResult(result, fatSecretResults, fatSecretSource, {
        libraryIndex: null,
        fatSecretIndex: null,
        servingIndex: null,
        relationshipV7: null,
        calories: applied.calories,
        protein: applied.protein,
        servingType: estimateFields.unit,
        multiplier: result.servingMultiplier,
        statedNutritionApplied: true,
      })
    }
  }

  const searchQ = rewriteFatSecretSearch(body.fatSecretSearch?.trim() || '', body.userInput)
  if (!body.skipFatSecretFetch && searchQ && fatSecretResults.length === 0) {
    if (env.FATSECRET_CLIENT_ID && env.FATSECRET_CLIENT_SECRET) {
      try {
        fatSecretResults = await fatSecretSearchFoods(env, searchQ)
        fatSecretSource = fatSecretResults.length > 0 ? 'search' : 'none'
        if (fatSecretResults.length > 0) {
          fatSecretResults = await fatSecretEnrichServings(env, fatSecretResults, ENRICH_SERVINGS_COUNT)
        }
      } catch {
        /* FatSecret optional — continue with library + AI estimate */
      }
    }
  }
  const chatModel = body.model?.trim() || OPENAI_MODELS.chatFast

  // Cache hit — skip AI #2; code applies cached relationship + unitsPerServing
  if (body.v7CachedResolution && fatSecretResults.length > 0) {
    const cached = body.v7CachedResolution
    const json: MacroEstimateResponse = {
      libraryIndex: null,
      fatSecretIndex: cached.fatSecretIndex,
      servingIndex: cached.servingIndex,
      relationshipV7: cached.relationship,
      estimateQuantity: cached.estimateQuantity ?? null,
      estimateUnit: cached.estimateUnit ?? null,
      unitsPerServing: cached.unitsPerServing ?? null,
      calories: 0,
      protein: 0,
      servingType: estimateFields.unit,
      candidateAnnotationsJson: JSON.stringify(annotateFatSecretCandidates(fatSecretResults, userUnit)),
    }
    const withMult = applyV9ServingMath(json, estimateFields, fatSecretResults, customFoods, body.parseSnapshot)
    const result = resolveMacroEstimate(withMult, customFoods, fatSecretResults, resolveOpts)
    const { needsRelationshipRetry: _c, ...snap } = withMult
    return {
      ...toApiResult(result, fatSecretResults, fatSecretSource, {
        ...snap,
        multiplier: result.servingMultiplier ?? withMult.multiplier,
      }),
      v7CacheHit: true,
    }
  }

  const key = env.OPENAI_API_KEY
  if (!key) {
    const err = new Error('OPENAI_API_KEY missing')
    if (fatSecretResults.length > 0) Object.assign(err, { fatSecretResults, fatSecretSource })
    throw err
  }

  const macrosPrompt = await getMacroPrompt(env.DB, 'MACROS')

  const applyMathWithOptionalRetry = async (
    jsonIn: MacroEstimateResponse,
    promptUser: string,
    fatSecretForResolve: FatSecretFoodRef[],
    foodsForResolve: MacroEstimateApiFood[],
    model: string = chatModel,
  ): Promise<MacroEstimateResponse> => {
    let withMult = applyV9ServingMath(jsonIn, estimateFields, fatSecretForResolve, foodsForResolve, body.parseSnapshot)
    const reason = withMult.needsRelationshipRetry
    if (!reason) {
      const { needsRelationshipRetry: _n, ...rest } = withMult
      return { ...rest, relationshipRetryRan: false }
    }
    try {
      const retryRaw = await callOpenAiJsonWithRetry(
        key,
        macrosPrompt,
        `${promptUser}${RELATIONSHIP_RETRY_HINTS[reason]}`,
        {
          model,
          schema: MACROS_JSON_SCHEMA,
          validate: validateMacrosResponse,
          validationHint: (raw) => macrosValidationErrors(raw).join('; '),
        },
      )
      const retryJson = macrosAiToEstimateResponse(
        retryRaw as Parameters<typeof macrosAiToEstimateResponse>[0],
      )
      // Keep selection indices from the first answer unless retry provided valid ones.
      const merged: MacroEstimateResponse = {
        ...jsonIn,
        ...retryJson,
        libraryIndex: retryJson.libraryIndex ?? jsonIn.libraryIndex,
        fatSecretIndex: retryJson.fatSecretIndex ?? jsonIn.fatSecretIndex,
        servingIndex: retryJson.servingIndex ?? jsonIn.servingIndex,
        rawMacrosRetryJson: JSON.stringify(retryRaw),
        relationshipRetryRan: true,
      }
      withMult = applyV9ServingMath(merged, estimateFields, fatSecretForResolve, foodsForResolve, body.parseSnapshot)
      const { needsRelationshipRetry: _n2, ...rest } = withMult
      return {
        ...rest,
        rawMacrosRetryJson: JSON.stringify(retryRaw),
        relationshipRetryRan: true,
      }
    } catch {
      const { needsRelationshipRetry: _n3, ...rest } = withMult
      return { ...rest, relationshipRetryRan: true }
    }
  }

  const caseBrief = buildV7MacrosCaseBrief({
    userInput: body.userInput,
    name: estimateFields.name,
    quantity: estimateFields.quantity,
    unit: estimateFields.unit,
    unitFamily,
    estimated: estimateFields.estimated,
    originalPortion: estimateFields.originalPortion,
    notes: estimateFields.notes,
    fatSecretSearch: body.fatSecretSearch,
  })

  // User confirmed a single pick — keep prior behavior (no ranking batches, no second-guessing)
  if (userPickPath) {
    const fatSecretForAi = skipFs ? [] : (body.aiFatSecretResults ?? fatSecretResults)
    const userConfirmedFatSecret = userDatabasePick && !skipFs && fatSecretForAi.length > 0
    const classificationCtx = userDatabasePick
      ? formatClassificationContext({
          userInput: body.userInput,
          parseSnapshot: body.parseSnapshot,
        })
      : ''
    const foodLibraryBlock =
      userDatabasePick && userConfirmedFatSecret
        ? ''
        : formatNumberedFoodLibraryAnnotated(customFoods, userUnit)
    const user = `${caseBrief}${classificationCtx}${foodLibraryBlock}${formatNumberedFatSecretAnnotated(fatSecretForAi, userUnit)}${
      userConfirmedFatSecret
        ? '\n\nUser confirmed this database match. Use fatSecretIndex 1, pick the best servingIndex, and set the correct relationship (do not calculate a multiplier).'
        : ''
    }${
      skipFs
        ? '\n\nUser rejected database matches. Do not use FatSecret — use direct AI estimate (fatSecretIndex null).'
        : ''
    }${body.extraCtx ?? ''}`

    try {
      const raw = await callOpenAiJsonWithRetry(key, macrosPrompt, user, {
        model: chatModel,
        schema: MACROS_JSON_SCHEMA,
        validate: validateMacrosResponse,
        validationHint: (rawResp) => macrosValidationErrors(rawResp).join('; '),
      })
      const json = macrosAiToEstimateResponse(raw as Parameters<typeof macrosAiToEstimateResponse>[0])

      const selectedIdx =
        typeof body.fatSecretSelectedIndex === 'number' && body.fatSecretSelectedIndex >= 1
          ? Math.trunc(body.fatSecretSelectedIndex)
          : null
      const jsonForResolve: MacroEstimateResponse = {
        ...(skipFs
          ? { ...json, libraryIndex: null, fatSecretIndex: null }
          : selectedIdx != null
            ? {
                ...json,
                libraryIndex: null,
                fatSecretIndex: selectedIdx,
                servingIndex: json.servingIndex ?? 1,
              }
            : json),
        rawMacrosPass1Json: JSON.stringify(raw),
        candidateAnnotationsJson:
          fatSecretResults.length > 0
            ? JSON.stringify(annotateFatSecretCandidates(fatSecretResults, userUnit))
            : undefined,
      }

      const foodsForResolve = userConfirmedFatSecret ? [] : customFoods
      const withMult = await applyMathWithOptionalRetry(jsonForResolve, user, fatSecretForAi, foodsForResolve)
      const result = resolveMacroEstimate(withMult, foodsForResolve, fatSecretForAi, resolveOpts)
      return toApiResult(result, fatSecretResults, fatSecretSource, {
        ...withMult,
        multiplier: withMult.multiplier ?? result.servingMultiplier,
      })
    } catch (e) {
      if (fatSecretResults.length > 0) {
        const err = new Error(e instanceof Error ? e.message : 'Macro AI failed')
        Object.assign(err, { fatSecretResults, fatSecretSource })
        throw err
      }
      throw e
    }
  }

  // Independent sanity estimate runs alongside the database passes (no added latency).
  const crossCheckPromise: Promise<CrossCheck | null> = runCrossCheck(key, {
    userInput: body.userInput,
    name: estimateFields.name,
    quantity: estimateFields.quantity,
    unit: estimateFields.unit,
    estimated: estimateFields.estimated,
    originalPortion: estimateFields.originalPortion,
    notes: estimateFields.notes,
  })

  // Personal memory: products this user scanned / hand-picked before become pinned candidates.
  let memoryMatches: PersonalMemoryEntry[] = []
  if (ctx.profileId) {
    try {
      const entries = await loadPersonalMemory(env.DB, ctx.profileId)
      memoryMatches = matchPersonalMemory(entries, { name: estimateFields.name, fatSecretSearch: searchQ })
    } catch {
      memoryMatches = []
    }
  }
  const memoryFoodIds = new Set(memoryMatches.map((m) => m.food.foodId))
  const pinned: { food: FatSecretFoodRef; note: string }[] = memoryMatches.map((m) => ({
    food: m.food,
    note: describeMemoryEntry(m),
  }))
  const plainCore = plainWholeFoodCore({
    name: estimateFields.name,
    search: searchQ,
    unitFamily,
  })
  const unbranded = fatSecretResults.length > 0 && !searchNamesBrand(searchQ, fatSecretResults)
  const userText = `${estimateFields.name} ${searchQ}`
  let referencePicks = 0
  if (unbranded && env.FATSECRET_CLIENT_ID && env.FATSECRET_CLIENT_SECRET) {
    try {
      // The cross-check names the standard reference food only for plain whole foods (which
      // cut/variety a plain "chicken" means; empty for packaged/branded/restaurant items).
      // FatSecret supplies the numbers.
      const reference = (await crossCheckPromise)?.referenceFood?.trim().toLowerCase() || ''
      const plain = reference ? referenceFoodQuery(reference, plainCore) : null
      if (plain) {
        const found = await fatSecretSearchFoods(env, plain.query)
        const picks = plain.cooked
          ? pickCookedGenerics(found, plain.core, userText)
          : pickPlainGenerics(found, plain.core, userText)
        const enriched = picks.length > 0 ? await fatSecretEnrichServings(env, picks, picks.length) : []
        for (const food of enriched) {
          if (memoryFoodIds.has(food.foodId)) continue
          pinned.push({ food, note: plain.cooked ? COOKED_GENERIC_NOTE : PLAIN_GENERIC_NOTE })
          referencePicks++
        }
      }
    } catch {
      /* optional */
    }
  }
  const pinnedIds = new Set(pinned.map((p) => p.food.foodId))
  if (pinned.length > 0) {
    fatSecretResults = [...pinned.map((p) => p.food), ...fatSecretResults.filter((f) => !pinnedIds.has(f.foodId))]
  }
  const annotationsJson =
    fatSecretResults.length > 0
      ? JSON.stringify(annotateFatSecretCandidates(fatSecretResults, userUnit))
      : undefined

  // Default path: Pass 1 = top 12; Pass 2 = 13–50 + prior best when NEED_MORE_CANDIDATES
  const rankedRaw = rankFatSecretCandidates({
    foods: fatSecretResults,
    unitFamily,
    foodName: estimateFields.name,
    fatSecretSearch: body.fatSecretSearch ?? estimateFields.name,
    estimated: estimateFields.estimated,
    originalPortion: estimateFields.originalPortion,
  })
  const ranked =
    pinnedIds.size > 0
      ? [
          ...rankedRaw.filter((c) => pinnedIds.has(c.food.foodId)),
          ...rankedRaw.filter((c) => !pinnedIds.has(c.food.foodId)),
        ]
      : rankedRaw

  const memoryBlockFor = (batchFoods: FatSecretFoodRef[]): string => {
    if (pinned.length === 0) return ''
    const lines: string[] = []
    batchFoods.forEach((f, i) => {
      const p = pinned.find((e) => e.food.foodId === f.foodId)
      if (p) lines.push(`- FatSecret candidate ${i + 1} (${f.brandName ? `${f.brandName} ` : ''}${f.name}): ${p.note}`)
    })
    if (lines.length === 0) return ''
    return `\n\nTRUSTED CANDIDATES (user's own history / standard defaults):\n${lines.join('\n')}\nPrefer a history candidate when the current item is clearly the same product (same brand/product words or an obvious store-brand alias). Use the amount logged before to understand the user's container size (e.g. what "a can" meant last time). Ignore trusted candidates that are a different food.`
  }

  let json: MacroEstimateResponse | null = null
  let rawPass1Json: string | undefined
  let rawPass2Json: string | undefined
  let lastPromptUser = ''
  let finalPass: PassContext | null = null

  type PassResult = PassContext & {
    response: MacroEstimateResponse
    raw: unknown
    batch: RankedCandidate[]
  }

  const callPass = async (
    batch: RankedCandidate[],
    opts: { includeLibrary: boolean; passHint: string },
  ): Promise<PassResult> => {
    const batchFoods = foodsFromCandidateBatch(batch)
    const batchToFull = batch.map((c) => c.foodIndex + 1)
    const foodLibraryBlock = opts.includeLibrary
      ? formatNumberedFoodLibraryAnnotated(customFoods, userUnit)
      : ''
    const promptUser = `${caseBrief}${foodLibraryBlock}${formatNumberedFatSecretAnnotated(batchFoods, userUnit)}${memoryBlockFor(batchFoods)}${opts.passHint}${body.extraCtx ?? ''}`
    const raw = await callOpenAiJsonWithRetry(key, macrosPrompt, promptUser, {
      model: chatModel,
      schema: MACROS_JSON_SCHEMA,
      validate: validateMacrosResponse,
      validationHint: (r) => macrosValidationErrors(r).join('; '),
    })
    const response = macrosAiToEstimateResponse(raw as Parameters<typeof macrosAiToEstimateResponse>[0])
    return { response, raw, batch, batchFoods, batchToFull, promptUser }
  }

  try {
    // Plain whole foods with standard reference entries: choose among those (plus the user's own
    // history) first, so a loosely named generic ("Grilled Chicken", mixed cuts with skin) can't win.
    const pass1Count = referencePicks > 0 ? pinned.length : PASS1_CANDIDATE_COUNT
    const pass1Batch = takeCandidateBatch(ranked, 0, pass1Count)
    const pass1Intro =
      referencePicks > 0
        ? 'This is pass 1: standard reference entries for this plain food (and any matches from the user\'s own history).'
        : `This is pass 1: the top ${PASS1_CANDIDATE_COUNT} ranked FatSecret candidates.`
    const pass1 = await callPass(pass1Batch, {
      includeLibrary: true,
      passHint: `\n\n${pass1Intro}
If one is correct, select it and set relationship (DIRECT / EQUIVALENT_COUNT / WHOLE_ITEM / NEEDS_UNIT_BRIDGE).
If none are adequate, set relationship NEED_MORE_CANDIDATES. When requesting more, still set fatSecretIndex + servingIndex to your best candidate from this pass if any is remotely usable (so it can be carried into pass 2); use null only if every candidate is wrong.`,
    })
    rawPass1Json = JSON.stringify(pass1.raw)
    lastPromptUser = pass1.promptUser

    if (pass1.response.relationshipV7 === 'NEED_MORE_CANDIDATES') {
      const carry = candidateAtBatchIndex(pass1.batch, pass1.response.fatSecretIndex)
      const pass2Batch = buildPass2Candidates(ranked, pass1Count, carry)
      if (pass2Batch.length === 0) {
        json = null
      } else {
        const carryHint = carry
          ? `\n\nCandidate 1 is your previous best from pass 1 — keep it if nothing in this pass is better. Candidates 2+ are new (the next ranked candidates). Do not set NEED_MORE_CANDIDATES again — pick the best match or use direct estimate.`
          : `\n\nThis is pass 2: the next ranked candidates. No prior best was carried forward. Do not set NEED_MORE_CANDIDATES again — pick the best match or use direct estimate.`
        const pass2 = await callPass(pass2Batch, {
          includeLibrary: false,
          passHint: carryHint,
        })
        rawPass2Json = JSON.stringify(pass2.raw)
        lastPromptUser = pass2.promptUser
        if (
          pass2.response.relationshipV7 === 'NEED_MORE_CANDIDATES' ||
          pass2.response.relationshipV7 === 'WRONG_MATCH'
        ) {
          if (carry && pass1.response.fatSecretIndex != null) {
            json = remapBatchSelection(
              {
                ...pass1.response,
                relationshipV7: 'DIRECT',
              },
              pass1.batchFoods,
              pass1.batchToFull,
              fatSecretResults,
            )
            lastPromptUser = pass1.promptUser
            finalPass = pass1
          } else {
            json = null
          }
        } else {
          json = remapBatchSelection(
            pass2.response,
            pass2.batchFoods,
            pass2.batchToFull,
            fatSecretResults,
          )
          finalPass = pass2
        }
      }
    } else {
      json = remapBatchSelection(
        pass1.response,
        pass1.batchFoods,
        pass1.batchToFull,
        fatSecretResults,
      )
      finalPass = pass1
    }
  } catch (e) {
    if (fatSecretResults.length > 0) {
      const err = new Error(e instanceof Error ? e.message : 'Macro AI failed')
      Object.assign(err, { fatSecretResults, fatSecretSource })
      throw err
    }
    throw e
  }

  if (!json) {
    finalPass = null
    lastPromptUser = `${caseBrief}\n\nNo adequate FatSecret candidates. Use direct AI estimate (fatSecretIndex null, libraryIndex null).${body.extraCtx ?? ''}`
    const raw = await callOpenAiJsonWithRetry(key, macrosPrompt, lastPromptUser, {
      model: chatModel,
      schema: MACROS_JSON_SCHEMA,
      validate: validateMacrosResponse,
      validationHint: (r) => macrosValidationErrors(r).join('; '),
    })
    json = {
      ...macrosAiToEstimateResponse(raw as Parameters<typeof macrosAiToEstimateResponse>[0]),
      libraryIndex: null,
      fatSecretIndex: null,
      rawMacrosPass1Json: rawPass1Json ?? JSON.stringify(raw),
      rawMacrosPass2Json: rawPass2Json,
    }
  } else {
    json = {
      ...json,
      rawMacrosPass1Json: rawPass1Json,
      rawMacrosPass2Json: rawPass2Json,
      candidateAnnotationsJson: annotationsJson,
    }
  }

  let withMult = await applyMathWithOptionalRetry(json, lastPromptUser, fatSecretResults, customFoods)
  let result = resolveMacroEstimate(withMult, customFoods, fatSecretResults, resolveOpts)

  // Guardrails: plausibility + independent cross-check → one strong-model second opinion.
  const crossCheck = await crossCheckPromise
  const selected = selectedServingInfo(withMult, fatSecretResults, customFoods)
  const flags = plausibilityFlags(withMult, result, selected, userUnit)
  if (crossCheck && disagrees(result.calories, crossCheck.calories)) flags.push('crosscheck_disagree')
  if (crossCheck && flags.length === 1 && flags[0] === 'zero_calories' && crossCheck.calories < 15) {
    flags.length = 0 // genuinely ~0 cal (water, black coffee, diet soda)
  }
  let escalatedModel: string | undefined

  if (flags.length > 0) {
    try {
      const prevIdx =
        finalPass && typeof withMult.fatSecretIndex === 'number'
          ? finalPass.batchToFull.indexOf(withMult.fatSecretIndex) + 1
          : 0
      const prevLabel = selected
        ? `${prevIdx > 0 ? `FatSecret candidate ${prevIdx}` : withMult.libraryIndex ? `library food ${withMult.libraryIndex}` : 'a match'} "${selected.label}" with serving "${selected.description}" and relationship ${withMult.relationshipV7 ?? 'none'}`
        : 'a direct estimate'
      const crossLine = crossCheck
        ? ` An independent estimate without the database is about ${Math.round(crossCheck.calories)} cal / ${Math.round(crossCheck.protein)} g protein (assuming ${crossCheck.assumedProduct}).`
        : ''
      const hint = `\n\nSANITY CHECK (second opinion): A previous answer chose ${prevLabel}, which works out to ${result.calories} cal / ${result.protein} g protein for what the user ate.${crossLine} Problems: ${flags.map((f) => FLAG_TEXT[f] ?? f).join('; ')}.
Re-check: (1) Is this the exact product the user named (brand + product; no "mini", "snack size", "bites", or flavor variants they did not say)? (2) Is the serving one real portion, not a whole recipe, batch, family pack, or multi-serving total? (3) Is the relationship right — WHOLE_ITEM means one database serving = one whole user item; NEEDS_UNIT_BRIDGE unitsPerServing = how many user units are in ONE database serving? Return the corrected selection, or the same selection if it was right. Do not set NEED_MORE_CANDIDATES.`
      const escalatePrompt = `${finalPass ? finalPass.promptUser : lastPromptUser}${hint}`
      const raw2 = await callOpenAiJsonWithRetry(key, macrosPrompt, escalatePrompt, {
        model: OPENAI_MODELS.chatStrong,
        schema: MACROS_JSON_SCHEMA,
        validate: validateMacrosResponse,
        validationHint: (r) => macrosValidationErrors(r).join('; '),
      })
      let json2 = macrosAiToEstimateResponse(raw2 as Parameters<typeof macrosAiToEstimateResponse>[0])
      if (json2.relationshipV7 !== 'NEED_MORE_CANDIDATES' && json2.relationshipV7 !== 'WRONG_MATCH') {
        json2 = finalPass
          ? remapBatchSelection(json2, finalPass.batchFoods, finalPass.batchToFull, fatSecretResults)
          : { ...json2, libraryIndex: null, fatSecretIndex: null }
        const withMult2 = await applyMathWithOptionalRetry(
          {
            ...json2,
            rawMacrosPass1Json: rawPass1Json,
            rawMacrosPass2Json: rawPass2Json,
            rawMacrosRetryJson: JSON.stringify(raw2),
            candidateAnnotationsJson: annotationsJson,
          },
          escalatePrompt,
          fatSecretResults,
          customFoods,
          OPENAI_MODELS.chatStrong,
        )
        const result2 = resolveMacroEstimate(withMult2, customFoods, fatSecretResults, resolveOpts)
        const flags2 = plausibilityFlags(
          withMult2,
          result2,
          selectedServingInfo(withMult2, fatSecretResults, customFoods),
          userUnit,
        )
        const dist = (cal: number) => (crossCheck ? Math.abs(Math.log(Math.max(cal, 1) / Math.max(crossCheck.calories, 1))) : 0)
        const takeSecond = crossCheck
          ? dist(result2.calories) <= dist(result.calories) && result2.calories > 0
          : flags2.length < flags.length
        if (takeSecond) {
          withMult = withMult2
          result = result2
          escalatedModel = OPENAI_MODELS.chatStrong
        }
      }
    } catch {
      /* keep the first answer */
    }

    if (crossCheck && crossCheck.calories > 0) {
      // Disagreement alone is not enough: the cross-check also misreads fractions ("1/4 cup").
      const structural = plausibilityFlags(
        withMult,
        result,
        selectedServingInfo(withMult, fatSecretResults, customFoods),
        userUnit,
      )
      const stillBroken =
        result.calories <= 0 ||
        (structural.length > 0 && disagrees(result.calories, crossCheck.calories, CROSSCHECK_FALLBACK_RATIO))
      if (stillBroken) {
        flags.push('crosscheck_fallback')
        result = directResult(crossCheck.calories, crossCheck.protein)
        withMult = {
          ...withMult,
          libraryIndex: null,
          fatSecretIndex: null,
          servingIndex: null,
          relationshipV7: null,
          calories: crossCheck.calories,
          protein: crossCheck.protein,
          multiplier: result.servingMultiplier,
        }
      }
    }
  }

  const memoryHit =
    typeof withMult.fatSecretIndex === 'number' &&
    memoryFoodIds.has(fatSecretResults[withMult.fatSecretIndex - 1]?.foodId ?? '')

  return toApiResult(result, fatSecretResults, fatSecretSource, {
    ...withMult,
    multiplier: withMult.multiplier ?? result.servingMultiplier,
    candidateAnnotationsJson: annotationsJson,
    ...(flags.length > 0 ? { guardrailFlags: flags } : {}),
    ...(crossCheck ? { crossCheckCalories: Math.round(crossCheck.calories) } : {}),
    ...(crossCheck?.referenceFood ? { crossCheckReference: crossCheck.referenceFood } : {}),
    ...(escalatedModel ? { escalatedModel } : {}),
    ...(memoryHit ? { personalMemoryHit: true } : {}),
  })
}

async function runCrossCheck(
  key: string,
  input: {
    userInput?: string
    name: string
    quantity: number
    unit: string
    estimated?: boolean
    originalPortion?: string
    notes?: string
  },
): Promise<CrossCheck | null> {
  const portion = input.estimated && input.originalPortion?.trim()
    ? ` (estimated from "${input.originalPortion.trim()}")`
    : ''
  const said = input.userInput?.trim() ? `The user said: "${input.userInput.trim()}"\n` : ''
  const notes = input.notes?.trim() ? `\nNotes: ${input.notes.trim()}` : ''
  const user = `${said}Current item: ${input.name}\nAmount eaten: ${input.quantity} ${input.unit}${portion}${notes}`
  try {
    const raw = (await callOpenAiJsonWithRetry(key, MACROS_CROSSCHECK_PROMPT, user, {
      model: OPENAI_MODELS.chatFast,
      schema: MACROS_CROSSCHECK_JSON_SCHEMA,
      validate: (r) => {
        const o = r as Partial<CrossCheck> | null
        return Boolean(o && typeof o.calories === 'number' && o.calories >= 0 && typeof o.protein === 'number')
      },
      maxAttempts: 2,
    })) as CrossCheck
    return raw
  } catch {
    return null
  }
}
