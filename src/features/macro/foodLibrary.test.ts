import { describe, expect, it } from 'vitest'
import type { MacroCustomFood, MacroDayItem } from '../../types/domain'
import { findMatchingLibraryFood, libraryUsage, reconcileFoodLibrary } from './foodLibrary'
import { sortCustomFoodsByUsage } from './macroLib'

const entry = (id: string, more: Partial<MacroDayItem> = {}): MacroDayItem => ({
  id, name: 'Rice cakes', amount: '2 rice cakes', calories: 70, protein: 2,
  status: 'ready', timestamp: 100, ...more,
})
const food = (id: string, name: string): MacroCustomFood => ({ id, name, baseAmount: '1 serving', calories: 100, protein: 5, fat: 0, carbs: 0 })
function product(id: string) {
  return { foodId: id, name: 'Rice Cakes', brandName: 'Brand', servings: [] }
}

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
