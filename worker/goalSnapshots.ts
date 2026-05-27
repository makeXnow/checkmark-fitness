export type MacroDayGoalsSnapshot = {
  calorieGoal: number
  proteinPctGoal: number
  proteinGramsGoal?: number
  proteinTrackMode?: 'percent' | 'grams'
}

export type MacroGoalHistoryEntry = MacroDayGoalsSnapshot & {
  effectiveDate: string
}

export type MacroGoalsStored = {
  current: Record<string, unknown>
  snapshotsByDay: Record<string, MacroDayGoalsSnapshot>
  goalHistory: MacroGoalHistoryEntry[]
}

export type HabitsGoalsStored = {
  current: Record<string, unknown>
  snapshotsByWeek: Record<string, Record<string, unknown>>
  goalHistory: { effectiveWeekStart: string; goals: Record<string, unknown> }[]
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v)
}

const HABIT_GOAL_KEYS = ['water', 'diet', 'cardio', 'lift'] as const

function isHabitsGoalsShape(g: Record<string, unknown>): boolean {
  return HABIT_GOAL_KEYS.every((k) => isRecord(g[k]))
}

function isMacroGoalsShape(g: Record<string, unknown>): boolean {
  return typeof g.calorieGoal === 'number' && typeof g.proteinPctGoal === 'number'
}

/** Unwrap accidental nested `{ current: { current: … } }` from double-serialized saves. */
export function unwrapHabitsGoalsLeaf(raw: unknown): Record<string, unknown> | null {
  if (!isRecord(raw)) return null
  let g: Record<string, unknown> = raw
  let depth = 0
  while (isRecord(g.current) && !isHabitsGoalsShape(g) && depth < 16) {
    g = g.current
    depth++
  }
  return isHabitsGoalsShape(g) ? g : null
}

export function unwrapMacroGoalsLeaf(raw: unknown): Record<string, unknown> | null {
  if (!isRecord(raw)) return null
  let g: Record<string, unknown> = raw
  let depth = 0
  while (isRecord(g.current) && !isMacroGoalsShape(g) && depth < 16) {
    g = g.current
    depth++
  }
  return isMacroGoalsShape(g) ? g : null
}

export function parseMacroGoalsStored(raw: unknown, fallback: Record<string, unknown> = {}): MacroGoalsStored {
  if (!isRecord(raw)) {
    return { current: { ...fallback }, snapshotsByDay: {}, goalHistory: [] }
  }
  const snapshotsByDay = (raw.snapshotsByDay as Record<string, MacroDayGoalsSnapshot>) || {}
  const goalHistory = (raw.goalHistory as MacroGoalHistoryEntry[]) || []
  const leaf = unwrapMacroGoalsLeaf(raw.current) ?? unwrapMacroGoalsLeaf(raw) ?? { ...fallback }
  return { current: leaf, snapshotsByDay, goalHistory }
}

export function serializeMacroGoalsStored(stored: MacroGoalsStored): Record<string, unknown> {
  return {
    current: stored.current,
    snapshotsByDay: stored.snapshotsByDay,
    goalHistory: stored.goalHistory,
  }
}

export function parseHabitsGoalsStored(raw: unknown, fallback: Record<string, unknown>): HabitsGoalsStored {
  if (!isRecord(raw)) {
    return { current: { ...fallback }, snapshotsByWeek: {}, goalHistory: [] }
  }
  const snapshotsByWeek = (raw.snapshotsByWeek as Record<string, Record<string, unknown>>) || {}
  const goalHistory = (raw.goalHistory as HabitsGoalsStored['goalHistory']) || []
  const leaf = unwrapHabitsGoalsLeaf(raw.current) ?? unwrapHabitsGoalsLeaf(raw) ?? { ...fallback }
  return { current: leaf, snapshotsByWeek, goalHistory }
}

export function serializeHabitsGoalsStored(stored: HabitsGoalsStored): Record<string, unknown> {
  return {
    current: stored.current,
    snapshotsByWeek: stored.snapshotsByWeek,
    goalHistory: stored.goalHistory,
  }
}
