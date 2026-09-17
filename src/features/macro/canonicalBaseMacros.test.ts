import { describe, expect, it } from 'vitest'
import type { FatSecretFoodRef, MacroDayItem } from '../../types/domain'
import {
  backfillMacroItemServingFields,
  resolveCanonicalBaseMacros,
  resolveMacroEstimate,
} from './macroLib'

const grilledChickenFs: FatSecretFoodRef[] = [
  {
    foodId: '1',
    name: 'Skinless Chicken Breast',
    servings: [{ servingId: '1', description: '100g', calories: 165, protein: 31, isDefault: true }],
  },
  {
    foodId: '2',
    name: 'Grilled Chicken Breast',
    servings: [{ servingId: '1', description: '101g', calories: 197, protein: 29.8, isDefault: true }],
  },
]

function chickenItem(overrides: Partial<MacroDayItem> = {}): MacroDayItem {
  return {
    id: 'chicken',
    status: 'ready',
    name: 'Chicken Breast',
    emoji: '🍗',
    amount: '168 g',
    calories: 327,
    protein: 49.5,
    servingType: 'g',
    servingSize: 1,
    servingUnit: 'g',
    servingMultiplier: 168,
    baseCalories: 2,
    baseProtein: 0.3,
    fatSecretResults: grilledChickenFs,
    macroEstimateSnapshot: {
      libraryIndex: null,
      fatSecretIndex: 2,
      servingIndex: 1,
      relationshipV7: 'DIRECT',
      calories: 0,
      protein: 0,
      servingType: 'g',
    },
    timestamp: Date.now(),
    ...overrides,
  }
}

describe('resolveCanonicalBaseMacros display vs FatSecret serving', () => {
  it('uses per-gram base for mass display rows, not full FS serving calories', () => {
    const base = resolveCanonicalBaseMacros(chickenItem())
    expect(base?.baseCalories).toBe(2)
    expect(base?.baseProtein).toBe(0.3)
  })

  it('keeps raw FS serving base for barcode rows (multiplier = serving count)', () => {
    const item = chickenItem({
      fromBarcode: true,
      amount: '1 serving',
      servingType: '101g',
      servingSize: 101,
      servingUnit: 'g',
      servingMultiplier: 2,
      baseCalories: 197,
      baseProtein: 29.8,
      calories: 394,
      protein: 59.6,
    })
    const base = resolveCanonicalBaseMacros(item)
    expect(base?.baseCalories).toBe(197)
    expect(base?.baseProtein).toBe(29.8)
  })
})

describe('backfillMacroItemServingFields', () => {
  it('does not blow up correct gram estimates on load', () => {
    const before = chickenItem()
    const after = backfillMacroItemServingFields(before)
    expect(after.calories).toBe(327)
    expect(after.protein).toBe(49.5)
    expect(after.baseCalories).toBe(2)
  })

  it('heals corrupt grams × full-serving base (chicken bug)', () => {
    const corrupt = chickenItem({
      baseCalories: 197,
      baseProtein: 29.8,
      calories: 33096,
      protein: 5006.4,
    })
    const after = backfillMacroItemServingFields(corrupt)
    expect(after.calories).toBe(327)
    expect(after.protein).toBe(49.5)
    expect(after.baseCalories).toBe(2)
    expect(after.baseProtein).toBe(0.3)
  })

  it('matches resolveMacroEstimate totals for 168g grilled chicken', () => {
    const resolved = resolveMacroEstimate(
      {
        libraryIndex: null,
        fatSecretIndex: 2,
        servingIndex: 1,
        relationshipV7: 'DIRECT',
        calories: 0,
        protein: 0,
        servingType: 'g',
      },
      [],
      grilledChickenFs,
      { quantity: 168, unit: 'g', userAmount: '168 g' },
    )
    const healed = backfillMacroItemServingFields(
      chickenItem({
        baseCalories: 197,
        baseProtein: 29.8,
        calories: 33096,
        protein: 5006.4,
      }),
    )
    expect(healed.calories).toBe(resolved.calories)
    expect(healed.protein).toBe(resolved.protein)
  })
})
