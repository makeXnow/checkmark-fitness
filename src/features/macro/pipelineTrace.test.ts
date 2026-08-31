import { describe, expect, it } from 'vitest'
import { ensureConsumption } from './consumptionNormalize'
import { parseDbServingDescription } from './macroMass'
import { buildServingPipelineTrace } from '../../dev/servingAudit/servingAuditTrace'
import { resolveMacroEstimate } from './macroLib'
import type { FatSecretFoodRef } from '../../types/domain'

describe('ensureConsumption', () => {
  it('replaces generic serving unit from amountText', () => {
    const c = ensureConsumption('3 carrots', {
      quantity: 3,
      unit: 'serving',
      kind: 'count',
    })
    expect(c?.unit).toBe('carrots')
    expect(c?.kind).toBe('count')
  })

  it('preserves egg whites phrasing', () => {
    const c = ensureConsumption('2 egg whites', {
      quantity: 2,
      unit: 'serving',
      kind: 'count',
    })
    expect(c?.unit).toMatch(/egg whites/i)
  })

  it('derives consumption when parser omits structured fields', () => {
    const c = ensureConsumption('3 tacos', null)
    expect(c?.quantity).toBe(3)
    expect(c?.unit).toBe('tacos')
  })

  it('recovers from bare amount using food context', () => {
    const c = ensureConsumption(
      '1',
      { quantity: 1, unit: 'serving', kind: 'fraction_of_item' },
      { name: 'Oreos', userInput: '1 Oreo' },
    )
    expect(c?.kind).toBe('count')
    expect(c?.unit.toLowerCase()).toMatch(/oreo/)
  })
})

describe('parseDbServingDescription', () => {
  it('parses compact and spaced mass servings', () => {
    expect(parseDbServingDescription('100g')).toEqual({ qty: 100, unit: 'g' })
    expect(parseDbServingDescription('101 g')).toEqual({ qty: 101, unit: 'g' })
    expect(parseDbServingDescription('2 oz')).toEqual({ qty: 2, unit: 'oz' })
    expect(parseDbServingDescription('3oz')).toEqual({ qty: 3, unit: 'oz' })
  })
})

describe('pipeline trace cases (V6)', () => {
  const oreoFs: FatSecretFoodRef[] = [
    {
      foodId: '1',
      name: 'Oreo',
      servings: [{ servingId: '1', description: '3 cookies', calories: 160, protein: 1, isDefault: true }],
    },
  ]

  const peanutFs: FatSecretFoodRef[] = [
    {
      foodId: '2',
      name: 'Peanut Butter',
      servings: [{ servingId: '1', description: '2 tbsp', calories: 190, protein: 7, isDefault: true }],
    },
  ]

  const tacoFs: FatSecretFoodRef[] = [
    {
      foodId: '3',
      name: 'Tacos Al Carbon - 3 Pieces',
      servings: [{ servingId: '1', description: '1 serving', calories: 300, protein: 20, isDefault: true }],
    },
  ]

  const carrotFs: FatSecretFoodRef[] = [
    {
      foodId: '4',
      name: 'Carrots',
      servings: [{ servingId: '1', description: '100 g', calories: 35, protein: 1, isDefault: true }],
    },
  ]

  const friesFs: FatSecretFoodRef[] = [
    {
      foodId: '5',
      name: 'Chick-fil-A Waffle Potato Fries',
      servings: [{ servingId: '1', description: '1 serving', calories: 400, protein: 5, isDefault: true }],
    },
  ]

  it('1 Oreo vs 3 cookies — AI multiplier 1/3', () => {
    const trace = buildServingPipelineTrace({
      quantity: 1,
      unit: 'cookie',
      macroSnap: {
        fatSecretIndex: 1,
        servingIndex: 1,
        multiplier: 1 / 3,
        libraryIndex: null,
        calories: 0,
        protein: 0,
        servingType: '',
      },
      selectedFood: oreoFs[0]!,
      selectedServing: oreoFs[0]!.servings[0]!,
      customFoods: [],
      fatSecretResults: oreoFs,
      userAmount: '1 cookie',
    })
    expect(trace.aiMultiplier).toBeCloseTo(0.33, 1)
    expect(trace.dbServingQty).toBe(3)
    expect(trace.result?.servingMultiplier).toBe(1)
    expect(trace.result?.servingUnit).toBe('cookie')
  })

  it('2 tbsp peanut butter vs 2 tbsp — multiplier 1', () => {
    const trace = buildServingPipelineTrace({
      quantity: 2,
      unit: 'tbsp',
      macroSnap: {
        fatSecretIndex: 1,
        servingIndex: 1,
        multiplier: 1,
        libraryIndex: null,
        calories: 0,
        protein: 0,
        servingType: '',
      },
      selectedFood: peanutFs[0]!,
      selectedServing: peanutFs[0]!.servings[0]!,
      customFoods: [],
      fatSecretResults: peanutFs,
      userAmount: '2 tbsp',
    })
    expect(trace.aiMultiplier).toBe(1)
    expect(trace.result?.servingMultiplier).toBe(2)
    expect(trace.result?.servingUnit).toBe('tbsp')
  })

  it('3 El Pollo Loco tacos vs 3-piece serving', () => {
    const trace = buildServingPipelineTrace({
      quantity: 3,
      unit: 'taco',
      macroSnap: {
        fatSecretIndex: 1,
        servingIndex: 1,
        multiplier: 1,
        libraryIndex: null,
        calories: 0,
        protein: 0,
        servingType: '',
      },
      selectedFood: tacoFs[0]!,
      selectedServing: tacoFs[0]!.servings[0]!,
      customFoods: [],
      fatSecretResults: tacoFs,
      userAmount: '3 tacos',
    })
    expect(trace.effectiveServingDescription).toBe('3 pieces')
    expect(trace.aiMultiplier).toBe(1)
    expect(trace.result?.servingMultiplier).toBe(3)
    expect(trace.result?.servingUnit).toBe('taco')
  })

  it('3 carrots vs 100g — AI estimates multiplier', () => {
    const trace = buildServingPipelineTrace({
      quantity: 3,
      unit: 'carrot',
      macroSnap: {
        fatSecretIndex: 1,
        servingIndex: 1,
        multiplier: 1.2,
        libraryIndex: null,
        calories: 0,
        protein: 0,
        servingType: '',
      },
      selectedFood: carrotFs[0]!,
      selectedServing: carrotFs[0]!.servings[0]!,
      customFoods: [],
      fatSecretResults: carrotFs,
      userAmount: '3 carrots',
    })
    expect(trace.aiMultiplier).toBe(1.2)
    expect(trace.dbServingQty).toBe(100)
    expect(trace.dbServingUnit).toBe('g')
    expect(trace.result?.servingMultiplier).toBe(3)
    expect(trace.result?.servingUnit).toBe('carrot')
  })

  it('6 Chick-fil-A fries — AI fraction multiplier, not 6× order', () => {
    const result = resolveMacroEstimate(
      {
        fatSecretIndex: 1,
        servingIndex: 1,
        multiplier: 0.15,
        libraryIndex: null,
        calories: 0,
        protein: 0,
        servingType: '',
      },
      [],
      friesFs,
      { quantity: 6, unit: 'fry', userAmount: '6 fries' },
    )
    expect(result.servingMultiplier).toBe(6)
    expect(result.servingUnit).toBe('fry')
    expect(result.calories).toBe(60)
    expect(result.calories).not.toBe(400 * 6)
  })
})
