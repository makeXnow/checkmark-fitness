import { localDateISO } from '../../lib/localDate'
import type { LiftHistoryEntry, LiftPayload, LiftWorkout } from '../../types/domain'

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

/** Most recent log row for a workout (any calendar day). */
export function getLatestHistoryEntryForWorkout(
  history: LiftHistoryEntry[] | undefined,
  workoutId: string,
): LiftHistoryEntry | undefined {
  let latest: LiftHistoryEntry | undefined
  for (const entry of history || []) {
    if (entry.workoutId !== workoutId) continue
    if (!latest || new Date(entry.date).getTime() > new Date(latest.date).getTime()) {
      latest = entry
    }
  }
  return latest
}

/** Align plan mainWeight with the next target recorded on the latest log entry. */
export function reconcileWorkoutMainWeightsFromHistory(
  workouts: LiftWorkout[],
  history: LiftHistoryEntry[] | undefined,
): { workouts: LiftWorkout[]; changed: boolean } {
  let changed = false
  const next = workouts.map((w) => {
    const latest = getLatestHistoryEntryForWorkout(history, w.id)
    const target = latest?.newWeight
    if (target === undefined || !Number.isFinite(target) || target === w.mainWeight) return w
    changed = true
    return { ...w, mainWeight: target }
  })
  return { workouts: next, changed }
}
