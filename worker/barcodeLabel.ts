import { parseAiDiaryName, parseAiEmoji } from '../src/features/macro/macroLib'
import type { FatSecretFoodRef } from './fatsecret'
import { getMacroPrompt } from './macroPromptsStore'
import { callOpenAiJson } from './openaiJson'

export type BarcodeFoodLabel = {
  name: string
  emoji: string
}

function fatSecretDisplayName(food: FatSecretFoodRef): string {
  return food.brandName ? `${food.brandName} ${food.name}`.trim() : food.name
}

export async function pickBarcodeFoodLabel(
  db: D1Database,
  apiKey: string | undefined,
  food: FatSecretFoodRef,
): Promise<BarcodeFoodLabel> {
  const fallbackName = fatSecretDisplayName(food)
  const fallback: BarcodeFoodLabel = { name: fallbackName, emoji: '🍱' }
  if (!apiKey) return fallback

  const serving = food.servings.find((s) => s.isDefault) ?? food.servings[0]
  const user = [
    `Database product name: ${food.name}`,
    food.brandName ? `Brand: ${food.brandName}` : '',
    serving ? `Serving: ${serving.description}` : '',
  ]
    .filter(Boolean)
    .join('\n')

  try {
    const system = await getMacroPrompt(db, 'BARCODE_SCAN')
    const result = (await callOpenAiJson(apiKey, system, user)) as { name?: string; emoji?: string }
    return {
      name: parseAiDiaryName(result?.name, fallbackName),
      emoji: parseAiEmoji(result?.emoji),
    }
  } catch {
    return fallback
  }
}
