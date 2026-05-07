import type { LiftHistoryEntry, LiftPayload, LiftWorkout } from '../../types/domain'

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

export function buildGroupedSets(
  workout: LiftWorkout,
  availablePlates: number[],
  startSetNum = 1,
): { groupedSets: Array<{
  reps: number
  actualWeight: number
  plates: { weight: number; count: number }[]
  isWarmup: boolean
  startNum: number
  endNum: number
}>; nextSetNum: number } {
  const rawSets: Array<{
    reps: number
    actualWeight: number
    plates: { weight: number; count: number }[]
    isWarmup: boolean
  }> = []

  if (workout.hasWarmup) {
    for (const wu of workout.warmupSets || []) {
      const targetWeight = workout.mainWeight * (wu.percentage / 100)
      const optimal = getOptimalPlates(targetWeight, workout.barWeight, availablePlates)
      rawSets.push({ reps: wu.reps, actualWeight: optimal.actualWeight, plates: optimal.plates, isWarmup: true })
    }
  }

  const mainOptimal = getOptimalPlates(workout.mainWeight, workout.barWeight, availablePlates)
  for (let i = 0; i < (workout.sets || 1); i++) {
    rawSets.push({
      reps: workout.reps,
      actualWeight: mainOptimal.actualWeight,
      plates: mainOptimal.plates,
      isWarmup: false,
    })
  }

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

export function formatLogDate(dateObj: Date) {
  const weekday = dateObj.toLocaleDateString(undefined, { weekday: 'short' })
  const month = dateObj.toLocaleDateString(undefined, { month: 'short' })
  const dayNum = dateObj.toLocaleDateString(undefined, { day: 'numeric' })
  const year = dateObj.toLocaleDateString(undefined, { year: 'numeric' })
  return `${weekday} · ${month} ${dayNum} · ${year}`
}

export function groupHistory(history: LiftHistoryEntry[], days: LiftPayload['days'], workouts: LiftWorkout[]) {
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
    const key = `${dayName}|${dateStr}`
    if (!groups[key]) groups[key] = { dayName, dateStr, entries: [] }
    groups[key].entries.push(entry)
  }
  return Object.values(groups)
}
