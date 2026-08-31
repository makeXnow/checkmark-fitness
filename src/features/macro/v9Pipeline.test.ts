import { describe, expect, it } from 'vitest'
import { annotateServingForUserUnit } from './macroCandidateAnnotate'
import { validateMacrosResponse } from './macroAiValidate'
import { computeV8Multiplier } from './macroV8Resolve'

describe('V9 candidate unit annotations', () => {
  it('marks oz↔g as deterministic match', () => {
    const a = annotateServingForUserUnit('100 g', 'oz')
    expect(a.deterministicUnitMatch).toBe(true)
    expect(a.normalizedServingQuantity).toBe(100)
    expect(a.normalizedServingUnit).toBe('g')
  })

  it('marks cookie count as deterministic match', () => {
    const a = annotateServingForUserUnit('4 cookies', 'cookie')
    expect(a.deterministicUnitMatch).toBe(true)
    expect(a.normalizedServingQuantity).toBe(4)
    expect(a.normalizedServingUnit?.toLowerCase()).toContain('cookie')
  })

  it('marks onion rings vs grams as non-deterministic', () => {
    const a = annotateServingForUserUnit('85 g', 'onion ring')
    expect(a.deterministicUnitMatch).toBe(false)
  })
})

describe('V9 AI #2 bridge fields on MACROS', () => {
  it('accepts NEEDS_UNIT_BRIDGE with bridgeQuestion + unitsPerServing', () => {
    expect(
      validateMacrosResponse({
        libraryIndex: null,
        fatSecretIndex: 1,
        servingIndex: 1,
        relationship: 'NEEDS_UNIT_BRIDGE',
        bridgeQuestion: 'How many individual onion rings are represented by 85 g of breaded onion rings?',
        unitsPerServing: 6,
        calories: 0,
        protein: 0,
        servingType: 'onion ring',
      }),
    ).toBe(true)
  })

  it('accepts WHOLE_ITEM with null bridge fields', () => {
    expect(
      validateMacrosResponse({
        libraryIndex: null,
        fatSecretIndex: 1,
        servingIndex: 1,
        relationship: 'WHOLE_ITEM',
        bridgeQuestion: null,
        unitsPerServing: null,
        calories: 0,
        protein: 0,
        servingType: 'sandwich',
      }),
    ).toBe(true)
  })
})

describe('V9 bridge math (code only)', () => {
  it('uses userQuantity / unitsPerServing', () => {
    const r = computeV8Multiplier({
      quantity: 5,
      unit: 'onion ring',
      relationship: 'NEEDS_UNIT_BRIDGE',
      servingDescription: '85 g',
      unitsPerServing: 6,
    })
    expect(r.usedUnitBridge).toBe(true)
    expect(r.multiplier).toBe(0.83)
  })

  it('never falls back to userQuantity as multiplier', () => {
    const r = computeV8Multiplier({
      quantity: 5,
      unit: 'onion ring',
      relationship: 'NEEDS_UNIT_BRIDGE',
      servingDescription: '85 g',
      unitsPerServing: null,
    })
    expect(r.multiplier).toBeNull()
  })
})
