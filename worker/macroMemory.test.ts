import { describe, expect, it } from 'vitest'
import { buildPersonalMemory, buildPersonalVocabulary, matchPersonalMemory } from './macroMemory'

const cannedChicken = {
  foodId: '111',
  name: 'Chunk Chicken Breast',
  brandName: 'Great Value',
  servings: [{ servingId: 'a', description: '3 oz drained', calories: 60, protein: 13 }],
}

const logs = {
  '2026-10-03': [
    {
      name: 'Canned Chicken',
      amount: '10.5 oz drained',
      calories: 210,
      status: 'ready',
      userInput: 'one can of walmart chicken',
      fromBarcode: true,
      fatSecretResults: [cannedChicken],
    },
    {
      name: 'Grilled Chicken',
      amount: '8 oz',
      calories: 400,
      status: 'ready',
      fatSecretResults: [cannedChicken],
      macroEstimateSnapshot: { fatSecretIndex: 1 },
    },
  ],
}

describe('personal food memory', () => {
  it('keeps only trusted (barcode / confirmed) entries', () => {
    const entries = buildPersonalMemory(logs)
    expect(entries).toHaveLength(1)
    expect(entries[0]!.source).toBe('barcode')
  })

  it('matches the same product by brand/product words', () => {
    const entries = buildPersonalMemory(logs)
    expect(matchPersonalMemory(entries, { name: 'Canned Chicken', fatSecretSearch: 'Great Value canned chicken' })).toHaveLength(1)
  })

  it('does not match plain chicken to a canned product', () => {
    const entries = buildPersonalMemory(logs)
    expect(matchPersonalMemory(entries, { name: 'Chicken', fatSecretSearch: 'grilled chicken breast' })).toHaveLength(0)
  })

  it('builds vocabulary from library foods and scanned brands', () => {
    const vocab = buildPersonalVocabulary(logs, [{ name: 'Lemony Arugula Basil' }])
    expect(vocab).toContain('Lemony Arugula Basil')
    expect(vocab).toContain('Great Value')
  })

  it('ranks branded products above plain foods', () => {
    const oreo = { foodId: '9', name: 'Oreo Cookies', brandName: 'Oreo', servings: [] }
    const mixed = {
      '2026-10-01': [
        ...Array.from({ length: 9 }, () => ({ name: 'Chicken', status: 'ready' })),
        ...Array.from({ length: 2 }, () => ({
          name: "Reese's Oreo",
          status: 'ready',
          fatSecretResults: [oreo],
          macroEstimateSnapshot: { fatSecretIndex: 1 },
        })),
      ],
    }
    expect(buildPersonalVocabulary(mixed, [])).toEqual(["Reese's Oreo", 'Chicken'])
  })

  it('keeps frequently logged products even when the library is large', () => {
    const library = Array.from({ length: 50 }, (_, i) => ({ name: `Library Food ${i}` }))
    const oreo = { foodId: '9', name: 'Oreo Cookies', brandName: 'Oreo', servings: [] }
    const many = {
      '2026-10-01': Array.from({ length: 4 }, () => ({
        name: "Reese's Oreo",
        status: 'ready',
        fatSecretResults: [oreo],
        macroEstimateSnapshot: { fatSecretIndex: 1 },
      })),
    }
    expect(buildPersonalVocabulary(many, library, 10)[0]).toBe("Reese's Oreo")
  })

  it('learns a name the user corrected after one log', () => {
    const vocab = buildPersonalVocabulary(
      { '2026-10-04': [{ name: 'Siggi’s Skyr', status: 'ready', userEditedName: true }, { name: 'Banana', status: 'ready' }] },
      [],
    )
    expect(vocab).toContain('Siggi’s Skyr')
    expect(vocab).not.toContain('Banana')
  })
})
