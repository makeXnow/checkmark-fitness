import { describe, expect, it } from 'vitest'
import type { MacroDayItem } from '../../types/domain'
import { canCopyDiaryFood, copyDiaryFood, libraryFoodDayItem } from './foodSelection'

describe('copying selected foods', () => {
  it('preserves portions, nutrition and audit data with independent entry IDs', () => {
    const original: MacroDayItem = {
      id: 'original', name: 'Yogurt', emoji: '🥣', amount: '2 cups',
      servingType: '1 cup', servingSize: 1, servingUnit: 'cup', servingMultiplier: 2,
      calories: 240, protein: 20, fat: 6, carbs: 26, baseCalories: 120, baseProtein: 10,
      status: 'ready', timestamp: 1, libraryFoodId: 'yogurt',
      userInput: 'two cups of yogurt',
      parseSnapshot: { name: 'Yogurt', amount: '2 cups', quantity: 2, unit: 'cup' },
    }
    const copy = copyDiaryFood(original)
    expect(copy.id).not.toBe(original.id)
    expect(copy.timestamp).toBeGreaterThan(original.timestamp!)
    expect(copy).toMatchObject({ ...original, id: copy.id, timestamp: copy.timestamp })
    expect(copy.parseSnapshot).not.toBe(original.parseSnapshot)
    expect(original.id).toBe('original')
    expect(copyDiaryFood(original).id).not.toBe(copy.id)
  })

  it('does not offer copying for incomplete entries, while accepting zero nutrition', () => {
    const food: MacroDayItem = { id: 'water', name: 'Water', amount: '1 cup', calories: 0, protein: 0, status: 'ready' }
    expect(canCopyDiaryFood(food)).toBe(true)
    expect(canCopyDiaryFood({ ...food, status: undefined, calories: 20 })).toBe(true)
    for (const status of ['pending', 'error', 'transcribing', 'processing_cancellable', 'editing_raw']) {
      expect(canCopyDiaryFood({ ...food, status })).toBe(false)
    }
    expect(canCopyDiaryFood({ ...food, name: '' })).toBe(false)
  })

  it('logs library nutrition for its full saved portion and supports later scaling', () => {
    const item = libraryFoodDayItem('beans', {
      name: 'Beans', emoji: '🫘', amount: '100 g', calories: 120, protein: 8,
      servingMultiplier: 1,
    })
    expect(item).toMatchObject({
      name: 'Beans', libraryFoodId: 'beans', status: 'ready',
      calories: 120, protein: 8, servingMultiplier: 100,
      baseCalories: 1.2, baseProtein: 0.08, servingType: '1 g',
    })
    const double = libraryFoodDayItem('beans', {
      name: 'Beans', emoji: '🫘', amount: '100 g', calories: 120, protein: 8,
      servingMultiplier: 2,
    })
    expect(double).toMatchObject({ calories: 240, protein: 16, servingMultiplier: 200 })
  })
})
