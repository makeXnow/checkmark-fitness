/** Reset selected date to today when reopening after this long away. */
export const DATE_RESET_AFTER_HIDDEN_MS = 5 * 60 * 1000

const STORAGE_KEY = 'checkmark-last-hidden-at'

/** Peek once per JS realm so React Strict Mode remounts keep the same answer. */
let pageLoadStale: boolean | undefined

export function recordAppHiddenAt(now = Date.now()): void {
  try {
    localStorage.setItem(STORAGE_KEY, String(now))
  } catch {
    /* quota or private mode */
  }
}

function readAppHiddenAt(): number | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw == null || raw === '') return null
    const at = Number(raw)
    return Number.isFinite(at) ? at : null
  } catch {
    return null
  }
}

export function clearAppHiddenAt(): void {
  try {
    localStorage.removeItem(STORAGE_KEY)
  } catch {
    /* ignore */
  }
}

/** True when the last hide/close was at least `thresholdMs` ago. Peek only; does not clear. */
export function wasHiddenLongEnough(thresholdMs = DATE_RESET_AFTER_HIDDEN_MS, now = Date.now()): boolean {
  const hiddenAt = readAppHiddenAt()
  if (hiddenAt == null) return false
  return now - hiddenAt >= thresholdMs
}

/** Read-and-clear the hide timestamp once for this page load (survives Strict Mode remount). */
export function consumePageLoadStaleResume(thresholdMs = DATE_RESET_AFTER_HIDDEN_MS, now = Date.now()): boolean {
  if (pageLoadStale === undefined) {
    pageLoadStale = wasHiddenLongEnough(thresholdMs, now)
    clearAppHiddenAt()
  }
  return pageLoadStale
}

export function markPageLoadStaleResumeHandled(): void {
  pageLoadStale = false
}

export function resetPageLoadStaleResumeForTests(): void {
  pageLoadStale = undefined
}
