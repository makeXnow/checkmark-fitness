import { describe, expect, it } from 'vitest'
import { parseServingDefinition } from './macroLib'
import {
  buildPackagingDayItem,
  parsePackagingFront,
  parsePackagingNutrition,
  resolvePackagingAmount,
  resolvePackagingMultiplier,
} from './packagingScan'

describe('resolvePackagingAmount', () => {
  it('maps whole bag to a container fraction', () => {
    expect(resolvePackagingAmount('whole bag', 3.5)).toEqual({
      multiplier: 3.5,
      amountLabel: 'whole bag',
      containerFraction: 1,
    })
  })

  it('maps half bag', () => {
    expect(resolvePackagingAmount('half bag', 4).containerFraction).toBe(0.5)
    expect(resolvePackagingAmount('half bag', 4).multiplier).toBe(2)
  })

  it('parses serving counts', () => {
    expect(resolvePackagingAmount('2 servings', 4)).toEqual({
      multiplier: 2,
      amountLabel: '2 servings',
      containerFraction: null,
    })
  })

  it('defaults empty to one serving', () => {
    expect(resolvePackagingAmount('', 4).multiplier).toBe(1)
  })
})

describe('resolvePackagingMultiplier', () => {
  const base = {
    baseAmount: '4 cups (106 g)',
    calories: 170,
    protein: 4,
    fat: 11,
    carbs: 14,
    servingsPerContainer: 3,
    caloriesPerContainer: 0,
    proteinPerContainer: 0,
  }

  it('sanitizes bulky cup serving × SPC for whole bag', () => {
    const resolved = resolvePackagingAmount('whole bag', 3)
    expect(resolvePackagingMultiplier(base, resolved)).toBe(1)
  })

  it('uses per-container calories when present', () => {
    const resolved = resolvePackagingAmount('whole bag', 3)
    expect(
      resolvePackagingMultiplier(
        { ...base, caloriesPerContainer: 170, proteinPerContainer: 4, servingsPerContainer: 1 },
        resolved,
      ),
    ).toBe(1)
  })

  it('multiplies normal small servings by SPC', () => {
    const resolved = resolvePackagingAmount('whole bag', 3.5)
    expect(
      resolvePackagingMultiplier(
        {
          ...base,
          baseAmount: '1 1/2 cups (100 g)',
          calories: 50,
          servingsPerContainer: 3.5,
        },
        resolved,
      ),
    ).toBe(3.5)
  })

  it('throws when whole bag has no SPC and no per-container calories', () => {
    const resolved = resolvePackagingAmount('whole bag', 0)
    expect(() =>
      resolvePackagingMultiplier({ ...base, servingsPerContainer: 0 }, resolved),
    ).toThrow(/container servings/i)
  })
})

describe('parseServingDefinition parentheticals', () => {
  it('keeps cups as the unit without embedding grams', () => {
    const def = parseServingDefinition('4 cups (106 g)')
    expect(def.servingSize).toBe(4)
    expect(def.servingUnit).toBe('cups')
    expect(def.label).toBe('4 cups (106 g)')
  })
})

describe('parsePackagingNutrition', () => {
  it('aligns SPC from per-container calories when mismatched', () => {
    expect(
      parsePackagingNutrition({
        baseAmount: '1 pouch',
        calories: 180,
        protein: 15,
        fat: 3,
        carbs: 20,
        servingsPerContainer: 1,
        caloriesPerContainer: 360,
        proteinPerContainer: 30,
      }).servingsPerContainer,
    ).toBe(2)
  })
})

describe('buildPackagingDayItem', () => {
  it('logs whole bag as one bulky cup serving without FatSecret math', () => {
    const { item, libraryFood } = buildPackagingDayItem({
      id: 'x',
      amountText: 'whole bag',
      front: { name: 'Lemony Arugula Basil', emoji: '🥗' },
      nutrition: {
        baseAmount: '4 cups (106 g)',
        calories: 170,
        protein: 4,
        fat: 11,
        carbs: 14,
        servingsPerContainer: 3,
        caloriesPerContainer: 0,
        proteinPerContainer: 0,
      },
      addToDatabase: true,
    })
    expect(item.status).toBe('ready')
    expect(item.fromPackagingScan).toBe(true)
    expect(item.amount).toBe('whole bag')
    expect(item.servingMultiplier).toBe(1)
    expect(item.calories).toBe(170)
    expect(item.protein).toBe(4)
    expect(item.servingUnit).toBe('cups')
    expect(libraryFood?.calories).toBe(170)
  })

  it('uses per-container column for whole bag when present', () => {
    const { item } = buildPackagingDayItem({
      id: 'y',
      amountText: 'Whole bag',
      front: { name: 'Protein Pouch', emoji: '🍲' },
      nutrition: {
        baseAmount: '1 pouch',
        calories: 180,
        protein: 15,
        fat: 3,
        carbs: 20,
        servingsPerContainer: 2,
        caloriesPerContainer: 360,
        proteinPerContainer: 30,
      },
      addToDatabase: false,
    })
    expect(item.amount).toBe('Whole bag')
    expect(item.servingMultiplier).toBe(2)
    expect(item.calories).toBe(360)
    expect(item.protein).toBe(30)
  })
})

describe('parsePackagingFront', () => {
  it('requires a name', () => {
    expect(() => parsePackagingFront({ emoji: '🥗' })).toThrow(/product name/i)
  })
})
