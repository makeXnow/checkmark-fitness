import type { LiftHistoryEntry, LiftPayload, LiftWorkout } from '../../types/domain'
import { getLatestHistoryEntryForWorkout } from './liftHistory'
import { calculateOptimizedPlateOrder } from './optimizedPlates'

export function getOptimalPlates(targetWeight: number, barWeight: number, availablePlates: number[]) {
  const bw = barWeight || 0
  let tw = typeof targetWeight === 'number' && !isNaN(targetWeight) ? targetWeight : bw
  if (tw <= bw) return { plates: [] as { weight: number; count: number }[], actualWeight: bw }
  const sortedPlates = [...(availablePlates || [])].sort((a, b) => b - a)
  const smallestPlate = sortedPlates.length > 0 ? sortedPlates[sortedPlates.length - 1] : 1
  const rawPerSide = (tw - bw) / 2
  const achievablePerSide = Math.round(rawPerSide / smallestPlate) * smallestPlate
  const actualWeight = bw + 2 * achievablePerSide
  let remaining = achievablePerSide
  const plates: { weight: number; count: number }[] = []
  for (const p of sortedPlates) {
    if (remaining >= p) {
      const count = Math.floor((remaining + 0.001) / p)
      plates.push({ weight: p, count })
      remaining -= count * p
    }
  }
  return { plates, actualWeight }
}

export function formatWeightStr(w: number) {
  if (w % 1 !== 0) {
    const intPart = Math.floor(w)
    return intPart > 0 ? `${intPart}½` : `½`
  }
  return w.toString()
}

/** Collapse only consecutive identical plates (for optimized loading order display). */
export function groupAdjacentPlates(ordered: number[]): { weight: number; count: number }[] {
  if (ordered.length === 0) return []
  const result: { weight: number; count: number }[] = []
  let i = 0
  while (i < ordered.length) {
    let count = 1
    while (i + count < ordered.length && ordered[i + count] === ordered[i]) count++
    result.push({ weight: ordered[i], count })
    i += count
  }
  return result
}

function greedyOrderedPlates(
  targetWeight: number,
  barWeight: number,
  availablePlates: number[],
): number[] {
  const { plates } = getOptimalPlates(targetWeight, barWeight, availablePlates)
  const ordered: number[] = []
  for (const { weight, count } of plates) {
    for (let i = 0; i < count; i++) ordered.push(weight)
  }
  return ordered
}

export type WorkoutSetTarget = {
  targetWeight: number
  reps: number
  isWarmup: boolean
}

/** Working weight for this session: latest log's next target, else plan mainWeight (plate-rounded). */
export function getSessionMainWeight(
  workout: LiftWorkout,
  history: LiftHistoryEntry[] | undefined,
  availablePlates: number[],
): number {
  const latest = getLatestHistoryEntryForWorkout(history, workout.id)
  const raw =
    latest?.newWeight !== undefined && Number.isFinite(latest.newWeight)
      ? latest.newWeight
      : workout.mainWeight
  return getOptimalPlates(raw, workout.barWeight, availablePlates).actualWeight
}

export function workoutWithSessionWeight(
  workout: LiftWorkout,
  history: LiftHistoryEntry[] | undefined,
  availablePlates: number[],
): LiftWorkout {
  const mainWeight = getSessionMainWeight(workout, history, availablePlates)
  return mainWeight === workout.mainWeight ? workout : { ...workout, mainWeight }
}

export function collectWorkoutSetTargets(workout: LiftWorkout): WorkoutSetTarget[] {
  const targets: WorkoutSetTarget[] = []

  if (workout.hasWarmup) {
    for (const wu of workout.warmupSets || []) {
      targets.push({
        targetWeight: workout.mainWeight * (wu.percentage / 100),
        reps: wu.reps,
        isWarmup: true,
      })
    }
  }

  for (let i = 0; i < (workout.sets || 1); i++) {
    targets.push({ targetWeight: workout.mainWeight, reps: workout.reps, isWarmup: false })
  }

  return targets
}

/** Optimize plate order across all workouts on a day (plan order). */
export function buildDayOptimizedPlateOrders(
  workouts: LiftWorkout[],
  availablePlates: number[],
): Map<string, number[][]> {
  const flatTargets: { targetWeight: number; barWeight: number }[] = []
  const segments: { workoutId: string; count: number }[] = []

  for (const workout of workouts) {
    const sets = collectWorkoutSetTargets(workout)
    if (sets.length === 0) continue
    segments.push({ workoutId: workout.id, count: sets.length })
    for (const s of sets) {
      flatTargets.push({ targetWeight: s.targetWeight, barWeight: workout.barWeight })
    }
  }

  const result = new Map<string, number[][]>()
  if (flatTargets.length === 0) return result

  let ordered = calculateOptimizedPlateOrder(
    flatTargets.map((t) => t.targetWeight),
    flatTargets.map((t) => t.barWeight),
    availablePlates,
  )

  const needsFallback = flatTargets.some((t, i) => {
    const optimal = getOptimalPlates(t.targetWeight, t.barWeight, availablePlates)
    const needsPlates = optimal.actualWeight > (t.barWeight || 0)
    return needsPlates && (ordered[i]?.length ?? 0) === 0
  })
  if (needsFallback) {
    ordered = flatTargets.map((t) =>
      greedyOrderedPlates(t.targetWeight, t.barWeight, availablePlates),
    )
  }

  let offset = 0
  for (const seg of segments) {
    result.set(seg.workoutId, ordered.slice(offset, offset + seg.count))
    offset += seg.count
  }
  return result
}

function buildRawSets(
  workout: LiftWorkout,
  availablePlates: number[],
  optimizedPlateOrder: boolean,
  precomputedOrderedPlates?: number[][],
): Array<{
  reps: number
  actualWeight: number
  plates: { weight: number; count: number }[]
  isWarmup: boolean
}> {
  const targets = collectWorkoutSetTargets(workout)
  if (targets.length === 0) return []

  let orderedBySet: number[][] | null = precomputedOrderedPlates ?? null
  if (optimizedPlateOrder && !orderedBySet) {
    orderedBySet = calculateOptimizedPlateOrder(
      targets.map((t) => t.targetWeight),
      workout.barWeight,
      availablePlates,
    )
    const needsFallback = targets.some((t, i) => {
      const optimal = getOptimalPlates(t.targetWeight, workout.barWeight, availablePlates)
      const needsPlates = optimal.actualWeight > (workout.barWeight || 0)
      return needsPlates && (orderedBySet?.[i]?.length ?? 0) === 0
    })
    if (needsFallback) {
      orderedBySet = targets.map((t) =>
        greedyOrderedPlates(t.targetWeight, workout.barWeight, availablePlates),
      )
    }
  }

  return targets.map((t, idx) => {
    const optimal = getOptimalPlates(t.targetWeight, workout.barWeight, availablePlates)
    const plates = optimizedPlateOrder
      ? groupAdjacentPlates(orderedBySet?.[idx] ?? [])
      : optimal.plates
    return { reps: t.reps, actualWeight: optimal.actualWeight, plates, isWarmup: t.isWarmup }
  })
}

export function buildGroupedSets(
  workout: LiftWorkout,
  availablePlates: number[],
  startSetNum = 1,
  optimizedPlateOrder = false,
  precomputedOrderedPlates?: number[][],
): { groupedSets: Array<{
  reps: number
  actualWeight: number
  plates: { weight: number; count: number }[]
  isWarmup: boolean
  startNum: number
  endNum: number
}>; nextSetNum: number } {
  const rawSets = buildRawSets(
    workout,
    availablePlates,
    optimizedPlateOrder,
    precomputedOrderedPlates,
  )

  const groupedSets: Array<{
    reps: number
    actualWeight: number
    plates: { weight: number; count: number }[]
    isWarmup: boolean
    startNum: number
    endNum: number
  }> = []
  let nextStartNum = startSetNum

  if (rawSets.length > 0) {
    let currentGroup = { ...rawSets[0], startNum: nextStartNum, endNum: nextStartNum }
    for (let i = 1; i < rawSets.length; i++) {
      nextStartNum++
      const s = rawSets[i]
      if (
        s.reps === currentGroup.reps &&
        s.actualWeight === currentGroup.actualWeight &&
        s.isWarmup === currentGroup.isWarmup
      ) {
        currentGroup.endNum = nextStartNum
      } else {
        groupedSets.push(currentGroup)
        currentGroup = { ...s, startNum: nextStartNum, endNum: nextStartNum }
      }
    }
    groupedSets.push(currentGroup)
    nextStartNum++
  }

  return { groupedSets, nextSetNum: nextStartNum }
}

/** Multiplier applied as: nextWeight = max(0, current + increment * multiplier). */
export function parseStatusMultiplier(multiplier: number | string | undefined): number {
  if (multiplier === undefined || multiplier === '') return 1
  const n = typeof multiplier === 'number' ? multiplier : parseFloat(String(multiplier))
  return Number.isFinite(n) ? n : 1
}

export function isNonPositiveProgressionMultiplier(multiplier: number): boolean {
  return multiplier <= 0
}

/** Raw amount added to mainWeight on submit: increment × status multiplier. */
export function getProgressDelta(increment: number, multiplier: number): number {
  return (increment || 0) * multiplier
}

export function formatProgressDelta(delta: number): string {
  if (!Number.isFinite(delta) || delta === 0) return '0'
  const rounded = Math.round(delta * 10) / 10
  const abs = Math.abs(rounded)
  const body =
    Math.abs(abs - Math.round(abs)) < 1e-9 ? String(Math.round(abs)) : abs.toFixed(1).replace(/\.0$/, '')
  return rounded > 0 ? `+${body}` : `-${body}`
}

/** Next session lift weight (plate-rounded), not internal mainWeight. */
export function getNextLiftWeight(
  workout: LiftWorkout,
  multiplier: number,
  availablePlates: number[],
): number {
  const nextMain = Math.max(0, workout.mainWeight + getProgressDelta(workout.increment, multiplier))
  return getOptimalPlates(nextMain, workout.barWeight, availablePlates).actualWeight
}

export function formatLogDate(dateObj: Date) {
  const weekday = dateObj.toLocaleDateString(undefined, { weekday: 'short' })
  const month = dateObj.toLocaleDateString(undefined, { month: 'short' })
  const dayNum = dateObj.toLocaleDateString(undefined, { day: 'numeric' })
  const year = dateObj.toLocaleDateString(undefined, { year: 'numeric' })
  return `${weekday} · ${month} ${dayNum} · ${year}`
}

export function groupHistory(
  history: LiftHistoryEntry[],
  days: LiftPayload['days'],
  workouts: LiftWorkout[],
  options?: { dateOnly?: boolean },
) {
  const sortedHistory = [...history].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
  const groups: Record<string, { dayName: string; dateStr: string; entries: LiftHistoryEntry[] }> = {}
  for (const entry of sortedHistory) {
    if (!entry?.date) continue
    const dateObj = new Date(entry.date)
    const dateStr = formatLogDate(dateObj)
    const w = workouts.find((wk) => wk.id === entry.workoutId)
    let dayName = 'Workout Session'
    if (w) {
      const d = days.find((day) => day.id === w.dayId)
      if (d) dayName = d.name
    }
    const key = options?.dateOnly ? dateStr : `${dayName}|${dateStr}`
    if (!groups[key]) groups[key] = { dayName, dateStr, entries: [] }
    groups[key].entries.push(entry)
  }
  return Object.values(groups)
}

/** After logging, move to the plan day after the day that contained the latest history entry (LiftCalc behavior). */
export function nextDayIndexFromHistory(
  days: LiftPayload['days'],
  workouts: LiftWorkout[],
  history: LiftHistoryEntry[],
): number {
  const sortedDays = [...days].sort((a, b) => (a.order || 0) - (b.order || 0))
  if (sortedDays.length === 0) return 0
  if (!history.length) return 0
  const sortedHistory = [...history].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
  const latest = sortedHistory[0]
  const w = workouts.find((x) => x.id === latest.workoutId)
  if (!w) return 0
  const dayIdx = sortedDays.findIndex((d) => d.id === w.dayId)
  if (dayIdx === -1) return 0
  return (dayIdx + 1) % sortedDays.length
}
