import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fatSecretEnrichServings, fatSecretSearchFoods, type FatSecretFoodRef } from './fatsecret'
import { callOpenAiJsonWithRetry } from './openaiJson'
import { runMacroEstimate, type MacroEstimateApiBody } from './macroEstimate'
import { parseSnapshotFromItem } from '../src/features/macro/macroLib'

vi.mock('./fatsecret', () => ({
  fatSecretSearchFoods: vi.fn(),
  fatSecretEnrichServings: vi.fn(),
}))
vi.mock('./macroPromptsStore', () => ({ getMacroPrompt: vi.fn().mockResolvedValue('match') }))
vi.mock('./openaiJson', () => ({ callOpenAiJsonWithRetry: vi.fn() }))

const search = vi.mocked(fatSecretSearchFoods)
const enrich = vi.mocked(fatSecretEnrichServings)
const ai = vi.mocked(callOpenAiJsonWithRetry)
const env = {
  DB: {} as Parameters<typeof runMacroEstimate>[0]['DB'],
  OPENAI_API_KEY: 'test',
  FATSECRET_CLIENT_ID: 'test',
  FATSECRET_CLIENT_SECRET: 'test',
}
const salad: FatSecretFoodRef = {
  foodId: '62724672',
  name: 'Miso Crunch Chopped Salad',
  brandName: "Trader Joe's",
  foodType: 'Brand',
  servings: [{ servingId: '62724672-0', description: '1 cup (100 g)', calories: 170, protein: 3, isDefault: true }],
}

function body(notes: string): MacroEstimateApiBody {
  const userInput = "180 grams of grilled chicken and an entire Trader Joe's Miso Crunch, which is four servings, for a total of 170 calories per serving."
  const parseSnapshot = parseSnapshotFromItem({
    name: 'Miso Crunch Salad', emoji: '🥗', quantity: 4, unitSingular: 'serving',
    unitPlural: 'servings', unitFamily: 'serving', estimated: false, originalPortion: '',
    fatSecretSearch: "Trader Joe's Miso Crunch Salad", notes,
  }, { userInput })
  return { name: parseSnapshot.name, amount: parseSnapshot.amount, notes, fatSecretSearch: parseSnapshot.fatSecretSearch, parseSnapshot, userInput }
}

describe('spoken nutrition lookup', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    search.mockResolvedValue([salad])
    enrich.mockImplementation(async (_env, foods) => foods)
    ai.mockImplementation(async (_key, system) => system.startsWith('match')
      ? {
          libraryIndex: null, fatSecretIndex: 1, servingIndex: 1, relationship: 'NEEDS_UNIT_BRIDGE',
          bridgeQuestion: 'How many label servings are in one cup of this product?', unitsPerServing: 1,
          calories: 0, protein: 0, servingType: 'serving',
        }
      : { calories: 680, protein: 12, assumedProduct: salad.name })
  })

  it('searches the saved Miso Crunch query and fills protein for all four servings', async () => {
    const result = await runMacroEstimate(env, body('170 calories per serving, 680 calories total'))
    expect(search).toHaveBeenCalledWith(env, "Trader Joe's Miso Crunch Salad")
    expect(result).toMatchObject({
      calories: 680, protein: 12, baseCalories: 170, baseProtein: 3, servingMultiplier: 4,
      fatSecretSource: 'search', macroEstimateSnapshot: { fatSecretIndex: 1, statedNutritionApplied: true },
    })
  })

  it('looks up calories when the user only gives protein', async () => {
    const result = await runMacroEstimate(env, body('4 g protein per serving'))
    expect(search).toHaveBeenCalledOnce()
    expect(result).toMatchObject({
      calories: 680, protein: 16, macroEstimateSnapshot: { statedNutritionConflict: true },
    })
  })

  it('skips lookup for complete nutrition, including explicit zero protein', async () => {
    const result = await runMacroEstimate(env, body('170 calories and 0 g protein per serving'))
    expect(result).toMatchObject({ calories: 680, protein: 0, fatSecretSource: 'none' })
    expect(search).not.toHaveBeenCalled()
    expect(ai).not.toHaveBeenCalled()
  })

  it('keeps the stated total and leaves protein unknown when no reliable match exists', async () => {
    search.mockRejectedValue(new Error('No matching foods'))
    ai.mockResolvedValue({ calories: 680, protein: 30, assumedProduct: 'generic salad' })
    const result = await runMacroEstimate(env, body('170 calories per serving, 680 calories total'))
    expect(search).toHaveBeenCalledOnce()
    expect(result.calories).toBe(680)
    expect(result.protein).toBeUndefined()
    expect(result.baseProtein).toBeUndefined()
  })

  it('keeps protein unknown when the matching database serving omits it', async () => {
    const { parseFatSecretSearchJson } = await vi.importActual<typeof import('./fatsecret')>('./fatsecret')
    search.mockResolvedValue(parseFatSecretSearchJson({ foods: { food: {
      food_id: salad.foodId, food_name: salad.name, brand_name: salad.brandName, food_type: salad.foodType,
      food_description: 'Per 1 cup - Calories: 170kcal | Fat: 11g | Carbs: 16g',
    } } }))
    const result = await runMacroEstimate(env, body('170 calories per serving, 680 calories total'))
    expect(result.calories).toBe(680)
    expect(result.protein).toBeUndefined()
  })
})
