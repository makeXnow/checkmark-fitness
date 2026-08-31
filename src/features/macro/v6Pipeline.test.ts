import { describe, expect, it } from 'vitest'
import { validateMacrosResponse, validateParserItem, validateParserResponse } from './macroAiValidate'
import { formatAmountFromQuantityUnit, parseSnapshotFromItem, resolveMacroEstimate } from './macroLib'
import type { FatSecretFoodRef } from '../../types/domain'

describe('V6 parser validation (fields required by V7 schema)', () => {
  it('accepts valid quantity and unit', () => {
    expect(
      validateParserItem({
        name: 'Oreos',
        quantity: 2,
        unit: 'cookie',
        unitFamily: 'count',
        estimated: false,
        originalPortion: '',
        notes: '',
        fatSecretSearch: 'Oreo',
      }),
    ).toBe(true)
  })

  it('rejects missing quantity, zero, and generic serving unit', () => {
    expect(
      validateParserItem({
        name: 'Oreos',
        quantity: 0,
        unit: 'cookie',
        unitFamily: 'count',
        estimated: false,
        originalPortion: '',
        notes: '',
        fatSecretSearch: 'Oreo',
      }),
    ).toBe(false)
    expect(
      validateParserItem({
        name: 'Oreos',
        quantity: 2,
        unit: 'serving',
        unitFamily: 'count',
        estimated: false,
        originalPortion: '',
        notes: '',
        fatSecretSearch: 'Oreo',
      }),
    ).toBe(false)
  })

  it('validates full parser response', () => {
    expect(
      validateParserResponse({
        items: [
          {
            name: 'Green Beans',
            quantity: 183,
            unit: 'g',
            unitFamily: 'mass',
            estimated: false,
            originalPortion: '',
            notes: '',
            fatSecretSearch: 'green beans',
          },
        ],
      }),
    ).toBe(true)
  })
})

describe('V6 parseSnapshotFromItem', () => {
  it('formats amount from quantity and unit', () => {
    const snap = parseSnapshotFromItem({
      name: 'Oreos',
      quantity: 2,
      unit: 'cookie',
      notes: '',
      fatSecretSearch: 'Oreo',
    })
    expect(snap.quantity).toBe(2)
    expect(snap.unit).toBe('cookie')
    expect(snap.amount).toBe('2 cookie')
  })

  it('resolves vague handful to grams display', () => {
    const snap = parseSnapshotFromItem({
      name: 'Almonds',
      quantity: 28,
      unit: 'g',
      notes: '',
      fatSecretSearch: 'almonds',
    })
    expect(snap.amount).toBe('28 g')
  })
})

describe('V6 resolveMacroEstimate — AI multiplier drives nutrition', () => {
  const oreoFs: FatSecretFoodRef[] = [
    {
      foodId: '1',
      name: 'Oreo',
      servings: [{ servingId: '1', description: '1 cookie', calories: 53, protein: 0.5, isDefault: true }],
    },
  ]

  const oreo3Fs: FatSecretFoodRef[] = [
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

  const greenBeanFs: FatSecretFoodRef[] = [
    {
      foodId: '3',
      name: 'Green Beans',
      servings: [{ servingId: '1', description: '4 oz', calories: 31, protein: 2, isDefault: true }],
    },
  ]

  it('2 Oreos with 1 cookie/serving → multiplier 2, card shows 2 cookie', () => {
    const result = resolveMacroEstimate(
      { fatSecretIndex: 1, servingIndex: 1, multiplier: 2, libraryIndex: null, calories: 0, protein: 0, servingType: '' },
      [],
      oreoFs,
      { quantity: 2, unit: 'cookie' },
    )
    expect(result.servingMultiplier).toBe(2)
    expect(result.servingUnit).toBe('cookie')
    expect(result.calories).toBe(106)
  })

  it('2 Oreos with 3 cookies/serving → multiplier 0.666667', () => {
    const result = resolveMacroEstimate(
      { fatSecretIndex: 1, servingIndex: 1, multiplier: 2 / 3, libraryIndex: null, calories: 0, protein: 0, servingType: '' },
      [],
      oreo3Fs,
      { quantity: 2, unit: 'cookie' },
    )
    expect(result.servingMultiplier).toBe(2)
    expect(result.calories).toBe(Math.round(160 * (2 / 3)))
  })

  it('2 tbsp vs 2 tbsp serving → multiplier 1', () => {
    const result = resolveMacroEstimate(
      { fatSecretIndex: 1, servingIndex: 1, multiplier: 1, libraryIndex: null, calories: 0, protein: 0, servingType: '' },
      [],
      peanutFs,
      { quantity: 2, unit: 'tbsp' },
    )
    expect(result.calories).toBe(190)
    expect(result.servingMultiplier).toBe(2)
    expect(result.servingUnit).toBe('tbsp')
  })

  it('183 g green beans vs 4 oz serving uses AI multiplier', () => {
    const result = resolveMacroEstimate(
      { fatSecretIndex: 1, servingIndex: 1, multiplier: 1.614, libraryIndex: null, calories: 0, protein: 0, servingType: '' },
      [],
      greenBeanFs,
      { quantity: 183, unit: 'g' },
    )
    expect(result.servingMultiplier).toBe(183)
    expect(result.servingUnit).toBe('g')
    expect(result.calories).toBe(Math.round(31 * 1.614))
  })

  it('card quantity never comes from FatSecret serving size', () => {
    const result = resolveMacroEstimate(
      { fatSecretIndex: 1, servingIndex: 1, multiplier: 0.5, libraryIndex: null, calories: 0, protein: 0, servingType: '' },
      [],
      [
        {
          foodId: '4',
          name: 'Dried Apricots',
          servings: [{ servingId: '1', description: '4 pieces', calories: 80, protein: 1, isDefault: true }],
        },
      ],
      { quantity: 2, unit: 'dried apricot' },
    )
    expect(result.servingMultiplier).toBe(2)
    expect(result.servingUnit).toBe('dried apricot')
    expect(result.calories).toBe(40)
  })

  it('direct estimate preserves parser display', () => {
    const result = resolveMacroEstimate(
      { libraryIndex: null, fatSecretIndex: null, servingIndex: null, multiplier: 1, calories: 180, protein: 20, servingType: 'bar' },
      [],
      [],
      { quantity: 1, unit: 'bar' },
    )
    expect(result.calories).toBe(180)
    expect(result.servingMultiplier).toBe(1)
    expect(result.servingUnit).toBe('bar')
  })
})

describe('V6 macros validation (superseded by V7 relationship)', () => {
  it('FatSecret match requires relationship + servingIndex (not multiplier)', () => {
    expect(
      validateMacrosResponse({
        libraryIndex: null,
        fatSecretIndex: 1,
        servingIndex: 1,
        relationship: 'DIRECT',
        estimateQuantity: null,
        estimateUnit: null,
        calories: 0,
        protein: 0,
        servingType: '',
      }),
    ).toBe(true)
    expect(
      validateMacrosResponse({
        libraryIndex: null,
        fatSecretIndex: 1,
        servingIndex: 1,
        relationship: 'DIRECT',
        estimateQuantity: null,
        estimateUnit: null,
        calories: 0,
        protein: 0,
        servingType: '',
      } as never),
    ).toBe(true)
  })
})

describe('formatAmountFromQuantityUnit', () => {
  it('formats fractions for display', () => {
    expect(formatAmountFromQuantityUnit(0.5, 'sandwich')).toBe('0.5 sandwich')
    expect(formatAmountFromQuantityUnit(183, 'g')).toBe('183 g')
  })
})
