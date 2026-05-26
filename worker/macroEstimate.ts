import {
  buildMacroEstimatePrompt,
  formatNumberedFatSecret,
  formatNumberedFoodLibrary,
  resolveMacroEstimate,
  type MacroEstimateResponse,
} from '../src/features/macro/macroLib'
import { MACRO_PROMPTS } from '../src/features/macro/prompts'
import type { FatSecretFoodRef } from './fatsecret'
import { fatSecretSearchFoods, type FatSecretSearchResult } from './fatsecret'
import type { FatSecretRoute } from '../src/types/domain'
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
  fatSecretRoute?: FatSecretRoute
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
  fatSecretRoute?: FatSecretRoute
  macroEstimateSnapshot: MacroEstimateResponse
}

type EnvMacro = {
  OPENAI_API_KEY?: string
  FATSECRET_CLIENT_ID?: string
  FATSECRET_CLIENT_SECRET?: string
  FATSECRET_LOCAL_EGRESS?: string
  FATSECRET_RELAY_URL?: string
  FATSECRET_RELAY_SECRET?: string
}

export async function runMacroEstimate(env: EnvMacro, body: MacroEstimateApiBody): Promise<MacroEstimateApiResult> {
  const customFoods = body.customFoods ?? []
  let fatSecretResults = body.fatSecretResults ?? []
  let fatSecretRoute: FatSecretRoute | undefined = body.fatSecretRoute
  let fatSecretSource: MacroEstimateApiResult['fatSecretSource'] = fatSecretResults.length > 0 ? 'cache' : 'none'

  const searchQ = body.fatSecretSearch?.trim()
  if (!body.skipFatSecretFetch && searchQ && fatSecretResults.length === 0) {
    if (env.FATSECRET_CLIENT_ID && env.FATSECRET_CLIENT_SECRET) {
      try {
        const searched: FatSecretSearchResult = await fatSecretSearchFoods(env, searchQ)
        fatSecretResults = searched.foods
        fatSecretRoute = searched.route
        fatSecretSource = fatSecretResults.length > 0 ? 'search' : 'none'
      } catch {
        /* FatSecret optional — continue with library + AI estimate */
      }
    }
  }

  const key = env.OPENAI_API_KEY
  if (!key) {
    const err = new Error('OPENAI_API_KEY missing')
    if (fatSecretResults.length > 0) Object.assign(err, { fatSecretResults, fatSecretSource, fatSecretRoute })
    throw err
  }

  const user = `${buildMacroEstimatePrompt(body.name, body.amount, body.notes)}${formatNumberedFoodLibrary(customFoods)}${formatNumberedFatSecret(fatSecretResults)}${body.extraCtx ?? ''}`

  try {
    const json = (await callOpenAiJson(key, MACRO_PROMPTS.MACROS, user)) as MacroEstimateResponse
    const result = resolveMacroEstimate(json, customFoods, fatSecretResults)

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
      fatSecretRoute,
      macroEstimateSnapshot: json,
    }
  } catch (e) {
    if (fatSecretResults.length > 0) {
      const err = new Error(e instanceof Error ? e.message : 'Macro AI failed')
      Object.assign(err, { fatSecretResults, fatSecretSource, fatSecretRoute })
      throw err
    }
    throw e
  }
}
