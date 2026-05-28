import {
  buildMacroEstimatePrompt,
  formatClassificationContext,
  formatNumberedFatSecret,
  formatNumberedFoodLibrary,
  macroEstimateInputFields,
  resolveMacroEstimate,
  type MacroEstimateResponse,
} from '../src/features/macro/macroLib'
import type { FatSecretFoodRef } from './fatsecret'
import type { MacroParseSnapshot } from '../src/types/domain'
import { fatSecretSearchFoods } from './fatsecret'
import { getMacroPrompt } from './macroPromptsStore'
import { callOpenAiJson } from './openaiJson'

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
}

export type MacroEstimateApiResult = {
  calories: number
  protein: number
  libraryFoodId?: string
  servingType?: string
  servingMultiplier?: number
  baseCalories?: number
  baseProtein?: number
  fatSecretResults: FatSecretFoodRef[]
  fatSecretSource: 'cache' | 'search' | 'none'
  macroEstimateSnapshot: MacroEstimateResponse
}

type EnvMacro = {
  DB: D1Database
  OPENAI_API_KEY?: string
  FATSECRET_CLIENT_ID?: string
  FATSECRET_CLIENT_SECRET?: string
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

  const key = env.OPENAI_API_KEY
  if (!key) {
    const err = new Error('OPENAI_API_KEY missing')
    if (fatSecretResults.length > 0) Object.assign(err, { fatSecretResults, fatSecretSource })
    throw err
  }

  const fatSecretForAi = body.skipFatSecretForAi ? [] : (body.aiFatSecretResults ?? fatSecretResults)
  const userDatabasePick = Boolean(body.userDatabasePick)
  const userConfirmedFatSecret =
    userDatabasePick && !body.skipFatSecretForAi && fatSecretForAi.length > 0
  const estimateFields = macroEstimateInputFields({
    name: body.name,
    amount: body.amount,
    notes: body.notes,
    parseSnapshot: body.parseSnapshot,
  })
  const classificationCtx = userDatabasePick
    ? formatClassificationContext({
        userInput: body.userInput,
        parseSnapshot: body.parseSnapshot,
      })
    : ''
  const foodLibraryBlock =
    userDatabasePick && userConfirmedFatSecret ? '' : formatNumberedFoodLibrary(customFoods)
  const user = `${buildMacroEstimatePrompt(estimateFields.name, estimateFields.amount, estimateFields.notes)}${classificationCtx}${foodLibraryBlock}${formatNumberedFatSecret(fatSecretForAi)}${
    userConfirmedFatSecret
      ? '\n\nUser confirmed this database match. Use fatSecretIndex 1, pick the best servingIndex and multiplier for the user\'s portion, and do not use library or direct AI estimate instead.'
      : ''
  }${
    body.skipFatSecretForAi
      ? '\n\nUser rejected database matches. Do not use FatSecret — use direct AI estimate (libraryIndex null, fatSecretIndex null).'
      : ''
  }${body.extraCtx ?? ''}`

  try {
    const macrosPrompt = await getMacroPrompt(env.DB, 'MACROS')
    const json = (await callOpenAiJson(key, macrosPrompt, user)) as MacroEstimateResponse
    const selectedIdx =
      typeof body.fatSecretSelectedIndex === 'number' && body.fatSecretSelectedIndex >= 1
        ? Math.trunc(body.fatSecretSelectedIndex)
        : null
    const jsonForResolve: MacroEstimateResponse = body.skipFatSecretForAi
      ? { ...json, libraryIndex: null, fatSecretIndex: null }
      : selectedIdx != null
        ? { ...json, libraryIndex: null, fatSecretIndex: selectedIdx, servingIndex: json.servingIndex ?? 1 }
        : json
    const foodsForResolve = userConfirmedFatSecret ? [] : customFoods
    const result = resolveMacroEstimate(jsonForResolve, foodsForResolve, fatSecretForAi, {
      userAmount: estimateFields.amount,
    })
    const macroEstimateSnapshot: MacroEstimateResponse = {
      ...jsonForResolve,
      multiplier: result.servingMultiplier ?? jsonForResolve.multiplier,
    }

    return {
      calories: result.calories,
      protein: result.protein,
      libraryFoodId: result.libraryFoodId,
      servingType: result.servingType,
      servingMultiplier: result.servingMultiplier,
      baseCalories: result.baseCalories,
      baseProtein: result.baseProtein,
      fatSecretResults,
      fatSecretSource,
      macroEstimateSnapshot,
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
