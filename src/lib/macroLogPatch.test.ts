import { expect, it } from 'vitest'
import { macroLogPatch } from './macroLogPatch'
import { mergeMacroLogs, normalizeMacroDayItemStatus } from '../features/macro/macroLib'
import type { MacroDayItem } from '../types/domain'

it('omits unchanged history but keeps explicit deletion of the last food', () => {
  const history = { old: [{ id: 'old', audit: 'x'.repeat(8_400_000) }], today: [{ id: 'beans' }] }
  const patch = macroLogPatch<unknown>(history, { ...history, today: [] })
  expect(patch).toEqual({ today: [] })
  expect(JSON.stringify(patch).length).toBeLessThan(100)
})
it('recovers a persisted pending entry with an error as a retryable error', () => {
  const item = { id: 'beans', name: 'Green Beans', amount: '5 oz', status: 'pending', estimateError: "Estimate didn't finish — tap Retry." } as MacroDayItem
  expect(normalizeMacroDayItemStatus(item)).toEqual({ ...item, status: 'error' })
})

it('keeps a failed estimate actionable through diary merging and allows retry', () => {
  const pending = { id: 'beans', name: 'Green Beans', amount: '5 oz', status: 'pending', timestamp: 10 } as MacroDayItem
  const failed = { ...pending, status: 'error' as const, estimateError: 'Timed out' }
  const saved = mergeMacroLogs({ today: [pending] }, { today: [failed] })
  expect(saved.today[0].status).toBe('error')
  const retried = mergeMacroLogs(saved, { today: [{ ...pending, estimateError: undefined }] })
  expect(retried.today[0].status).toBe('pending')
  expect(retried.today[0].estimateError).toBeUndefined()
})
