import { describe, expect, it } from 'vitest'
import type { FatSecretFoodRef } from './fatsecret'
import {
  pickCookedGenerics,
  pickPlainGenerics,
  plainFoodCore,
  plainWholeFoodCore,
  referenceFoodQuery,
  searchNamesBrand,
} from './macroEstimate'

const generic = (foodId: string, name: string): FatSecretFoodRef => ({
  foodId,
  name,
  foodType: 'Generic',
  servings: [{ servingId: `${foodId}-0`, description: '100 g', calories: 100, protein: 10 }],
})

describe('plain whole-food detection', () => {
  it('finds the core food for prepared or weighed foods', () => {
    expect(plainWholeFoodCore({ name: 'Grilled Salmon', search: 'grilled salmon', unitFamily: 'count' })?.core).toEqual([
      'salmon',
    ])
    expect(plainWholeFoodCore({ name: 'Chicken Thigh', search: 'chicken thigh', unitFamily: 'mass' })?.core).toEqual([
      'chicken',
      'thigh',
    ])
    expect(plainWholeFoodCore({ name: 'Tofu', search: 'baked tofu', unitFamily: 'count' })?.core).toEqual(['tofu'])
  })

  it('skips raw foods, counted foods without prep, and composite dishes', () => {
    expect(plainWholeFoodCore({ name: 'Raw Salmon', search: 'raw salmon', unitFamily: 'mass' })).toBeNull()
    expect(plainWholeFoodCore({ name: 'Apple', search: 'apple', unitFamily: 'count' })).toBeNull()
    expect(
      plainWholeFoodCore({ name: 'Pad See Ew', search: 'grilled chicken pad see ew noodles', unitFamily: 'count' }),
    ).toBeNull()
  })

  it('detects a brand named in the search', () => {
    const results = [{ ...generic('1', 'Steak Strips'), foodType: 'Brand', brandName: 'Kirkland Signature' }]
    expect(searchNamesBrand('kirkland steak strips', results)).toBe(true)
    expect(searchNamesBrand('steak strips', results)).toBe(false)
  })

  it('does not treat a food word as a brand', () => {
    const results = [generic('1', 'Apples'), { ...generic('2', 'Apple Juice'), foodType: 'Brand', brandName: 'Apple & Eve' }]
    expect(searchNamesBrand('apple', results)).toBe(false)
  })
})

describe('plain generic picks', () => {
  it('prefers the plain entry over restaurant or store versions', () => {
    const foods: FatSecretFoodRef[] = [
      { ...generic('1', 'Avocado Half'), foodType: 'Brand', brandName: "Chop't" },
      generic('2', 'Avocado Toast with Egg and Everything Seasoning'),
      generic('3', 'Avocados'),
      generic('4', 'California Avocados (Raw)'),
    ]
    expect(pickPlainGenerics(foods, plainFoodCore('avocado')!, 'avocado').map((f) => f.foodId)).toEqual(['3', '4'])
  })
})

describe('cooked generic picks', () => {
  const foods: FatSecretFoodRef[] = [
    generic('1', 'Chicken Thigh'),
    generic('2', 'Roasted Broiled or Baked Chicken Thigh'),
    generic('3', 'Roasted Broiled or Baked Chicken Thigh (Skin Not Eaten)'),
    generic('4', 'Fried Chicken Thigh No Coating (Skin Not Eaten)'),
    generic('5', 'Chicken Thigh Meat (Broilers or Fryers, Roasted, Cooked)'),
    { ...generic('6', 'Grilled Chicken Thighs'), foodType: 'Brand', brandName: 'Tyson' },
    generic('7', 'Cooked Palm Hearts (Fat Not Added in Cooking)'),
  ]

  it('prefers lean cooked unbranded entries for the same food', () => {
    const ids = pickCookedGenerics(foods, ['chicken', 'thigh'], 'chicken thigh').map((f) => f.foodId)
    expect(ids[0]).toBe('3')
    expect(ids).toContain('5')
    expect(ids).not.toContain('4')
    expect(ids).not.toContain('6')
    expect(ids).not.toContain('7')
  })

  it('offers fried entries only when the user said fried', () => {
    const ids = pickCookedGenerics(foods, ['chicken', 'thigh'], 'fried chicken thigh', 5).map((f) => f.foodId)
    expect(ids).toContain('4')
  })

  it('works for non-meat foods', () => {
    const rice = [
      generic('a', 'Brown Rice (Long-Grain, Cooked)'),
      generic('b', 'Instant Brown Rice (Fat Added in Cooking)'),
      generic('c', 'Brown Rice Cake'),
    ]
    expect(pickCookedGenerics(rice, ['brown', 'rice'], 'brown rice').map((f) => f.foodId)).toEqual(['a'])
  })
})

describe('reference food query', () => {
  it('drops state words and searches the cooked form for prepared foods', () => {
    expect(referenceFoodQuery('chicken breast grilled', { fried: false })).toEqual({
      query: 'chicken breast cooked',
      core: ['chicken', 'breast'],
      cooked: true,
    })
  })

  it('keeps raw produce as-is', () => {
    expect(referenceFoodQuery('avocado raw', null)).toEqual({ query: 'avocado', core: ['avocado'], cooked: false })
  })

  it('ignores empty or long references', () => {
    expect(referenceFoodQuery('', null)).toBeNull()
    expect(referenceFoodQuery('chicken tikka masala with rice and naan', null)).toBeNull()
  })
})

describe('reference descriptors', () => {
  it('does not require database descriptor words in the name', () => {
    expect(referenceFoodQuery('chicken breast meat only cooked', null)).toEqual({
      query: 'chicken breast cooked',
      core: ['chicken', 'breast'],
      cooked: true,
    })
  })
})
