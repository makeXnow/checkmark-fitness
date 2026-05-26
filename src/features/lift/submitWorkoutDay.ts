import { localDateISO } from '../../lib/localDate'
import type { LiftPayload } from '../../types/domain'
import { nextDayIndexFromHistory, parseStatusMultiplier } from './plates'

export function dateAtLocalNoonISO(localDate: string): string {
  const [y, m, d] = localDate.split('-').map((x) => parseInt(x, 10))
  if (!y || !m || !d) return new Date().toISOString()
  return new Date(y, m - 1, d, 12, 0, 0, 0).toISOString()
}

export function buildSubmitWorkoutDayPayload(
  payload: LiftPayload,
  dayId: string,
  options?: {
    localDate?: string
    statusByWorkoutId?: Record<string, string>
    advanceDayIndex?: boolean
  },
): { nextPayload: LiftPayload; nextDayIndex?: number } {
  const statuses = payload.statuses || []
  const submitDateISO = options?.localDate ? dateAtLocalNoonISO(options.localDate) : new Date().toISOString()
  const dayWorkouts = payload.workouts.filter((w) => w.dayId === dayId)
  const nextHistory = [...(payload.history || [])]
  const twIds = new Set(dayWorkouts.map((x) => x.id))

  const nextWorkouts = payload.workouts.map((w) => {
    if (!twIds.has(w.id)) return w
    const chosen = options?.statusByWorkoutId?.[w.id]
    const chosenId = chosen && statuses.some((s) => s.id === chosen) ? chosen : (statuses[0]?.id ?? '')
    const status = statuses.find((s) => s.id === chosenId) ?? statuses[0]
    const mult = parseStatusMultiplier(status?.multiplier)
    const inc = w.increment || 0
    const newWeight = Math.max(0, w.mainWeight + inc * mult)
    nextHistory.push({
      id: crypto.randomUUID(),
      workoutId: w.id,
      workoutName: w.name,
      date: submitDateISO,
      weight: w.mainWeight,
      oldWeight: w.mainWeight,
      newWeight,
      statusName: status?.name ?? '',
    })
    return { ...w, mainWeight: newWeight }
  })

  const nextPayload: LiftPayload = {
    ...payload,
    history: nextHistory,
    workouts: nextWorkouts,
  }

  const advance = options?.advanceDayIndex ?? !options?.localDate
  const nextDayIndex = advance
    ? nextDayIndexFromHistory(payload.days, nextWorkouts, nextHistory)
    : undefined

  return { nextPayload, nextDayIndex }
}

export function hasLiftHistoryForDayOnDate(payload: LiftPayload, dayId: string, localDate: string): boolean {
  const workoutIds = new Set(payload.workouts.filter((w) => w.dayId === dayId).map((w) => w.id))
  if (workoutIds.size === 0) return false
  return (payload.history || []).some((entry) => {
    if (!workoutIds.has(entry.workoutId)) return false
    return localDateISO(new Date(entry.date)) === localDate
  })
}
