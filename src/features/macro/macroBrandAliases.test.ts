import { describe, expect, it } from 'vitest'
import {
  rewriteFatSecretSearch,
  rewriteSpokenFoodLog,
  rewriteStoreLabelsInSearch,
} from './macroBrandAliases'

describe('macroBrandAliases', () => {
  it('marks ONE when flavor precedes one bar', () => {
    expect(rewriteSpokenFoodLog('Maple one bar')).toBe('Maple ONE bar')
    expect(rewriteSpokenFoodLog('birthday cake one bar')).toBe('birthday cake ONE bar')
  })

  it('does not inject ONE for quantity one maple bar', () => {
    expect(rewriteSpokenFoodLog('one maple bar')).toBe('one maple bar')
    expect(rewriteFatSecretSearch('maple bar', 'one maple bar')).toBe('maple bar')
    expect(rewriteFatSecretSearch('maple bar', 'One maple bar')).toBe('maple bar')
  })

  it('maps Walmart to Great Value in search', () => {
    expect(rewriteStoreLabelsInSearch('Walmart canned chicken')).toBe('Great Value canned chicken')
  })

  it('rescues ONE into fatSecretSearch from userInput', () => {
    expect(rewriteFatSecretSearch('maple bar', 'Maple one bar')).toMatch(/ONE/i)
    expect(rewriteFatSecretSearch('maple bar', 'Maple one bar')).toMatch(/maple/i)
  })
})
