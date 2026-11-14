import { afterEach, expect, it, vi } from 'vitest'
const apiFetch = vi.hoisted(() => vi.fn())
vi.mock('./apiPaths', () => ({ apiFetch, apiFetchForProfile: vi.fn() }))
import { confirmedMacroLogs, fetchBootstrap, MACRO_SAVE_TIMEOUT_MS, putMacro } from './api'
import { bindApiProfile } from './apiProfile'
afterEach(() => { vi.useRealTimers(); vi.resetAllMocks(); confirmedMacroLogs.clear() })
it('releases the save queue when a save or response body never finishes', async () => {
  vi.useFakeTimers()
  bindApiProfile('retry-test')
  apiFetch.mockResolvedValue({ ok: true, text: () => new Promise(() => {}) })
  const save = putMacro({ baseUpdatedAt: 1, goals: {}, customFoods: [], logs: {} })
  const failed = expect(save).rejects.toThrow('Saving timed out')
  await vi.advanceTimersByTimeAsync(MACRO_SAVE_TIMEOUT_MS)
  await failed
  apiFetch.mockResolvedValue(new Response(JSON.stringify({ ok: true, updatedAt: 2 })))
  await expect(putMacro({ baseUpdatedAt: 1, goals: {}, customFoods: [], logs: {} })).resolves.toMatchObject({ updatedAt: 2 })
})
it('does not let a stalled recovery fetch keep Retry waiting indefinitely', async () => {
  vi.useFakeTimers()
  apiFetch.mockImplementation(() => new Promise(() => {}))
  const failed = expect(fetchBootstrap()).rejects.toThrow('Connecting to your diary timed out')
  await vi.advanceTimersByTimeAsync(MACRO_SAVE_TIMEOUT_MS)
  await failed
})
