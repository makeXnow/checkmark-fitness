import { describe, expect, it } from 'vitest'
import type { MacroCustomFood, MacroDayItem } from '../../types/domain'
import { findMatchingLibraryFood, indexFoodLibrary, searchFoodLibrary, libraryUsage, reconcileFoodLibrary, normalizeFoodLibrary, normalizeLibraryFood } from './foodLibrary'
import { sortCustomFoodsByUsage, resolveCanonicalBaseMacros } from './macroLib'

const entry = (id: string, more: Partial<MacroDayItem> = {}): MacroDayItem => ({
  id, name: 'Rice cakes', amount: '2 rice cakes', calories: 70, protein: 2,
  status: 'ready', timestamp: 100, ...more,
})
const food = (id: string, name: string): MacroCustomFood => ({ id, name, baseAmount: '1 serving', calories: 100, protein: 5, fat: 0, carbs: 0 })
function product(id: string) {
  return { foodId: id, name: 'Rice Cakes', brandName: 'Brand', servings: [] }
}

describe('instant food library search', () => {
  const foods = [food('grape', 'Grapes'), food('yogurt', 'Greek Yogurt'), food('apple', 'Apple'),
    { ...food('rice', 'Rice'), sourceNames: ['Whole Grain Rice'] }, food('creme', 'Crème fraîche')]
  const index = indexFoodLibrary(foods)

  it('filters from the first character and finds substrings and saved aliases', () => {
    expect(searchFoodLibrary(index, 'g').map(food => food.id)).toEqual(['grape', 'yogurt', 'rice'])
    expect(searchFoodLibrary(index, 'GR').map(food => food.id)).toEqual(['grape', 'yogurt', 'rice'])
    expect(searchFoodLibrary(index, 'gre').map(food => food.id)).toEqual(['yogurt'])
    expect(searchFoodLibrary(index, 'ogur').map(food => food.id)).toEqual(['yogurt'])
    expect(searchFoodLibrary(index, 'no such food')).toEqual([])
  })

  it('restores all foods on clearing and tolerates accents and whitespace', () => {
    expect(searchFoodLibrary(index, '')).toEqual(foods)
    expect(searchFoodLibrary(index, '   ')).toEqual(foods)
    expect(searchFoodLibrary(index, ' creme   fraiche ')).toEqual([foods[4]])
  })

  it('reflects added, renamed, and deleted foods when the index is rebuilt', () => {
    const updated = indexFoodLibrary([food('apple', 'Green Apple'), food('beans', 'Green Beans')])
    expect(searchFoodLibrary(updated, 'gr').map(food => food.id)).toEqual(['apple', 'beans'])
    expect(searchFoodLibrary(updated, 'grapes')).toEqual([])
  })
})

describe('library serving normalization', () => {
  it.each(['5 oz', '5 ounces', '5oz', '5 oz (142 g)', '5 grams', '5 kg', '5 ml', '5 cups'])('scales %s nutrition to a single measurement unit', baseAmount => {
    const result = normalizeLibraryFood({ ...food('carrots', 'Carrots'), baseAmount, calories: 58, protein: 1, fat: 2, carbs: 10 })
    expect(result.baseAmount).toMatch(/^1 /)
    expect(result).toMatchObject({ calories: 11.6, protein: 0.2, fat: 0.4, carbs: 2 })
    expect(normalizeLibraryFood(result)).toBe(result)
  })

  it('preserves fractional per-gram nutrition and fractional serving math', () => {
    expect(normalizeLibraryFood({ ...food('carrots', 'Carrots'), baseAmount: '100g', calories: 41, protein: 0.9 }))
      .toMatchObject({ baseAmount: '1 g', calories: 0.41, protein: 0.009000000000000001 })
    expect(normalizeLibraryFood({ ...food('carrots', 'Carrots'), baseAmount: '1 1/2 oz', calories: 15 }))
      .toMatchObject({ baseAmount: '1 oz', calories: 10 })
  })

  it.each(['1 yogurt (150 g)', '1 container', '1 slice', '3 slices', '1 serving', 'invalid'])('preserves familiar count or unknown portion %s', baseAmount => {
    const saved = { ...food('saved', 'Food'), baseAmount }
    expect(normalizeLibraryFood(saved)).toBe(saved)
  })

  it('combines portion duplicates without changing diary history, retains links and is idempotent', () => {
    const foods = [
      { ...food('five', 'Carrots'), baseAmount: '5 oz', calories: 58, protein: 1 },
      { ...food('three', 'Carrots'), baseAmount: '3 oz', calories: 30, protein: 1 },
    ]
    const logs = { day: [entry('a', { name: 'Carrots', libraryFoodId: 'five', amount: '5 oz', calories: 58 }),
      entry('b', { name: 'Carrots', libraryFoodId: 'three', amount: '3 oz', calories: 30 })] }
    const before = JSON.stringify(logs)
    const result = reconcileFoodLibrary(foods, logs)
    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({ id: 'five', baseAmount: '1 oz', calories: 11.6, mergedFoodIds: ['three'] })
    expect(libraryUsage(result, logs).get('five')).toBe(2)
    expect(JSON.stringify(logs)).toBe(before)
    expect(reconcileFoodLibrary(result, logs)).toBe(result)
    expect(findMatchingLibraryFood(result, { name: 'Carrots' })).toBe(result[0])
  })

  it('combines units for the same product and prefers manually saved nutrition', () => {
    const result = normalizeFoodLibrary([
      { ...food('auto', 'Carrots'), baseAmount: '100 g', autoAdded: true, sourceFoodId: '123' },
      { ...food('manual', 'Carrots'), baseAmount: '3 oz', calories: 30, sourceFoodId: '123' },
    ])
    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({ id: 'manual', baseAmount: '1 oz', calories: 10, mergedFoodIds: ['auto'] })
  })

  it('combines generic automatic matches across database IDs, but retains branded products', () => {
    const foods = [
      { ...food('a', 'Carrots'), autoAdded: true, sourceFoodId: '6042', baseAmount: '3 oz' },
      { ...food('b', 'Carrots'), autoAdded: true, sourceFoodId: '36320', baseAmount: '5 oz' },
      { ...food('brand', 'Carrots'), autoAdded: true, sourceFoodId: 'brand' },
    ]
    const logs = { day: [entry('branded', { fatSecretResults: [{ foodId: 'brand', name: 'Carrots', brandName: 'Brand', servings: [] }] })] }
    const result = normalizeFoodLibrary(foods, logs)
    expect(result).toHaveLength(2)
    expect(result[0]).toMatchObject({ baseAmount: '1 oz', sourceFoodIds: ['6042', '36320'] })
    expect(result[1].sourceBrandName).toBe('Brand')
    expect(findMatchingLibraryFood(result, { name: 'Carrots', sourceFoodId: '36320' })).toBe(result[0])
    expect(normalizeFoodLibrary(result, logs)).toBe(result)
    expect(libraryUsage(result, { day: [entry('old', { libraryFoodId: 'b' })] }).get('a')).toBe(1)
  })

  it('normalizes weighed portions with preparation qualifiers without losing their meaning', () => {
    expect(normalizeLibraryFood({ ...food('chicken', 'Canned Chicken'), baseAmount: '3 oz drained (84 g)', calories: 90 }))
      .toMatchObject({ baseAmount: '1 oz drained', calories: 30 })
    expect(normalizeLibraryFood({ ...food('pasta', 'Goodles Pasta'), baseAmount: '2 oz dry (57g)', calories: 210 }))
      .toMatchObject({ baseAmount: '1 oz dry', calories: 105 })
    expect(normalizeLibraryFood({ ...food('salad', 'Salad'), baseAmount: '4 cups (100 g) salad + dressing', calories: 200 }))
      .toMatchObject({ baseAmount: '1 cup salad + dressing', calories: 50 })
    const cheddy = normalizeLibraryFood({ ...food('mac', 'Cheddy Mac'), baseAmount: '2..6 oz', calories: 270 })
    expect(cheddy.baseAmount).toBe('1 oz')
    expect(cheddy.calories).toBeCloseTo(270 / 2.6)
  })

  it('keeps different known products, flavors and preparations separate, including ambiguous names', () => {
    const foods = [
      { ...food('a', 'Yogurt'), sourceFoodId: 'a' }, food('unknown', 'Yogurt'),
      { ...food('b', 'Yogurt'), sourceFoodId: 'b' }, food('c', 'Vanilla Yogurt'),
      food('d', 'Grilled Chicken'), food('e', 'Fried Chicken'),
    ]
    expect(normalizeFoodLibrary(foods)).toBe(foods)
  })

  it('normalizes foods learned automatically from weighed diary portions', () => {
    const result = reconcileFoodLibrary([], { day: [entry('a', { amount: '3 oz', calories: 30 }), entry('b', { amount: '6 oz', calories: 60 })] })
    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({ baseAmount: '1 oz', calories: 10 })
  })

  it('retains the correct nutrition when editing older diary rows that used a multi-ounce base', () => {
    const foods = normalizeFoodLibrary([{ ...food('carrots', 'Carrots'), baseAmount: '3 oz', calories: 30, protein: 0.6 }])
    const item = entry('old', { libraryFoodId: 'carrots', amount: '6 oz', calories: 60, protein: 1.2,
      servingType: '3 oz', servingSize: 3, servingUnit: 'oz', servingMultiplier: 2 })
    expect(resolveCanonicalBaseMacros(item, foods)).toEqual({ baseCalories: 30, baseProtein: 0.6 })
  })
})

describe('automatic food library', () => {
  it('promotes on the second completed log, includes history, and is idempotent', () => {
    const empty: MacroCustomFood[] = []
    expect(reconcileFoodLibrary(empty, { day1: [entry('1')] })).toBe(empty)
    const logs = { day1: [entry('1')], day2: [entry('2', { name: 'Rice Cake' })] }
    const result = reconcileFoodLibrary(empty, logs)
    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({ baseAmount: '2 rice cakes', calories: 70, protein: 2, autoAdded: true })
    expect(reconcileFoodLibrary(result, logs)).toBe(result)
    expect(libraryUsage(result, logs).get(result[0].id)).toBe(2)
    expect(logs.day1[0].libraryFoodId).toBeUndefined()
  })

  it('matches different scanned and spoken names using the selected database product', () => {
    const logs = { day: [
      entry('scan', { fromBarcode: true, name: 'Quaker Lightly Salted Rice Cakes', fatSecretResults: [product('12')] }),
      entry('voice', { fatSecretResults: [product('12')], macroEstimateSnapshot: { fatSecretIndex: 1 } }),
    ] }
    const foods = reconcileFoodLibrary([], logs)
    expect(foods).toHaveLength(1)
    expect(foods[0].sourceFoodId).toBe('12')
    expect(libraryUsage(foods, logs).get(foods[0].id)).toBe(2)
  })

  it('combines packaging and spoken entries by name without requiring a library link', () => {
    expect(reconcileFoodLibrary([], { day: [entry('scan', { fromPackagingScan: true }), entry('voice')] })).toHaveLength(1)
  })

  it('does not merge different known products, flavors, or preparation methods', () => {
    const logs = { day: [
      entry('a', { fromBarcode: true, fatSecretResults: [product('1')] }),
      entry('b', { fromBarcode: true, fatSecretResults: [product('2')] }),
      entry('c', { name: 'Chocolate Rice Cakes' }), entry('d', { name: 'Grilled chicken' }),
      entry('e', { name: 'Fried chicken' }),
    ] }
    expect(reconcileFoodLibrary([], logs)).toEqual([])
  })

  it('ignores placeholders, failures and repeated snapshots of the same entry', () => {
    expect(reconcileFoodLibrary([], { day: [entry('1'), entry('1'), entry('2', { status: 'pending' }), entry('3', { status: 'error' })] })).toEqual([])
  })

  it('keeps manually saved nutrition and counts older unlinked voice entries', () => {
    const saved = food('manual', 'Rice cakes')
    const logs = { day: [entry('1'), entry('2', { libraryFoodId: saved.id })] }
    const foods = [saved]
    expect(reconcileFoodLibrary(foods, logs)).toBe(foods)
    expect(libraryUsage(foods, logs).get(saved.id)).toBe(2)
    expect(saved.calories).toBe(100)
  })

  it('sorts by all logged occurrences rather than library clicks or portion quantity', () => {
    const foods = [food('rice', 'Rice cakes'), food('apple', 'Apple'), food('unused', 'Unused')]
    const logs = { day: [entry('1'), entry('2'), entry('3', { name: 'Apple', amount: '100 apples', libraryFoodId: 'apple' })] }
    expect(sortCustomFoodsByUsage(foods, logs).map(food => food.id)).toEqual(['rice', 'apple', 'unused'])
  })

  it('reuses a scanned product but keeps distinct product IDs separate', () => {
    const saved = { ...food('rice', 'Rice cakes'), sourceFoodId: '1' }
    expect(findMatchingLibraryFood([saved], { name: 'Different spoken name', sourceFoodId: '1' })).toBe(saved)
    expect(findMatchingLibraryFood([saved], { name: 'Rice cakes', sourceFoodId: '2' })).toBeUndefined()
  })
})
