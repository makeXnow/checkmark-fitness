import { describe, expect, it } from 'vitest'
import { computeV8Multiplier } from './macroV8Resolve'
import { parseDbCountServing } from './macroMass'
import { effectiveFatSecretServingDescription } from './macroServingResolve'
import { applyStatedNutrition, parseStatedNutrition } from './macroStatedNutrition'
import { mergeMacroDayItem } from './macroLib'
import { rewriteSpokenFoodLog } from './macroBrandAliases'
import { validateMacrosResponse } from './macroAiValidate'

describe('WHOLE_ITEM multiplier', () => {
  it('does not divide by the piece count of the whole-order serving', () => {
    const r = computeV8Multiplier({
      quantity: 1,
      unit: 'order',
      relationship: 'WHOLE_ITEM',
      servingDescription: '5 pieces',
    })
    expect(r.multiplier).toBe(1)
  })

  it('scales by the user quantity', () => {
    const r = computeV8Multiplier({
      quantity: 0.5,
      unit: 'sandwich',
      relationship: 'WHOLE_ITEM',
      servingDescription: '1 serving',
    })
    expect(r.multiplier).toBe(0.5)
  })
})

describe('EQUIVALENT_COUNT', () => {
  it('refuses a generic "1 serving" (not one piece)', () => {
    const r = computeV8Multiplier({
      quantity: 4,
      unit: 'nugget',
      relationship: 'EQUIVALENT_COUNT',
      servingDescription: '1 serving',
    })
    expect(r.multiplier).toBeNull()
  })

  it('uses the piece count from the food name ("5 Ct")', () => {
    const desc = effectiveFatSecretServingDescription({ name: 'Grilled Nuggets 5 Ct' }, { description: '1 serving' })
    expect(desc).toBe('5 pieces')
    const r = computeV8Multiplier({
      quantity: 4,
      unit: 'nugget',
      relationship: 'EQUIVALENT_COUNT',
      servingDescription: desc,
    })
    expect(r.multiplier).toBe(0.8)
  })
})

describe('food.get servings with metric notes', () => {
  it('still parses "5 pieces (112 g)" as a count serving', () => {
    expect(parseDbCountServing('5 pieces (112 g)')).toEqual({ qty: 5, unit: 'pieces' })
  })

  it('keeps pure mass servings as mass', () => {
    expect(parseDbCountServing('1 oz (28 g)')).toBeNull()
    expect(parseDbCountServing('100 g')).toBeNull()
  })

  it('converts mass input exactly against a gram-annotated count serving', () => {
    const r = computeV8Multiplier({
      quantity: 224,
      unit: 'g',
      relationship: 'DIRECT',
      servingDescription: '5 pieces (112 g)',
    })
    expect(r.multiplier).toBe(2)
  })
})

describe('stated nutrition', () => {
  it('whole-container numbers scale by containers eaten', () => {
    const s = parseStatedNutrition('620 calories, 26 g protein for the whole container')
    expect(applyStatedNutrition(s!, { quantity: 1, unit: 'container', unitFamily: 'count' })).toEqual({
      calories: 620,
      protein: 26,
    })
    expect(applyStatedNutrition(s!, { quantity: 0.5, unit: 'container', unitFamily: 'count' })).toEqual({
      calories: 310,
      protein: 13,
    })
  })

  it('"total" is not scaled', () => {
    const s = parseStatedNutrition('400 calories total')
    expect(applyStatedNutrition(s!, { quantity: 2, unit: 'bar', unitFamily: 'count' })?.calories).toBe(400)
  })

  it('cannot apply per-container numbers to a mass portion', () => {
    const s = parseStatedNutrition('620 calories for the whole container')
    expect(applyStatedNutrition(s!, { quantity: 8, unit: 'oz', unitFamily: 'mass' })).toBeNull()
  })

  it('keeps each nutrient on its own serving basis', () => {
    const s = parseStatedNutrition('170 calories per serving, 680 calories total, 3 g protein per serving')
    expect(applyStatedNutrition(s!, { quantity: 4, unit: 'serving', unitFamily: 'serving' })).toEqual({
      calories: 680,
      protein: 12,
    })
  })

  it('does not assume one serving per package', () => {
    const s = parseStatedNutrition('170 calories per serving and 3 g protein per serving')
    expect(applyStatedNutrition(s!, { quantity: 1, unit: 'bag', unitFamily: 'count' })).toBeNull()
  })

  it('uses a measured label basis when the amount is convertible', () => {
    const s = parseStatedNutrition('170 calories and protein: 3.5g per 100 g')
    expect(applyStatedNutrition(s!, { quantity: 200, unit: 'g', unitFamily: 'mass' })).toEqual({
      calories: 340,
      protein: 7,
    })
  })

  it('ignores notes without nutrition values', () => {
    expect(parseStatedNutrition('roasted, extra crispy')).toBeNull()
  })

  it('does not restore an older protein value when the new lookup leaves it unknown', () => {
    const item = { id: 'salad', name: 'Miso Crunch Salad', amount: '4 servings', status: 'ready' }
    const merged = mergeMacroDayItem(
      { ...item, calories: 170, protein: 0, baseProtein: 0 },
      { ...item, calories: 680, macroEstimateSnapshot: { statedNutritionApplied: true, calories: 680 } },
    )
    expect(merged.calories).toBe(680)
    expect(merged.protein).toBeUndefined()
    expect(merged.baseProtein).toBeUndefined()
  })
})

describe('confusing brand aliases', () => {
  it('keeps curated brand fixes but has no user-specific mishearing rules', () => {
    expect(rewriteSpokenFoodLog('Tasso black cherry car I think')).toBe('Tasso black cherry car I think')
  })
})

describe('MACROS validation', () => {
  it('rejects selecting both a library food and a FatSecret food', () => {
    expect(
      validateMacrosResponse({
        libraryIndex: 2,
        fatSecretIndex: 1,
        servingIndex: 1,
        relationship: 'DIRECT',
        bridgeQuestion: null,
        unitsPerServing: null,
        calories: 0,
        protein: 0,
        servingType: 'bar',
      }),
    ).toBe(false)
  })
})
