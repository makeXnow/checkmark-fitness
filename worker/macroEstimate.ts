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
import { fatSecretSearchFoods } from './fatsecret'
import { getMacroPrompt } from './macroPromptsStore'
import { callOpenAiJsonWithRetry } from './openaiJson'
import { MACROS_JSON_SCHEMA, type UnitFamily, type V7ServingRelationship } from '../src/features/macro/macroAiSchemas'
import {
  hasValidUnitsPerServing,
  macrosValidationErrors,
  validateMacrosResponse,
} from '../src/features/macro/macroAiValidate'
import {
  buildPass2Candidates,
  foodsFromCandidateBatch,
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

export async function runMacroEstimate(env: EnvMacro, body: MacroEstimateApiBody): Promise<MacroEstimateApiResult> {
  const customFoods = body.customFoods ?? []
  let fatSecretResults = body.fatSecretResults ?? []
  let fatSecretSource: MacroEstimateApiResult['fatSecretSource'] = fatSecretResults.length > 0 ? 'cache' : 'none'

  const searchQ = body.fatSecretSearch?.trim()
  if (!body.skipFatSecretFetch && searchQ && fatSecretResults.length === 0) {
    if (env.FATSECRET_CLIENT_ID && env.FATSECRET_CLIENT_SECRET) {
      try {
        fatSecretResults = await fatSecretSearchFoods(env, searchQ)
        fatSecretSource = fatSecretResults.length > 0 ? 'search' : 'none'
      } catch {
        /* FatSecret optional — continue with library + AI estimate */
      }
    }
  }

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

  const annotationsJson =
    fatSecretResults.length > 0
      ? JSON.stringify(annotateFatSecretCandidates(fatSecretResults, userUnit))
      : undefined

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
      candidateAnnotationsJson: annotationsJson,
    }
    const withMult = applyV9ServingMath(json, estimateFields, fatSecretResults, customFoods, body.parseSnapshot)
    const result = resolveMacroEstimate(withMult, customFoods, fatSecretResults, {
      userAmount: estimateFields.amount,
      quantity: estimateFields.quantity,
      unit: estimateFields.unit,
      consumption: body.parseSnapshot?.consumption ?? estimateFields.consumption,
      foodName: estimateFields.name,
      userInput: body.userInput,
    })
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
      macroEstimateSnapshot: {
        ...withMult,
        multiplier: result.servingMultiplier ?? withMult.multiplier,
        needsRelationshipRetry: undefined,
      },
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

  const userDatabasePick = Boolean(body.userDatabasePick)
  const skipFs = Boolean(body.skipFatSecretForAi)

  // User confirmed a single pick — keep prior behavior (no ranking batches)
  if (userDatabasePick || skipFs || body.aiFatSecretResults?.length) {
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
        candidateAnnotationsJson: annotationsJson,
      }

      const foodsForResolve = userConfirmedFatSecret ? [] : customFoods
      const withMult = await applyMathWithOptionalRetry(
        jsonForResolve,
        user,
        fatSecretForAi,
        foodsForResolve,
      )
      const result = resolveMacroEstimate(withMult, foodsForResolve, fatSecretForAi, {
        userAmount: estimateFields.amount,
        quantity: estimateFields.quantity,
        unit: estimateFields.unit,
        consumption: body.parseSnapshot?.consumption ?? estimateFields.consumption,
        foodName: estimateFields.name,
        userInput: body.userInput,
      })

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
        macroEstimateSnapshot: {
          ...withMult,
          multiplier: withMult.multiplier ?? result.servingMultiplier,
        },
      }
    } catch (e) {
      if (fatSecretResults.length > 0) {
        const err = new Error(e instanceof Error ? e.message : 'Macro AI failed')
        Object.assign(err, { fatSecretResults, fatSecretSource })
        throw err
      }
      throw e
    }
  }

  // Default path: Pass 1 = top 12; Pass 2 = 13–50 + prior best when NEED_MORE_CANDIDATES
  const ranked = rankFatSecretCandidates({
    foods: fatSecretResults,
    unitFamily,
    foodName: estimateFields.name,
    fatSecretSearch: body.fatSecretSearch ?? estimateFields.name,
    estimated: estimateFields.estimated,
    originalPortion: estimateFields.originalPortion,
  })

  let json: MacroEstimateResponse | null = null
  let rawPass1Json: string | undefined
  let rawPass2Json: string | undefined
  let lastPromptUser = ''

  type PassResult = {
    response: MacroEstimateResponse
    raw: unknown
    batch: RankedCandidate[]
    batchFoods: FatSecretFoodRef[]
    batchToFull: number[]
    promptUser: string
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
    const promptUser = `${caseBrief}${foodLibraryBlock}${formatNumberedFatSecretAnnotated(batchFoods, userUnit)}${opts.passHint}${body.extraCtx ?? ''}`
    const raw = await callOpenAiJsonWithRetry(key, macrosPrompt, promptUser, {
      schema: MACROS_JSON_SCHEMA,
      validate: validateMacrosResponse,
      validationHint: (r) => macrosValidationErrors(r).join('; '),
    })
    const response = macrosAiToEstimateResponse(raw as Parameters<typeof macrosAiToEstimateResponse>[0])
    return { response, raw, batch, batchFoods, batchToFull, promptUser }
  }

  try {
    const pass1Batch = takeCandidateBatch(ranked, 0, PASS1_CANDIDATE_COUNT)
    const pass1 = await callPass(pass1Batch, {
      includeLibrary: true,
      passHint: `\n\nThis is pass 1: the top ${PASS1_CANDIDATE_COUNT} ranked FatSecret candidates.
If one is correct, select it and set relationship (DIRECT / EQUIVALENT_COUNT / WHOLE_ITEM / NEEDS_UNIT_BRIDGE).
If none are adequate, set relationship NEED_MORE_CANDIDATES. When requesting more, still set fatSecretIndex + servingIndex to your best candidate from this pass if any is remotely usable (so it can be carried into pass 2); use null only if every candidate is wrong.`,
    })
    rawPass1Json = JSON.stringify(pass1.raw)
    lastPromptUser = pass1.promptUser

    if (pass1.response.relationshipV7 === 'NEED_MORE_CANDIDATES') {
      const carry = candidateAtBatchIndex(pass1.batch, pass1.response.fatSecretIndex)
      const pass2Batch = buildPass2Candidates(ranked, PASS1_CANDIDATE_COUNT, carry)
      if (pass2Batch.length === 0) {
        json = null
      } else {
        const carryHint = carry
          ? `\n\nCandidate 1 is your previous best from pass 1 — keep it if nothing in this pass is better. Candidates 2+ are new (ranked 13–50). Do not set NEED_MORE_CANDIDATES again — pick the best match or use direct estimate.`
          : `\n\nThis is pass 2: remaining ranked candidates (13–50). No prior best was carried forward. Do not set NEED_MORE_CANDIDATES again — pick the best match or use direct estimate.`
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
        }
      }
    } else {
      json = remapBatchSelection(
        pass1.response,
        pass1.batchFoods,
        pass1.batchToFull,
        fatSecretResults,
      )
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
    lastPromptUser = `${caseBrief}\n\nNo adequate FatSecret candidates. Use direct AI estimate (fatSecretIndex null, libraryIndex null).${body.extraCtx ?? ''}`
    const raw = await callOpenAiJsonWithRetry(key, macrosPrompt, lastPromptUser, {
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

  const withMult = await applyMathWithOptionalRetry(json, lastPromptUser, fatSecretResults, customFoods)
  const result = resolveMacroEstimate(withMult, customFoods, fatSecretResults, {
    userAmount: estimateFields.amount,
    quantity: estimateFields.quantity,
    unit: estimateFields.unit,
    consumption: body.parseSnapshot?.consumption ?? estimateFields.consumption,
    foodName: estimateFields.name,
    userInput: body.userInput,
  })

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
    macroEstimateSnapshot: {
      ...withMult,
      multiplier: withMult.multiplier ?? result.servingMultiplier,
      candidateAnnotationsJson: annotationsJson,
    },
  }
}
