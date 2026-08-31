import { describe, expect, it } from 'vitest'
import { validateMacrosResponse, validateParserItem, validateUnitBridgeResponse } from './macroAiValidate'
import { parseSnapshotFromItem, resolveMacroEstimate } from './macroLib'
import {
  buildUnitBridgeQuestion,
  computeV8Multiplier,
  displayUnitForQuantity,
  formatQuantityUnitDisplay,
} from './macroV8Resolve'
import type { FatSecretFoodRef } from '../../types/domain'
import type { MacroCustomFood } from '../../types/domain'

describe('V8 singular/plural display', () => {
  it('picks singular for quantity 1 and plural otherwise', () => {
    expect(displayUnitForQuantity(1, 'cookie', 'cookies')).toBe('cookie')
    expect(displayUnitForQuantity(2, 'cookie', 'cookies')).toBe('cookies')
    expect(displayUnitForQuantity(0.5, 'sandwich', 'sandwiches')).toBe('sandwiches')
    expect(formatQuantityUnitDisplay(1, 'cookie', 'cookies')).toBe('1 cookie')
    expect(formatQuantityUnitDisplay(2, 'cookie', 'cookies')).toBe('2 cookies')
    expect(formatQuantityUnitDisplay(1.5, 'sandwich', 'sandwiches')).toBe('1.5 sandwiches')
  })

  it('parseSnapshotFromItem stores singular/plural and display unit', () => {
    const snap = parseSnapshotFromItem({
      name: 'Mozz Sticks',
      quantity: 3,
      unitSingular: 'mozzarella stick',
      unitPlural: 'mozzarella sticks',
      unitFamily: 'count',
      estimated: false,
      originalPortion: '',
      notes: '',
      fatSecretSearch: 'mozzarella sticks',
    })
    expect(snap.unitSingular).toBe('mozzarella stick')
    expect(snap.unitPlural).toBe('mozzarella sticks')
    expect(snap.unit).toBe('mozzarella sticks')
    expect(snap.amount).toBe('3 mozzarella sticks')
  })
})

describe('V8 computeV8Multiplier equation', () => {
  it('exact mass conversion beats NEEDS_UNIT_BRIDGE', () => {
    const r = computeV8Multiplier({
      quantity: 6,
      unit: 'oz',
      relationship: 'NEEDS_UNIT_BRIDGE',
      servingDescription: '4 oz',
      unitsPerServing: 99,
    })
    expect(r.multiplier).toBe(1.5)
    expect(r.deterministicOk).toBe(true)
    expect(r.usedUnitBridge).toBe(false)
  })

  it('userQuantity / unitsPerServing for bridge', () => {
    const r = computeV8Multiplier({
      quantity: 6,
      unit: 'fry',
      relationship: 'NEEDS_UNIT_BRIDGE',
      servingDescription: '1 order (80 g)',
      unitsPerServing: 20,
    })
    expect(r.multiplier).toBe(0.3)
    expect(r.usedUnitBridge).toBe(true)
  })

  it('never uses userQuantity as multiplier when bridge missing', () => {
    const r = computeV8Multiplier({
      quantity: 6,
      unit: 'fry',
      relationship: 'NEEDS_UNIT_BRIDGE',
      servingDescription: '1 order (80 g)',
      unitsPerServing: null,
    })
    expect(r.multiplier).toBeNull()
  })

  it('EQUIVALENT_COUNT: potsticker vs pieces', () => {
    expect(
      computeV8Multiplier({
        quantity: 4,
        unit: 'potsticker',
        relationship: 'EQUIVALENT_COUNT',
        servingDescription: '6 pieces',
      }).multiplier,
    ).toBeCloseTo(0.67, 1)
  })

  it('library same resolver: 2 items vs 2-item serving → 1', () => {
    expect(
      computeV8Multiplier({
        quantity: 2,
        unit: 'bar',
        relationship: 'DIRECT',
        servingDescription: '2 bars',
      }).multiplier,
    ).toBe(1)
  })
})

describe('V8 unit bridge question', () => {
  it('asks how many user-units are in one serving', () => {
    const q = buildUnitBridgeQuestion({
      foodName: 'Waffle Fries',
      brandName: 'Restaurant',
      servingDescription: '80 g',
      unitSingular: 'fry',
      unitPlural: 'fries',
      unitFamily: 'count',
    })
    expect(q).toContain('individual fries')
    expect(q).toContain('80 g')
    expect(q).not.toContain('6') // user quantity must not appear
  })
})

describe('V8 macros validation', () => {
  it('accepts NEEDS_UNIT_BRIDGE without estimate fields', () => {
    expect(
      validateMacrosResponse({
        libraryIndex: null,
        fatSecretIndex: 1,
        servingIndex: 1,
        relationship: 'NEEDS_UNIT_BRIDGE',
        calories: 0,
        protein: 0,
        servingType: '',
      }),
    ).toBe(true)
  })

  it('validates unit bridge response', () => {
    expect(validateUnitBridgeResponse({ unitsPerServing: 20 })).toBe(true)
    expect(validateUnitBridgeResponse({ unitsPerServing: 0 })).toBe(false)
    expect(validateUnitBridgeResponse({ unitsPerServing: -1 })).toBe(false)
  })

  it('accepts V8 parser singular/plural', () => {
    expect(
      validateParserItem({
        name: 'Eggs',
        quantity: 3,
        unitSingular: 'egg',
        unitPlural: 'eggs',
        unitFamily: 'count',
        estimated: false,
        originalPortion: '',
        notes: '',
        fatSecretSearch: 'egg',
      }),
    ).toBe(true)
  })
})

describe('V8 Food Library through same resolver', () => {
  const library: MacroCustomFood[] = [
    {
      id: 'lib1',
      name: 'My Granola Bars',
      baseAmount: '2 bars',
      calories: 200,
      protein: 6,
      fat: 8,
      carbs: 28,
    },
  ]

  it('2 bars vs library 2-bar serving → half calories of 2-bar package is wrong; multiplier 1', () => {
    const result = resolveMacroEstimate(
      {
        libraryIndex: 1,
        fatSecretIndex: null,
        servingIndex: null,
        relationshipV7: 'DIRECT',
        multiplier: 1,
        calories: 0,
        protein: 0,
        servingType: 'bar',
      },
      library,
      [],
      { quantity: 2, unit: 'bar', foodName: 'Granola Bar' },
    )
    expect(result.calories).toBe(200)
    expect(result.servingMultiplier).toBe(2)
  })
})

describe('V8 FatSecret unresolved never falls back to qty multiplier', () => {
  const foods: FatSecretFoodRef[] = [
    {
      foodId: '1',
      name: 'Onion Rings',
      servings: [{ servingId: 'a', description: '85 g', calories: 300, protein: 4, isDefault: true }],
    },
  ]

  it('returns zero macros when bridge missing (hard invariant)', () => {
    const result = resolveMacroEstimate(
      {
        libraryIndex: null,
        fatSecretIndex: 1,
        servingIndex: 1,
        relationshipV7: 'NEEDS_UNIT_BRIDGE',
        unitsPerServing: null,
        calories: 0,
        protein: 0,
        servingType: 'onion ring',
      },
      [],
      foods,
      { quantity: 7, unit: 'onion ring', foodName: 'Onion Rings' },
    )
    expect(result.calories).toBe(0)
  })

  it('applies AI #3 unitsPerServing', () => {
    const result = resolveMacroEstimate(
      {
        libraryIndex: null,
        fatSecretIndex: 1,
        servingIndex: 1,
        relationshipV7: 'NEEDS_UNIT_BRIDGE',
        unitsPerServing: 7,
        calories: 0,
        protein: 0,
        servingType: 'onion ring',
      },
      [],
      foods,
      { quantity: 7, unit: 'onion ring', foodName: 'Onion Rings' },
    )
    expect(result.calories).toBe(300)
  })
})
