import { describe, expect, it } from 'vitest'
import { parseServingDefinition } from './macroLib'
import {
  buildPackagingAskItem,
  buildPackagingDayItem,
  parsePackagingFront,
  parsePackagingNutrition,
  PackagingResolveError,
  resolvePackagingAmount,
  resolvePackagingConsumption,
} from './packagingScan'

const pouchNutrition = {
  baseAmount: '1 pouch',
  calories: 180,
  protein: 15,
  fat: 3,
  carbs: 20,
  servingsPerContainer: 2,
  caloriesPerContainer: 360,
  proteinPerContainer: 30,
  fatPerContainer: 6,
  carbsPerContainer: 40,
  packageAmount: null as string | null,
}

describe('resolvePackagingAmount', () => {
  it('maps whole bag to a container fraction', () => {
    expect(resolvePackagingAmount('whole bag')).toEqual({
      multiplier: 1,
      amountLabel: 'whole bag',
      containerFraction: 1,
    })
  })

  it('maps half bag', () => {
    expect(resolvePackagingAmount('half bag').containerFraction).toBe(0.5)
  })

  it('parses serving counts', () => {
    expect(resolvePackagingAmount('2 servings')).toEqual({
      multiplier: 2,
      amountLabel: '2 servings',
      containerFraction: null,
    })
  })
})

describe('resolvePackagingConsumption', () => {
  const front = { name: 'Protein Pouch', emoji: '🍲' }

  it('prefers per-container column for whole bag', () => {
    const result = resolvePackagingConsumption(front, pouchNutrition, 'Whole bag')
    expect(result.mode).toBe('per_container')
    expect(result.calories).toBe(360)
    expect(result.protein).toBe(30)
    expect(result.multiplier).toBe(2)
  })

  it('uses SPC when per-container is absent', () => {
    const result = resolvePackagingConsumption(
      front,
      { ...pouchNutrition, caloriesPerContainer: null, proteinPerContainer: null },
      'whole bag',
    )
    expect(result.mode).toBe('servings_per_container')
    expect(result.multiplier).toBe(2)
    expect(result.calories).toBe(360)
  })

  it('asks when whole bag has neither SPC nor per-container', () => {
    expect(() =>
      resolvePackagingConsumption(
        front,
        {
          ...pouchNutrition,
          servingsPerContainer: null,
          caloriesPerContainer: null,
          proteinPerContainer: null,
        },
        'whole bag',
      ),
    ).toThrow(PackagingResolveError)
  })

  it('does not apply salad-kit heuristics — SPC×serving is used as printed', () => {
    const result = resolvePackagingConsumption(
      { name: 'Salad Kit', emoji: '🥗' },
      {
        baseAmount: '4 cups (106 g)',
        calories: 170,
        protein: 4,
        fat: 11,
        carbs: 14,
        servingsPerContainer: 3,
        caloriesPerContainer: null,
        proteinPerContainer: null,
        fatPerContainer: null,
        carbsPerContainer: null,
        packageAmount: null,
      },
      'whole bag',
    )
    expect(result.mode).toBe('servings_per_container')
    expect(result.multiplier).toBe(3)
    expect(result.calories).toBe(510)
  })
})

describe('parseServingDefinition parentheticals', () => {
  it('keeps cups as the unit without embedding grams', () => {
    const def = parseServingDefinition('4 cups (106 g)')
    expect(def.servingSize).toBe(4)
    expect(def.servingUnit).toBe('cups')
  })
})

describe('parsePackagingNutrition', () => {
  it('rejects unknown/empty baseAmount', () => {
    expect(() =>
      parsePackagingNutrition({
        baseAmount: 'unknown',
        calories: 0,
        protein: 0,
        fat: 0,
        carbs: 0,
        servingsPerContainer: null,
        caloriesPerContainer: null,
        proteinPerContainer: null,
        fatPerContainer: null,
        carbsPerContainer: null,
        packageAmount: null,
      }),
    ).toThrow(/retake/i)
  })

  it('treats 0 optional fields as null', () => {
    const n = parsePackagingNutrition({
      baseAmount: '1 cup',
      calories: 120,
      protein: 5,
      fat: 2,
      carbs: 20,
      servingsPerContainer: 0,
      caloriesPerContainer: 0,
      proteinPerContainer: 0,
      fatPerContainer: 0,
      carbsPerContainer: 0,
      packageAmount: '',
    })
    expect(n.servingsPerContainer).toBeNull()
    expect(n.caloriesPerContainer).toBeNull()
    expect(n.packageAmount).toBeNull()
  })

  it('keeps packageAmount when printed', () => {
    expect(
      parsePackagingNutrition({
        baseAmount: '1 cup',
        calories: 50,
        protein: 2,
        fat: 1,
        carbs: 5,
        servingsPerContainer: 3.5,
        caloriesPerContainer: null,
        proteinPerContainer: null,
        fatPerContainer: null,
        carbsPerContainer: null,
        packageAmount: '10 oz (284 g)',
      }).packageAmount,
    ).toBe('10 oz (284 g)')
  })
})

describe('buildPackagingDayItem', () => {
  it('stores packaging snapshot and keeps whole bag amount', () => {
    const { item } = buildPackagingDayItem({
      id: 'x',
      amountText: 'Whole bag',
      front: { name: 'Protein Pouch', emoji: '🍲' },
      nutrition: pouchNutrition,
      addToDatabase: false,
    })
    expect(item.fromPackagingScan).toBe(true)
    expect(item.amount).toBe('Whole bag')
    expect(item.calories).toBe(360)
    expect(item.packagingSnapshot?.resolveMode).toBe('per_container')
    expect(item.packagingSnapshot?.servingsPerContainer).toBe(2)
    expect(item.packagingSnapshot?.caloriesPerContainer).toBe(360)
  })

  it('Trader Joe salad kit: whole bag uses Per package 470 not 170×3=510', () => {
    const { item } = buildPackagingDayItem({
      id: 'tj',
      amountText: 'Whole bag',
      front: { name: 'Lemony Arugula Basil Salad Kit', emoji: '🥗' },
      nutrition: {
        baseAmount: '4 cups (100 g) salad + dressing',
        calories: 170,
        protein: 4,
        fat: 14,
        carbs: 7,
        servingsPerContainer: 3,
        caloriesPerContainer: 470,
        proteinPerContainer: 12,
        fatPerContainer: 40,
        carbsPerContainer: 19,
        packageAmount: null,
      },
      addToDatabase: false,
    })
    expect(item.name).toBe('Lemony Arugula Basil Salad Kit')
    expect(item.amount).toBe('Whole bag')
    expect(item.packagingSnapshot?.resolveMode).toBe('per_container')
    expect(item.calories).toBe(470)
    expect(item.protein).toBe(12)
    expect(item.calories).not.toBe(510)
  })
})

describe('buildPackagingAskItem', () => {
  it('keeps the form for retry when container math cannot close', () => {
    const error = new PackagingResolveError('need servings', {
      front: { name: 'Salad', emoji: '🥗' },
      nutrition: {
        baseAmount: '1 cup',
        calories: 50,
        protein: 2,
        fat: 1,
        carbs: 5,
        servingsPerContainer: null,
        caloriesPerContainer: null,
        proteinPerContainer: null,
        fatPerContainer: null,
        carbsPerContainer: null,
        packageAmount: '10 oz',
      },
      amountText: 'whole bag',
    })
    const item = buildPackagingAskItem({ id: 'a', error })
    expect(item.status).toBe('editing_raw')
    expect(item.name).toBe('Salad')
    expect(item.packagingSnapshot?.packageAmount).toBe('10 oz')
    expect(item.fromPackagingScan).toBe(true)
  })
})

describe('parsePackagingFront', () => {
  it('requires a name', () => {
    expect(() => parsePackagingFront({ emoji: '🥗' })).toThrow(/product name/i)
  })
})
