import { describe, expect, it } from 'vitest'
import { parseConsumptionIntent } from './consumptionIntent'
import {
  parseDbCountServing,
  parseLeadingQuantity,
  parseServingBaseGrams,
  resolveDbMultiplier,
  resolveExactConvertibleMultiplier,
} from './macroMass'
import { parseServingDefinition, resolveMacroEstimate } from './macroLib'
import type { FatSecretFoodRef } from '../../types/domain'

const oreoFs: FatSecretFoodRef[] = [
  {
    foodId: '1',
    name: 'Loaded Oreo',
    servings: [{ servingId: '1', description: '2 cookies', calories: 140, protein: 1, isDefault: true }],
  },
]

describe('parseLeadingQuantity', () => {
  it('parses mixed numbers', () => {
    expect(parseLeadingQuantity('1 1/4 cups')).toBe(1.25)
    expect(parseLeadingQuantity('2 2/3 oz')).toBeCloseTo(2.666, 2)
  })

  it('parses simple fractions', () => {
    expect(parseLeadingQuantity('1/2 cup')).toBe(0.5)
    expect(parseLeadingQuantity('1/3')).toBeCloseTo(0.333, 2)
  })
})

describe('parseServingDefinition', () => {
  it('handles mixed-number cup servings', () => {
    const def = parseServingDefinition('1 1/4 cups')
    expect(def.servingSize).toBe(1.25)
    expect(def.servingUnit).toBe('cups')
  })
})

describe('resolveDbMultiplier', () => {
  it('2 cookies vs FS 2 cookies → 1 serving', () => {
    expect(resolveDbMultiplier({ qty: 2, unit: 'cookie' }, '2 cookies')).toBe(1)
  })

  it('1 cookie vs FS 2 cookies → 0.5 serving', () => {
    expect(resolveDbMultiplier({ qty: 1, unit: 'cookie' }, '2 cookies')).toBe(0.5)
  })

  it('2 apricots vs FS 4 pieces → 0.5 serving', () => {
    expect(resolveDbMultiplier({ qty: 2, unit: 'apricot' }, '4 pieces')).toBe(0.5)
  })

  it('6 oz vs FS 100 g', () => {
    const mult = resolveDbMultiplier({ qty: 6, unit: 'oz' }, '100 g')
    expect(mult).toBeGreaterThan(1.5)
    expect(mult).toBeLessThan(2)
  })

  it('1 tsp vs FS 1 tbsp → 1/3 serving', () => {
    expect(resolveDbMultiplier({ qty: 1, unit: 'tsp' }, '1 tbsp')).toBeCloseTo(0.33, 1)
  })

  it('1/3 sandwich vs FS 1 sandwich', () => {
    expect(resolveDbMultiplier({ qty: 1 / 3, unit: 'sandwich' }, '1 sandwich')).toBeCloseTo(0.33, 1)
  })

  it('does not treat 3 carrots as 3×100g', () => {
    expect(resolveDbMultiplier({ qty: 3, unit: 'carrot' }, '100 g')).toBeNull()
  })
})

describe('resolveExactConvertibleMultiplier', () => {
  it('does mass and matching count but not mismatched nouns', () => {
    expect(resolveExactConvertibleMultiplier({ qty: 6, unit: 'oz' }, '4 oz')).toBe(1.5)
    expect(resolveExactConvertibleMultiplier({ qty: 1, unit: 'cookie' }, '2 cookies')).toBe(0.5)
    expect(resolveExactConvertibleMultiplier({ qty: 2, unit: 'apricot' }, '4 pieces')).toBeNull()
  })
})

describe('parseConsumptionIntent', () => {
  it('parses half a potato', () => {
    const intent = parseConsumptionIntent('half a potato')
    expect(intent?.quantity).toBe(0.5)
    expect(intent?.unit).toMatch(/potato/i)
  })

  it('parses bare count as serving fraction', () => {
    const intent = parseConsumptionIntent('2')
    expect(intent?.quantity).toBe(2)
  })
})

describe('resolveMacroEstimate FatSecret path', () => {
  it('preserves user cookie count display for 2 oreos', () => {
    const result = resolveMacroEstimate(
      {
        fatSecretIndex: 1,
        servingIndex: 1,
        multiplier: 1,
        libraryIndex: null,
        calories: 0,
        protein: 0,
        servingType: '',
      },
      [],
      oreoFs,
      { quantity: 2, unit: 'cookie' },
    )
    expect(result.servingMultiplier).toBe(2)
    expect(result.servingSize).toBe(1)
    expect(result.servingUnit).toBe('cookie')
    expect(result.calories).toBe(140)
  })

  it('uses parser quantity when AI provides multiplier', () => {
    const result = resolveMacroEstimate(
      { fatSecretIndex: 1, servingIndex: 1, multiplier: 1, libraryIndex: null, calories: 0, protein: 0, servingType: '' },
      [],
      oreoFs,
      { quantity: 2, unit: 'cookie', userAmount: '2 cookies' },
    )
    expect(result.servingMultiplier).toBe(2)
    expect(result.servingUnit).toBe('cookie')
    expect(result.calories).toBe(140)
  })

  it('uses AI multiplier for nutrition when units incompatible', () => {
    const fs: FatSecretFoodRef[] = [
      {
        foodId: '1',
        name: 'Carrots',
        servings: [{ servingId: '1', description: '100 g', calories: 35, protein: 1, isDefault: true }],
      },
    ]
    const result = resolveMacroEstimate(
      { fatSecretIndex: 1, servingIndex: 1, multiplier: 1.2, libraryIndex: null, calories: 0, protein: 0, servingType: '' },
      [],
      fs,
      { quantity: 2, unit: 'carrot', userAmount: '2 carrots' },
    )
    expect(result.servingMultiplier).toBe(2)
    expect(result.servingUnit).toBe('carrot')
    expect(result.calories).toBe(42)
  })
})

describe('parseDbCountServing', () => {
  it('parses mixed-number count servings', () => {
    const parsed = parseDbCountServing('1 1/4 cups')
    expect(parsed?.qty).toBe(1.25)
    expect(parsed?.unit).toBe('cups')
  })

  it('parses common FS serving strings', () => {
    expect(parseDbCountServing('1 cup')?.qty).toBe(1)
    expect(parseDbCountServing('1/2 cup')?.qty).toBe(0.5)
    expect(parseDbCountServing('2 2/3 cups')?.qty).toBeCloseTo(2.666, 2)
    expect(parseDbCountServing('3 pieces')?.qty).toBe(3)
    expect(parseDbCountServing('12 crackers')?.qty).toBe(12)
    expect(parseDbCountServing('2 tbsp')?.qty).toBe(2)
    expect(parseDbCountServing('1.5 tbsp')?.qty).toBe(1.5)
    expect(parseDbCountServing('100 g')).toBeNull()
    expect(parseDbCountServing('3 oz')).toBeNull()
    expect(parseDbCountServing('1 bar')?.qty).toBe(1)
    expect(parseDbCountServing('1 sandwich')?.qty).toBe(1)
  })
})

describe('parseServingBaseGrams', () => {
  it('reads grams from FS lines', () => {
    expect(parseServingBaseGrams('100 g')).toBe(100)
  })
})
