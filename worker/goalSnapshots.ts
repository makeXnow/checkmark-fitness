export type MacroDayGoalsSnapshot = {
  calorieGoal: number
  proteinPctGoal: number
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

export function parseMacroGoalsStored(raw: unknown): MacroGoalsStored {
  if (!isRecord(raw)) {
    return { current: {}, snapshotsByDay: {}, goalHistory: [] }
  }
  if ('current' in raw && isRecord(raw.current)) {
    return {
      current: raw.current,
      snapshotsByDay: (raw.snapshotsByDay as Record<string, MacroDayGoalsSnapshot>) || {},
      goalHistory: (raw.goalHistory as MacroGoalHistoryEntry[]) || [],
    }
  }
  return {
    current: raw,
    snapshotsByDay: (raw.snapshotsByDay as Record<string, MacroDayGoalsSnapshot>) || {},
    goalHistory: (raw.goalHistory as MacroGoalHistoryEntry[]) || [],
  }
}

export function serializeMacroGoalsStored(stored: MacroGoalsStored): Record<string, unknown> {
  return {
    current: stored.current,
    snapshotsByDay: stored.snapshotsByDay,
    goalHistory: stored.goalHistory,
  }
}

export function parseHabitsGoalsStored(raw: unknown, normalizedCurrent: Record<string, unknown>): HabitsGoalsStored {
  if (!isRecord(raw)) {
    return { current: normalizedCurrent, snapshotsByWeek: {}, goalHistory: [] }
  }
  if ('current' in raw && isRecord(raw.current)) {
    return {
      current: normalizedCurrent,
      snapshotsByWeek: (raw.snapshotsByWeek as Record<string, Record<string, unknown>>) || {},
      goalHistory: (raw.goalHistory as HabitsGoalsStored['goalHistory']) || [],
    }
  }
  return {
    current: normalizedCurrent,
    snapshotsByWeek: (raw.snapshotsByWeek as Record<string, Record<string, unknown>>) || {},
    goalHistory: (raw.goalHistory as HabitsGoalsStored['goalHistory']) || [],
  }
}

export function serializeHabitsGoalsStored(stored: HabitsGoalsStored): Record<string, unknown> {
  return {
    current: stored.current,
    snapshotsByWeek: stored.snapshotsByWeek,
    goalHistory: stored.goalHistory,
  }
}
