export const LIFT_OPEN_MIN_MS = 10_000
export const LIFT_ASSUMPTION_OPEN_COUNT = 3
export const LIFT_ASSUMPTION_SUBMIT_GRACE_MS = 2 * 60 * 60 * 1000

export type LiftAssumptionActiveSession = {
  dayId: string
  localDate: string
  openedAt: number
}

export type LiftAssumptionPending = {
  dayId: string
  localDate: string
  assumedAt: number
  dismissed: boolean
}

export type LiftAssumptionPayload = {
  activeSession: LiftAssumptionActiveSession | null
  dailyOpens: Record<string, number>
  pending: LiftAssumptionPending | null
}

export type LiftAssumptionPrompt = {
  dayId: string
  localDate: string
  dayName: string
}

export function emptyLiftAssumptionPayload(): LiftAssumptionPayload {
  return {
    activeSession: null,
    dailyOpens: {},
    pending: null,
  }
}

export function parseLiftAssumptionPayload(raw: string | null | undefined): LiftAssumptionPayload {
  if (!raw) return emptyLiftAssumptionPayload()
  try {
    const parsed = JSON.parse(raw) as Partial<LiftAssumptionPayload>
    return {
      activeSession: parsed.activeSession ?? null,
      dailyOpens: parsed.dailyOpens ?? {},
      pending: parsed.pending ?? null,
    }
  } catch {
    return emptyLiftAssumptionPayload()
  }
}

function dailyOpenKey(dayId: string, localDate: string): string {
  return `${dayId}:${localDate}`
}

function finalizeActiveSession(payload: LiftAssumptionPayload, now: number): LiftAssumptionPayload {
  const session = payload.activeSession
  if (!session) return payload

  const next = { ...payload, activeSession: null as LiftAssumptionActiveSession | null }
  const elapsed = now - session.openedAt
  if (elapsed < LIFT_OPEN_MIN_MS) return next

  const key = dailyOpenKey(session.dayId, session.localDate)
  const count = (next.dailyOpens[key] ?? 0) + 1
  next.dailyOpens = { ...next.dailyOpens, [key]: count }

  if (count >= LIFT_ASSUMPTION_OPEN_COUNT) {
    const existing = next.pending
    const samePending =
      existing &&
      !existing.dismissed &&
      existing.dayId === session.dayId &&
      existing.localDate === session.localDate
    if (!samePending) {
      next.pending = {
        dayId: session.dayId,
        localDate: session.localDate,
        assumedAt: now,
        dismissed: false,
      }
    }
  }

  return next
}

export function openLiftSession(
  payload: LiftAssumptionPayload,
  dayId: string,
  localDate: string,
  now: number,
): LiftAssumptionPayload {
  let next = payload
  if (payload.activeSession) {
    next = finalizeActiveSession(payload, now)
  }
  return {
    ...next,
    activeSession: { dayId, localDate, openedAt: now },
  }
}

export function closeLiftSession(
  payload: LiftAssumptionPayload,
  dayId: string,
  localDate: string,
  now: number,
): LiftAssumptionPayload {
  const session = payload.activeSession
  if (!session || session.dayId !== dayId || session.localDate !== localDate) {
    return payload
  }
  return finalizeActiveSession(payload, now)
}

export function dismissLiftAssumption(
  payload: LiftAssumptionPayload,
  dayId: string,
  localDate: string,
): LiftAssumptionPayload {
  const pending = payload.pending
  if (!pending || pending.dayId !== dayId || pending.localDate !== localDate) {
    return payload
  }
  return {
    ...payload,
    pending: { ...pending, dismissed: true },
  }
}

export function clearLiftAssumption(
  payload: LiftAssumptionPayload,
  dayId: string,
  localDate: string,
): LiftAssumptionPayload {
  const pending = payload.pending
  if (!pending || pending.dayId !== dayId || pending.localDate !== localDate) {
    return payload
  }
  return { ...payload, pending: null }
}

export { hasLiftHistoryForDayOnDate } from '../src/features/lift/liftHistory'

export function resolveLiftAssumptionPrompt(
  assumptionPayload: LiftAssumptionPayload,
  liftPayload: {
    days?: { id: string; name: string }[]
    workouts?: { id: string; dayId: string }[]
    history?: { workoutId: string; date: string }[]
  },
  now: number,
): LiftAssumptionPrompt | null {
  const pending = assumptionPayload.pending
  if (!pending || pending.dismissed) return null
  if (now - pending.assumedAt < LIFT_ASSUMPTION_SUBMIT_GRACE_MS) return null
  if (hasLiftHistoryForDayOnDate(liftPayload, pending.dayId, pending.localDate)) return null

  const dayName = liftPayload.days?.find((d) => d.id === pending.dayId)?.name ?? 'workout'
  return {
    dayId: pending.dayId,
    localDate: pending.localDate,
    dayName,
  }
}
