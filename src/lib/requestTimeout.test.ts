import { afterEach, describe, expect, it, vi } from 'vitest'
import { withRequestTimeout } from './requestTimeout'

afterEach(() => { vi.useRealTimers() })
describe('request deadlines', () => {
  it('times out even when fetch or its body ignores abort, without AbortSignal.timeout', async () => {
    vi.useFakeTimers()
    let signal!: AbortSignal
    const operation = withRequestTimeout(async (s) => { signal = s; return new Promise(() => {}) }, 90_000, 'Timed out')
    const result = expect(operation).rejects.toThrow('Timed out')
    await vi.advanceTimersByTimeAsync(90_000)
    await result
    expect(signal.aborted).toBe(true)
    expect(vi.getTimerCount()).toBe(0)
  })
  it('cancels immediately and ignores late results', async () => {
    vi.useFakeTimers()
    const controller = new AbortController()
    let finish!: (value: string) => void
    const operation = withRequestTimeout(() => new Promise<string>(resolve => { finish = resolve }), 90_000, 'Timed out', controller.signal)
    await Promise.resolve()
    controller.abort()
    await expect(operation).rejects.toMatchObject({ name: 'AbortError' })
    finish('late result')
    expect(vi.getTimerCount()).toBe(0)
  })
  it('cleans up the deadline when the full operation succeeds', async () => {
    vi.useFakeTimers()
    await expect(withRequestTimeout(async () => 'done', 90_000, 'Timed out')).resolves.toBe('done')
    expect(vi.getTimerCount()).toBe(0)
  })
})
