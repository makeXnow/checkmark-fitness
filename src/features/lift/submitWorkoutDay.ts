import { localDateISO } from '../../lib/localDate'
import type { LiftPayload } from '../../types/domain'
import { historyEntryLocalDate } from './liftHistory'
import { getSessionMainWeight, nextDayIndexFromHistory, parseStatusMultiplier } from './plates'

export { hasLiftHistoryForDayOnDate } from './liftHistory'

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
  const submitLocalDate = options?.localDate ?? localDateISO(new Date())
  const submitDateISO = dateAtLocalNoonISO(submitLocalDate)
  const dayWorkouts = payload.workouts.filter((w) => w.dayId === dayId)
  const twIds = new Set(dayWorkouts.map((x) => x.id))
  const nextHistory = (payload.history || []).filter((entry) => {
    if (!twIds.has(entry.workoutId)) return true
    return historyEntryLocalDate(entry) !== submitLocalDate
  })

  const plates = payload.availablePlates || []
  const nextWorkouts = payload.workouts.map((w) => {
    if (!twIds.has(w.id)) return w
    const chosen = options?.statusByWorkoutId?.[w.id]
    const chosenId = chosen && statuses.some((s) => s.id === chosen) ? chosen : (statuses[0]?.id ?? '')
    const status = statuses.find((s) => s.id === chosenId) ?? statuses[0]
    const mult = parseStatusMultiplier(status?.multiplier)
    const inc = w.increment || 0
    const sessionWeight = getSessionMainWeight(w, payload.history, plates)
    const newWeight = Math.max(0, sessionWeight + inc * mult)
    nextHistory.push({
      id: crypto.randomUUID(),
      workoutId: w.id,
      workoutName: w.name,
      date: submitDateISO,
      weight: sessionWeight,
      oldWeight: sessionWeight,
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
