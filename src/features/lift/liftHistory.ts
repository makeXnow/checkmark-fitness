import { localDateISO } from '../../lib/localDate'
import type { LiftHistoryEntry, LiftPayload } from '../../types/domain'

/** Calendar day (local) for a history entry's `date` ISO string. */
export function historyEntryLocalDate(entry: Pick<LiftHistoryEntry, 'date'>): string {
  return localDateISO(new Date(entry.date))
}

export function hasLiftHistoryForDayOnDate(
  payload: Pick<LiftPayload, 'workouts' | 'history'>,
  dayId: string,
  localDate: string,
): boolean {
  const workoutIds = new Set(payload.workouts.filter((w) => w.dayId === dayId).map((w) => w.id))
  if (workoutIds.size === 0) return false
  return (payload.history || []).some((entry) => {
    if (!workoutIds.has(entry.workoutId)) return false
    return historyEntryLocalDate(entry) === localDate
  })
}

function pickBetterHistoryEntry(a: LiftHistoryEntry, b: LiftHistoryEntry): LiftHistoryEntry {
  const manualA = a.statusName === 'Manual'
  const manualB = b.statusName === 'Manual'
  if (manualA && !manualB) return b
  if (!manualA && manualB) return a
  return new Date(b.date).getTime() > new Date(a.date).getTime() ? b : a
}

/** One log row per exercise per local calendar day; prefers submit over manual. */
export function dedupeLiftHistory(history: LiftHistoryEntry[]): LiftHistoryEntry[] {
  const byKey = new Map<string, LiftHistoryEntry>()
  for (const entry of history) {
    if (!entry?.date || !entry.workoutId) continue
    const key = `${entry.workoutId}|${historyEntryLocalDate(entry)}`
    const existing = byKey.get(key)
    byKey.set(key, existing ? pickBetterHistoryEntry(existing, entry) : entry)
  }
  return [...byKey.values()].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
}

export function normalizeLiftHistoryOnLoad(history: LiftHistoryEntry[] | undefined): {
  history: LiftHistoryEntry[]
  changed: boolean
} {
  const input = history || []
  const deduped = dedupeLiftHistory(input)
  return {
    history: deduped,
    changed: deduped.length !== input.length,
  }
}
