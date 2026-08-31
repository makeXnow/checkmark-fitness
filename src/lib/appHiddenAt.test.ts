import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  DATE_RESET_AFTER_HIDDEN_MS,
  clearAppHiddenAt,
  consumePageLoadStaleResume,
  recordAppHiddenAt,
  resetPageLoadStaleResumeForTests,
  wasHiddenLongEnough,
} from './appHiddenAt'

describe('app hidden timestamp', () => {
  const mem = new Map<string, string>()

  beforeEach(() => {
    mem.clear()
    resetPageLoadStaleResumeForTests()
    globalThis.localStorage = {
      getItem: (k) => mem.get(k) ?? null,
      setItem: (k, v) => {
        mem.set(k, v)
      },
      removeItem: (k) => {
        mem.delete(k)
      },
      clear: () => mem.clear(),
      key: () => null,
      get length() {
        return mem.size
      },
    }
  })

  afterEach(() => {
    clearAppHiddenAt()
    resetPageLoadStaleResumeForTests()
  })

  it('keeps the selected date when reopened before 5 minutes', () => {
    const hiddenAt = 1_000_000
    recordAppHiddenAt(hiddenAt)
    expect(wasHiddenLongEnough(DATE_RESET_AFTER_HIDDEN_MS, hiddenAt + 4 * 60 * 1000)).toBe(false)
  })

  it('resets to today when reopened at or after 5 minutes', () => {
    const hiddenAt = 1_000_000
    recordAppHiddenAt(hiddenAt)
    expect(wasHiddenLongEnough(DATE_RESET_AFTER_HIDDEN_MS, hiddenAt + 5 * 60 * 1000)).toBe(true)
  })

  it('does not reset when the app was never hidden', () => {
    expect(wasHiddenLongEnough(DATE_RESET_AFTER_HIDDEN_MS, 1_000_000)).toBe(false)
  })

  it('peeks the hide timestamp only once per page load', () => {
    const hiddenAt = 1_000_000
    recordAppHiddenAt(hiddenAt)
    const now = hiddenAt + 6 * 60 * 1000
    expect(consumePageLoadStaleResume(DATE_RESET_AFTER_HIDDEN_MS, now)).toBe(true)
    expect(consumePageLoadStaleResume(DATE_RESET_AFTER_HIDDEN_MS, now)).toBe(true)
    expect(wasHiddenLongEnough(DATE_RESET_AFTER_HIDDEN_MS, now)).toBe(false)
  })
})
