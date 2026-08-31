import { describe, expect, it } from 'vitest'
import {
  ensureConsumption,
  inferCountUnitFromFoodPhrase,
} from './consumptionNormalize'
import { parseConsumptionIntent } from './consumptionIntent'
import { buildServingPipelineTrace } from '../../dev/servingAudit/servingAuditTrace'
import {
  parseServingAuditV4Csv,
  replayServingAuditV4Csv,
} from '../../dev/servingAudit/servingAuditV4Replay'
import type { FatSecretFoodRef } from '../../types/domain'

describe('bare count → serving diagnosis', () => {
  it('application code maps bare numeric amount to serving (the bug class)', () => {
    const intent = parseConsumptionIntent('1')
    expect(intent?.unit).toBe('serving')
    // After fix: whole number is count, not fraction_of_item
    expect(intent?.quantityType).toBe('count')
  })

  it('ensureConsumption recovers Oreo/cookie from name + bare amount', () => {
    const c = ensureConsumption(
      '1',
      { quantity: 1, unit: 'serving', kind: 'fraction_of_item' },
      { name: 'Oreos', userInput: '1 Oreo' },
    )
    expect(c?.quantity).toBe(1)
    expect(c?.kind).toBe('count')
    expect(c?.unit.toLowerCase()).toMatch(/oreo|cookie/)
  })

  it('ensureConsumption recovers apricot from user speech', () => {
    const c = ensureConsumption(
      '2',
      { quantity: 2, unit: 'serving', kind: 'fraction_of_item' },
      { name: 'Dried Apricots', userInput: '2 dried apricots' },
    )
    expect(c?.quantity).toBe(2)
    expect(c?.kind).toBe('count')
    expect(c?.unit.toLowerCase()).toMatch(/apricot/)
  })

  it('ensureConsumption recovers nugget from McNuggets name', () => {
    const c = ensureConsumption(
      '5',
      { quantity: 5, unit: 'serving', kind: 'fraction_of_item' },
      { name: 'McNuggets', userInput: '5 McNuggets' },
    )
    expect(c?.kind).toBe('count')
    expect(c?.unit.toLowerCase()).toMatch(/nugget|mcnugget/)
  })

  it('ensureConsumption recovers taco from name', () => {
    const c = ensureConsumption(
      '3',
      { quantity: 3, unit: 'serving', kind: 'fraction_of_item' },
      { name: 'Tacos Al Carbon', userInput: '3 El Pollo Loco tacos' },
    )
    expect(c?.kind).toBe('count')
    expect(c?.unit.toLowerCase()).toMatch(/taco/)
  })

  it('ensureConsumption recovers egg white phrasing', () => {
    const c = ensureConsumption(
      '2',
      { quantity: 2, unit: 'serving', kind: 'fraction_of_item' },
      { name: 'Egg Whites', userInput: '2 egg whites' },
    )
    expect(c?.kind).toBe('count')
    expect(c?.unit.toLowerCase()).toMatch(/egg|white/)
  })
})

describe('v4 key-case pipeline replay (no GPT/FS)', () => {
  it('1 Oreo vs 3 cookies → mult 1/3', () => {
    const oreoFs: FatSecretFoodRef[] = [
      {
        foodId: '1',
        name: 'Oreo',
        servings: [{ servingId: '1', description: '3 cookies', calories: 160, protein: 1, isDefault: true }],
      },
    ]
    const consumption = ensureConsumption(
      '1',
      { quantity: 1, unit: 'serving', kind: 'fraction_of_item' },
      { name: 'Oreos', userInput: '1 Oreo' },
    )
    const trace = buildServingPipelineTrace({
      quantity: 1,
      unit: 'cookie',
      consumption,
      userAmount: '1',
      foodName: 'Oreos',
      userInput: '1 Oreo',
      macroSnap: {
        fatSecretIndex: 1,
        servingIndex: 1,
        multiplier: 1 / 3,
        libraryIndex: null,
        calories: 0,
        protein: 0,
        servingType: '',
      },
      selectedFood: oreoFs[0]!,
      selectedServing: oreoFs[0]!.servings[0]!,
      customFoods: [],
      fatSecretResults: oreoFs,
    })
    expect(trace.consumption?.kind).toBe('count')
    expect(trace.aiMultiplier).toBeCloseTo(1 / 3, 2)
    expect(trace.result?.servingMultiplier).toBe(1)
  })

  it('2 apricots vs 4 pieces → mult 0.5', () => {
    const fs: FatSecretFoodRef[] = [
      {
        foodId: '1',
        name: 'Dried Apricots',
        servings: [{ servingId: '1', description: '4 pieces', calories: 100, protein: 1, isDefault: true }],
      },
    ]
    const consumption = ensureConsumption(
      '2',
      { quantity: 2, unit: 'serving', kind: 'fraction_of_item' },
      { name: 'Dried Apricots', userInput: '2 dried apricots' },
    )
    const trace = buildServingPipelineTrace({
      quantity: 2,
      unit: 'dried apricot',
      consumption,
      userAmount: '2',
      foodName: 'Dried Apricots',
      userInput: '2 dried apricots',
      macroSnap: {
        fatSecretIndex: 1,
        servingIndex: 1,
        multiplier: 0.5,
        libraryIndex: null,
        calories: 0,
        protein: 0,
        servingType: '',
      },
      selectedFood: fs[0]!,
      selectedServing: fs[0]!.servings[0]!,
      customFoods: [],
      fatSecretResults: fs,
    })
    expect(trace.aiMultiplier).toBe(0.5)
    expect(trace.result?.servingMultiplier).toBe(2)
  })

  it('5 McNuggets vs 6 nuggets → mult 5/6', () => {
    const fs: FatSecretFoodRef[] = [
      {
        foodId: '1',
        name: 'Chicken McNuggets',
        servings: [{ servingId: '1', description: '6 nuggets', calories: 250, protein: 14, isDefault: true }],
      },
    ]
    const consumption = ensureConsumption(
      '5',
      { quantity: 5, unit: 'serving', kind: 'fraction_of_item' },
      { name: 'McNuggets', userInput: '5 McNuggets' },
    )
    const trace = buildServingPipelineTrace({
      quantity: 5,
      unit: 'nugget',
      consumption,
      userAmount: '5',
      foodName: 'McNuggets',
      userInput: '5 McNuggets',
      macroSnap: {
        fatSecretIndex: 1,
        servingIndex: 1,
        multiplier: 5 / 6,
        libraryIndex: null,
        calories: 0,
        protein: 0,
        servingType: '',
      },
      selectedFood: fs[0]!,
      selectedServing: fs[0]!.servings[0]!,
      customFoods: [],
      fatSecretResults: fs,
    })
    expect(trace.aiMultiplier).toBeCloseTo(5 / 6, 2)
    expect(trace.result?.servingMultiplier).toBe(5)
  })

  it('3 tacos vs 3-piece order → mult 1', () => {
    const fs: FatSecretFoodRef[] = [
      {
        foodId: '1',
        name: 'Tacos Al Carbon - 3 Pieces',
        servings: [{ servingId: '1', description: '1 serving', calories: 300, protein: 20, isDefault: true }],
      },
    ]
    const consumption = ensureConsumption(
      '3',
      { quantity: 3, unit: 'serving', kind: 'fraction_of_item' },
      { name: 'Tacos Al Carbon', userInput: '3 El Pollo Loco tacos' },
    )
    const trace = buildServingPipelineTrace({
      quantity: 3,
      unit: 'taco',
      consumption,
      userAmount: '3',
      foodName: 'Tacos Al Carbon',
      userInput: '3 El Pollo Loco tacos',
      macroSnap: {
        fatSecretIndex: 1,
        servingIndex: 1,
        multiplier: 1,
        libraryIndex: null,
        calories: 0,
        protein: 0,
        servingType: '',
      },
      selectedFood: fs[0]!,
      selectedServing: fs[0]!.servings[0]!,
      customFoods: [],
      fatSecretResults: fs,
    })
    expect(trace.effectiveServingDescription).toBe('3 pieces')
    expect(trace.aiMultiplier).toBe(1)
    expect(trace.result?.servingMultiplier).toBe(3)
  })

  it('2 tbsp peanut butter control → mult 1', () => {
    const fs: FatSecretFoodRef[] = [
      {
        foodId: '1',
        name: 'Peanut Butter',
        servings: [{ servingId: '1', description: '2 tbsp', calories: 190, protein: 7, isDefault: true }],
      },
    ]
    const consumption = ensureConsumption(
      '2 tbsp',
      { quantity: 2, unit: 'tbsp', kind: 'volume' },
      { name: 'Peanut Butter', userInput: '2 tbsp peanut butter' },
    )
    const trace = buildServingPipelineTrace({
      quantity: 2,
      unit: 'tbsp',
      consumption,
      userAmount: '2 tbsp',
      foodName: 'Peanut Butter',
      userInput: '2 tbsp peanut butter',
      macroSnap: {
        fatSecretIndex: 1,
        servingIndex: 1,
        multiplier: 1,
        libraryIndex: null,
        calories: 0,
        protein: 0,
        servingType: '',
      },
      selectedFood: fs[0]!,
      selectedServing: fs[0]!.servings[0]!,
      customFoods: [],
      fatSecretResults: fs,
    })
    expect(trace.aiMultiplier).toBe(1)
    expect(trace.result?.servingMultiplier).toBe(2)
    expect(trace.result?.servingUnit).toBe('tbsp')
  })

  it('3 carrots vs 100g — AI multiplier estimate, preserve carrots on card', () => {
    const fs: FatSecretFoodRef[] = [
      {
        foodId: '1',
        name: 'Carrots',
        servings: [{ servingId: '1', description: '100 g', calories: 35, protein: 1, isDefault: true }],
      },
    ]
    const consumption = ensureConsumption(
      '3',
      { quantity: 3, unit: 'serving', kind: 'fraction_of_item' },
      { name: 'Carrots', userInput: '3 carrots' },
    )
    const trace = buildServingPipelineTrace({
      quantity: 3,
      unit: 'carrot',
      consumption,
      userAmount: '3',
      foodName: 'Carrots',
      userInput: '3 carrots',
      macroSnap: {
        fatSecretIndex: 1,
        servingIndex: 1,
        multiplier: 1.2,
        libraryIndex: null,
        calories: 0,
        protein: 0,
        servingType: '',
      },
      selectedFood: fs[0]!,
      selectedServing: fs[0]!.servings[0]!,
      customFoods: [],
      fatSecretResults: fs,
    })
    expect(trace.aiMultiplier).toBe(1.2)
    expect(trace.result?.servingMultiplier).toBe(3)
    expect(trace.result?.servingUnit?.toLowerCase()).toMatch(/carrot/)
  })
})

describe('CSV replay', () => {
  const sampleCsv = `user said,parsed name,parsed amount,consumption qty,consumption unit,consumption kind,fatsecret search,fatsecret food,fs serving,db serving qty,db serving unit,relationship,normalized qty,normalized unit,normalized estimated,computed multiplier,result display,result multiplier,error
1 Oreo,Oreos,1,1,serving,fraction_of_item,Oreo,Oreo,3 cookies,3,cookies,fraction_of_whole,,,,0.333333,1 cookie,1,
2 dried apricots,Dried Apricots,2,2,serving,fraction_of_item,dried apricot,Dried Apricots,4 pieces,4,pieces,fraction_of_whole,,,,0.5,2 dried apricot,2,
2 tbsp peanut butter,Peanut Butter,2 tbsp,2,tbsp,volume,peanut butter,Peanut Butter,2 tbsp,2,tbsp,same_unit,,,,1,2 tbsp,2,`

  it('parses and improves bare-count rows without API calls', () => {
    const rows = parseServingAuditV4Csv(sampleCsv)
    expect(rows).toHaveLength(3)
    const replayed = replayServingAuditV4Csv(sampleCsv)
    const oreo = replayed[0]!
    expect(oreo.before.consumptionUnit).toBe('serving')
    expect(oreo.after.consumptionKind).toBe('count')
    expect(oreo.after.computedMultiplier).toBeTruthy()
    expect(Number(oreo.after.computedMultiplier)).toBeCloseTo(1 / 3, 2)
    expect(oreo.changed).toBe(true)

    const pb = replayed[2]!
    expect(pb.after.computedMultiplier).toBe('1')
  })
})

describe('inferCountUnitFromFoodPhrase', () => {
  it('extracts from user speech without product hardcodes', () => {
    expect(inferCountUnitFromFoodPhrase('Oreos', 'I ate an Oreo')?.toLowerCase()).toMatch(/oreo/)
    expect(inferCountUnitFromFoodPhrase('Dried Apricots', 'two dried apricots')?.toLowerCase()).toMatch(
      /apricot/,
    )
  })
})
