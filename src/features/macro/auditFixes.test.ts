import { describe, expect, it } from 'vitest'
import { computeV8Multiplier } from './macroV8Resolve'
import { parseDbCountServing } from './macroMass'
import { effectiveFatSecretServingDescription } from './macroServingResolve'
import { applyStatedNutrition, parseStatedNutrition } from './macroStatedNutrition'
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
    expect(s).toEqual({ calories: 620, protein: 26, scope: 'per_container' })
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
    expect(s?.scope).toBe('total_eaten')
    expect(applyStatedNutrition(s!, { quantity: 2, unit: 'bar', unitFamily: 'count' })?.calories).toBe(400)
  })

  it('cannot apply per-container numbers to a mass portion', () => {
    const s = parseStatedNutrition('620 calories for the whole container')
    expect(applyStatedNutrition(s!, { quantity: 8, unit: 'oz', unitFamily: 'mass' })).toBeNull()
  })

  it('ignores notes without calories', () => {
    expect(parseStatedNutrition('roasted, extra crispy')).toBeNull()
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
