import { describe, expect, it } from 'vitest'
import { computeMacroMultiplier } from './macroServingResolve'
import { resolveDbMultiplier } from './macroMass'
import { resolveMacroEstimate } from './macroLib'
import type { FatSecretFoodRef } from '../../types/domain'

describe('computeMacroMultiplier regression cases', () => {
  it('5 nuggets vs 4 nuggets → 1.25', () => {
    expect(computeMacroMultiplier({ qty: 5, unit: 'nugget' }, '4 nuggets', 'count_equivalent')).toBe(1.25)
  })

  it('2 cups cereal vs 1 1/4 cups → 1.6', () => {
    const mult = computeMacroMultiplier({ qty: 2, unit: 'cup' }, '1 1/4 cups', 'unit_conversion')
    expect(mult).toBeCloseTo(1.6, 1)
  })

  it('1.5 cans vs 1 can → 1.5', () => {
    expect(computeMacroMultiplier({ qty: 1.5, unit: 'can' }, '1 can', 'count_equivalent')).toBe(1.5)
  })

  it('20% small fries vs 1 small serving → 0.2', () => {
    expect(
      computeMacroMultiplier({ qty: 0.2, unit: 'small fries' }, '1 small serving', 'fraction_of_whole'),
    ).toBe(0.2)
  })

  it('3 tacos vs 1 serving (3-piece order) uses count ratio when compatible', () => {
    expect(resolveDbMultiplier({ qty: 3, unit: 'taco' }, '3 pieces')).toBe(1)
  })
})

describe('resolveMacroEstimate with consumption', () => {
  const peanutFs: FatSecretFoodRef[] = [
    {
      foodId: '1',
      name: 'Peanut Butter',
      servings: [{ servingId: '1', description: '2 tbsp', calories: 190, protein: 7, isDefault: true }],
    },
  ]

  it('preserves 2 tbsp with same_unit relationship', () => {
    const result = resolveMacroEstimate(
      {
        fatSecretIndex: 1,
        servingIndex: 1,
        relationship: 'same_unit',
        multiplier: 1,
      },
      [],
      peanutFs,
      {
        userAmount: '2 tbsp',
        consumption: { quantity: 2, unit: 'tbsp', kind: 'volume' },
      },
    )
    expect(result.servingMultiplier).toBe(2)
    expect(result.servingUnit).toBe('tbsp')
    expect(result.calories).toBe(190)
  })
})
