import { describe, expect, it } from 'vitest'
import {
  validateMacrosResponse,
  validateParserItem,
  validateParserResponse,
} from './macroAiValidate'
import {
  formatAmountFromQuantityUnit,
  parseSnapshotFromItem,
  resolveMacroEstimate,
} from './macroLib'
import { computeV7Multiplier } from './macroV7Resolve'
import {
  normalizeFatSecretServing,
  rankFatSecretCandidates,
  takeCandidateBatch,
  buildPass2Candidates,
} from './macroCandidateRank'
import { buildFatSecretCacheKey } from './macroFatSecretCache'
import type { FatSecretFoodRef } from '../../types/domain'

describe('V7 parser validation', () => {
  it('accepts quantity, unit, unitFamily, estimated', () => {
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

  it('requires originalPortion when estimated', () => {
    expect(
      validateParserItem({
        name: 'Almonds',
        quantity: 28,
        unit: 'g',
        unitFamily: 'mass',
        estimated: true,
        originalPortion: '',
        notes: '',
        fatSecretSearch: 'almonds',
      }),
    ).toBe(false)
    expect(
      validateParserItem({
        name: 'Almonds',
        quantity: 28,
        unit: 'g',
        unitFamily: 'mass',
        estimated: true,
        originalPortion: 'handful',
        notes: '',
        fatSecretSearch: 'almonds',
      }),
    ).toBe(true)
  })

  it('allows unit serving only with unitFamily serving', () => {
    expect(
      validateParserItem({
        name: 'Oatmeal',
        quantity: 2,
        unit: 'serving',
        unitFamily: 'serving',
        estimated: false,
        originalPortion: '',
        notes: '',
        fatSecretSearch: 'oatmeal',
      }),
    ).toBe(true)
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

describe('V7 parseSnapshotFromItem', () => {
  it('stores unitFamily and estimated', () => {
    const snap = parseSnapshotFromItem({
      name: 'Almonds',
      quantity: 28,
      unit: 'g',
      unitFamily: 'mass',
      estimated: true,
      originalPortion: 'handful',
      notes: '',
      fatSecretSearch: 'almonds',
    })
    expect(snap.quantity).toBe(28)
    expect(snap.unit).toBe('g')
    expect(snap.unitFamily).toBe('mass')
    expect(snap.estimated).toBe(true)
    expect(snap.originalPortion).toBe('handful')
    expect(snap.amount).toBe('28 g')
  })
})

describe('V7 computeV7Multiplier', () => {
  it('DIRECT: 2 cookies vs 1 cookie → 2', () => {
    expect(
      computeV7Multiplier({
        quantity: 2,
        unit: 'cookie',
        relationship: 'DIRECT',
        servingDescription: '1 cookie',
      }),
    ).toBe(2)
  })

  it('DIRECT: 2 cookies vs 3 cookies → 0.67', () => {
    expect(
      computeV7Multiplier({
        quantity: 2,
        unit: 'cookie',
        relationship: 'DIRECT',
        servingDescription: '3 cookies',
      }),
    ).toBeCloseTo(0.67, 1)
  })

  it('DIRECT: 183 g vs 4 oz', () => {
    const m = computeV7Multiplier({
      quantity: 183,
      unit: 'g',
      relationship: 'DIRECT',
      servingDescription: '4 oz',
    })
    expect(m).toBeGreaterThan(1.5)
    expect(m).toBeLessThan(1.7)
  })

  it('DIRECT: 1 tsp vs 1 tbsp → ~0.33', () => {
    expect(
      computeV7Multiplier({
        quantity: 1,
        unit: 'tsp',
        relationship: 'DIRECT',
        servingDescription: '1 tbsp',
      }),
    ).toBeCloseTo(0.33, 1)
  })

  it('EQUIVALENT_COUNT: 2 dried apricot vs 4 pieces', () => {
    expect(
      computeV7Multiplier({
        quantity: 2,
        unit: 'dried apricot',
        relationship: 'EQUIVALENT_COUNT',
        servingDescription: '4 pieces',
      }),
    ).toBe(0.5)
  })

  it('WHOLE_ITEM: 0.33 sandwich vs 1 sandwich', () => {
    expect(
      computeV7Multiplier({
        quantity: 0.333333,
        unit: 'sandwich',
        relationship: 'WHOLE_ITEM',
        servingDescription: '1 sandwich',
      }),
    ).toBeCloseTo(0.33, 1)
  })

  it('NEEDS_ESTIMATE: 6 fries bridged as 45 g vs 80 g order', () => {
    expect(
      computeV7Multiplier({
        quantity: 6,
        unit: 'fry',
        relationship: 'NEEDS_ESTIMATE',
        servingDescription: '1 order (80 g)',
        estimateQuantity: 45,
        estimateUnit: 'g',
      }),
    ).toBeCloseTo(0.56, 1)
  })

  it('exact conversion beats NEEDS_ESTIMATE for mass↔mass', () => {
    expect(
      computeV7Multiplier({
        quantity: 6,
        unit: 'oz',
        relationship: 'NEEDS_ESTIMATE',
        servingDescription: '4 oz',
        estimateQuantity: 1.5,
        estimateUnit: 'serving',
      }),
    ).toBe(1.5)

    expect(
      computeV7Multiplier({
        quantity: 2,
        unit: 'oz',
        relationship: 'NEEDS_ESTIMATE',
        servingDescription: '4 oz',
        estimateQuantity: 2,
        estimateUnit: 'serving',
      }),
    ).toBe(0.5)

    const steak = computeV7Multiplier({
      quantity: 6,
      unit: 'oz',
      relationship: 'NEEDS_ESTIMATE',
      servingDescription: '101 g',
      estimateQuantity: 6,
      estimateUnit: 'serving',
    })
    expect(steak).toBeCloseTo(1.68, 1)
  })

  it('exact conversion beats NEEDS_ESTIMATE for volume↔volume', () => {
    expect(
      computeV7Multiplier({
        quantity: 1,
        unit: 'tsp',
        relationship: 'NEEDS_ESTIMATE',
        servingDescription: '1 tbsp',
        estimateQuantity: 1,
        estimateUnit: 'serving',
      }),
    ).toBeCloseTo(0.33, 1)
  })

  it('exact conversion beats NEEDS_ESTIMATE for identical count units', () => {
    expect(
      computeV7Multiplier({
        quantity: 1,
        unit: 'cookie',
        relationship: 'NEEDS_ESTIMATE',
        servingDescription: '2 cookies',
        estimateQuantity: 1,
        estimateUnit: 'serving',
      }),
    ).toBe(0.5)
  })

  it('exact conversion also beats wrong WHOLE_ITEM on mass', () => {
    expect(
      computeV7Multiplier({
        quantity: 6,
        unit: 'ounces',
        relationship: 'WHOLE_ITEM',
        servingDescription: '4 oz',
      }),
    ).toBe(1.5)
  })

  it('NEEDS_ESTIMATE still used when count cannot convert to mass serving', () => {
    expect(
      computeV7Multiplier({
        quantity: 6,
        unit: 'fry',
        relationship: 'NEEDS_ESTIMATE',
        servingDescription: '1 order (80 g)',
        estimateQuantity: 45,
        estimateUnit: 'g',
      }),
    ).toBeCloseTo(0.56, 1)
  })
})

describe('V7 serving normalize + rank', () => {
  it('normalizes mass and count servings', () => {
    expect(normalizeFatSecretServing('4 oz').kind).toBe('mass')
    expect(normalizeFatSecretServing('3 cookies').kind).toBe('count')
    expect(normalizeFatSecretServing('1 tbsp').kind).toBe('volume')
  })

  it('prefers mass-compatible servings for mass family but keeps strong name matches eligible', () => {
    const foods: FatSecretFoodRef[] = [
      {
        foodId: '1',
        name: 'Green Beans',
        servings: [
          { servingId: 'a', description: '1 cup', calories: 44, protein: 2 },
          { servingId: 'b', description: '4 oz', calories: 31, protein: 2, isDefault: true },
        ],
      },
      {
        foodId: '2',
        name: 'Green Bean Casserole',
        servings: [{ servingId: 'c', description: '1 cup', calories: 200, protein: 5 }],
      },
    ]
    const ranked = rankFatSecretCandidates({
      foods,
      unitFamily: 'mass',
      foodName: 'Green Beans',
      fatSecretSearch: 'green beans',
    })
    expect(ranked[0]!.serving.description).toMatch(/oz|g/i)
    const batch = takeCandidateBatch(ranked, 0, 12)
    expect(batch.length).toBeGreaterThan(0)
  })

  it('pass 2 carries prior best and skips the rest of pass 1', () => {
    const foods: FatSecretFoodRef[] = Array.from({ length: 20 }, (_, i) => ({
      foodId: String(i + 1),
      name: `Food ${i + 1}`,
      servings: [{ servingId: `s${i}`, description: '1 serving', calories: 100, protein: 1 }],
    }))
    const ranked = rankFatSecretCandidates({
      foods,
      unitFamily: 'count',
      foodName: 'Food 1',
      fatSecretSearch: 'Food',
    })
    const pass1 = takeCandidateBatch(ranked, 0, 12)
    expect(pass1.length).toBe(12)
    const carry = pass1[2]!
    const pass2 = buildPass2Candidates(ranked, 12, carry)
    expect(pass2[0]!.foodIndex).toBe(carry.foodIndex)
    // Other pass-1 foods should not reappear
    const pass1FoodIndexes = new Set(pass1.map((c) => c.foodIndex))
    for (const c of pass2.slice(1)) {
      expect(pass1FoodIndexes.has(c.foodIndex)).toBe(false)
    }
  })
})

describe('V7 cache key', () => {
  it('distinguishes estimated portions', () => {
    const a = buildFatSecretCacheKey({
      fatSecretSearch: 'almonds',
      unitFamily: 'mass',
      estimated: true,
      originalPortion: 'handful',
    })
    const b = buildFatSecretCacheKey({
      fatSecretSearch: 'almonds',
      unitFamily: 'mass',
      estimated: true,
      originalPortion: 'big scoop',
    })
    const c = buildFatSecretCacheKey({
      fatSecretSearch: 'green beans',
      unitFamily: 'mass',
      estimated: false,
    })
    const d = buildFatSecretCacheKey({
      fatSecretSearch: 'Green Beans',
      unitFamily: 'mass',
      estimated: false,
    })
    expect(a).not.toBe(b)
    expect(c).toBe(d)
  })
})

describe('V7 resolveMacroEstimate — code multiplier from relationship', () => {
  const oreoFs: FatSecretFoodRef[] = [
    {
      foodId: '1',
      name: 'Oreo',
      servings: [{ servingId: '1', description: '1 cookie', calories: 53, protein: 0.5, isDefault: true }],
    },
  ]

  it('scales nutrition from DIRECT relationship (not AI multiplier)', () => {
    const result = resolveMacroEstimate(
      {
        libraryIndex: null,
        fatSecretIndex: 1,
        servingIndex: 1,
        relationshipV7: 'DIRECT',
        calories: 0,
        protein: 0,
        servingType: 'cookie',
      },
      [],
      oreoFs,
      { quantity: 2, unit: 'cookie', userAmount: '2 cookie' },
    )
    expect(result.calories).toBe(106)
    expect(result.servingMultiplier).toBe(2)
    expect(result.servingUnit).toBe('cookie')
  })

  it('2 Oreos vs 3-cookie serving', () => {
    const fs: FatSecretFoodRef[] = [
      {
        foodId: '1',
        name: 'Oreo',
        servings: [{ servingId: '1', description: '3 cookies', calories: 160, protein: 1.5, isDefault: true }],
      },
    ]
    const result = resolveMacroEstimate(
      {
        libraryIndex: null,
        fatSecretIndex: 1,
        servingIndex: 1,
        relationshipV7: 'DIRECT',
        calories: 0,
        protein: 0,
        servingType: 'cookie',
      },
      [],
      fs,
      { quantity: 2, unit: 'cookie', userAmount: '2 cookie' },
    )
    expect(result.calories).toBe(Math.round(160 * (2 / 3)))
    expect(formatAmountFromQuantityUnit(2, 'cookie')).toBe('2 cookie')
  })
})

describe('V7 macros AI validation', () => {
  it('accepts FatSecret DIRECT without multiplier', () => {
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
        servingType: 'cookie',
      }),
    ).toBe(true)
  })

  it('accepts NEEDS_UNIT_BRIDGE without estimate fields (AI #3 supplies bridge)', () => {
    expect(
      validateMacrosResponse({
        libraryIndex: null,
        fatSecretIndex: 1,
        servingIndex: 1,
        relationship: 'NEEDS_UNIT_BRIDGE',
        calories: 0,
        protein: 0,
        servingType: 'fry',
      }),
    ).toBe(true)
  })

  it('rejects unknown relationship NEEDS_ESTIMATE on V8 schema', () => {
    expect(
      validateMacrosResponse({
        libraryIndex: null,
        fatSecretIndex: 1,
        servingIndex: 1,
        relationship: 'NEEDS_ESTIMATE' as 'NEEDS_UNIT_BRIDGE',
        calories: 0,
        protein: 0,
        servingType: 'fry',
      }),
    ).toBe(false)
  })

  it('accepts NEED_MORE_CANDIDATES', () => {
    expect(
      validateMacrosResponse({
        libraryIndex: null,
        fatSecretIndex: null,
        servingIndex: null,
        relationship: 'NEED_MORE_CANDIDATES',
        calories: 0,
        protein: 0,
        servingType: '',
      }),
    ).toBe(true)
  })
})
