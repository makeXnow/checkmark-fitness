import { describe, expect, it } from 'vitest'
import {
  buildPackagingDayItem,
  parsePackagingFront,
  parsePackagingNutrition,
  resolvePackagingAmount,
} from './packagingScan'

describe('resolvePackagingAmount', () => {
  it('maps whole bag to servings per container', () => {
    expect(resolvePackagingAmount('whole bag', 3.5)).toEqual({
      multiplier: 3.5,
      amountLabel: 'whole bag',
      usedContainerServings: true,
    })
  })

  it('maps half bag', () => {
    expect(resolvePackagingAmount('half bag', 4).multiplier).toBe(2)
  })

  it('parses serving counts', () => {
    expect(resolvePackagingAmount('2 servings', 4)).toEqual({
      multiplier: 2,
      amountLabel: '2 servings',
      usedContainerServings: false,
    })
  })

  it('defaults empty to one serving', () => {
    expect(resolvePackagingAmount('', 4).multiplier).toBe(1)
  })

  it('throws when whole bag lacks servings per container', () => {
    expect(() => resolvePackagingAmount('whole bag', 0)).toThrow(/servings per container/i)
  })
})

describe('parsePackagingNutrition', () => {
  it('requires calories and keeps servingsPerContainer', () => {
    expect(
      parsePackagingNutrition({
        baseAmount: '1 cup',
        calories: 120,
        protein: 5,
        fat: 2,
        carbs: 20,
        servingsPerContainer: 4,
      }),
    ).toMatchObject({ baseAmount: '1 cup', servingsPerContainer: 4 })
  })
})

describe('buildPackagingDayItem', () => {
  it('creates a ready item from vision + whole bag', () => {
    const { item, libraryFood } = buildPackagingDayItem({
      id: 'x',
      amountText: 'whole bag',
      front: { name: 'Caesar Salad Kit', emoji: '🥗' },
      nutrition: {
        baseAmount: '1 cup',
        calories: 100,
        protein: 4,
        fat: 6,
        carbs: 10,
        servingsPerContainer: 3,
      },
      addToDatabase: true,
    })
    expect(item.status).toBe('ready')
    expect(item.name).toBe('Caesar Salad Kit')
    expect(item.fromPackagingScan).toBe(true)
    expect(item.servingMultiplier).toBe(3)
    expect(item.calories).toBe(300)
    expect(item.protein).toBe(12)
    expect(libraryFood?.calories).toBe(100)
    expect(item.libraryFoodId).toBe(libraryFood?.id)
  })
})

describe('parsePackagingFront', () => {
  it('requires a name', () => {
    expect(() => parsePackagingFront({ emoji: '🥗' })).toThrow(/product name/i)
  })
})
