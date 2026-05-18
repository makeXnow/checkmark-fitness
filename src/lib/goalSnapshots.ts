import { localDateISO } from './localDate'
import type { HabitsGoals, MacroDayGoalsSnapshot, MacroGoalHistoryEntry, MacroGoals } from '../types/domain'

export type MacroGoalsBundleData = {
  current: MacroGoals
  snapshotsByDay: Record<string, MacroDayGoalsSnapshot>
  goalHistory: MacroGoalHistoryEntry[]
}

export type HabitsGoalsBundleData = {
  current: HabitsGoals
  snapshotsByWeek: Record<string, HabitsGoals>
  goalHistory: HabitsGoalHistoryEntry[]
}

export type HabitsGoalHistoryEntry = {
  effectiveWeekStart: string
  goals: HabitsGoals
}

function parseISODateOnly(iso: string): Date {
  const [y, m, d] = iso.split('-').map((x) => parseInt(x, 10))
  return new Date(y, m - 1, d, 12, 0, 0)
}

function addDaysISO(iso: string, delta: number): string {
  const d = parseISODateOnly(iso)
  d.setDate(d.getDate() + delta)
  return localDateISO(d)
}

function compareISO(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0
}

export function macroTargetsFromGoals(goals: MacroGoals): MacroDayGoalsSnapshot {
  return { calorieGoal: goals.calorieGoal, proteinPctGoal: goals.proteinPctGoal }
}

export function macroTargetsChanged(a: MacroDayGoalsSnapshot, b: MacroDayGoalsSnapshot): boolean {
  return a.calorieGoal !== b.calorieGoal || a.proteinPctGoal !== b.proteinPctGoal
}

function latestMacroHistoryOnOrBefore(
  date: string,
  history: MacroGoalHistoryEntry[],
): MacroDayGoalsSnapshot | null {
  let best: MacroGoalHistoryEntry | null = null
  for (const entry of history) {
    if (compareISO(entry.effectiveDate, date) <= 0) {
      if (!best || compareISO(entry.effectiveDate, best.effectiveDate) > 0) best = entry
    }
  }
  return best ? { calorieGoal: best.calorieGoal, proteinPctGoal: best.proteinPctGoal } : null
}

/** Targets for a calendar day: today uses live goals; past uses cemented snapshot or history. */
export function resolveMacroDayTargets(
  date: string,
  bundle: MacroGoalsBundleData,
  todayISO: string = localDateISO(new Date()),
): MacroDayGoalsSnapshot {
  if (date >= todayISO) return macroTargetsFromGoals(bundle.current)
  const cemented = bundle.snapshotsByDay[date]
  if (cemented) return cemented
  const fromHistory = latestMacroHistoryOnOrBefore(date, bundle.goalHistory)
  if (fromHistory) return fromHistory
  return macroTargetsFromGoals(bundle.current)
}

function earliestDateFromKeys(keys: string[]): string | null {
  const valid = keys.filter((k) => /^\d{4}-\d{2}-\d{2}$/.test(k)).sort()
  return valid[0] ?? null
}

/** Fill missing daily snapshots through yesterday using history (lazy backfill). */
export function cementMacroSnapshots(
  bundle: MacroGoalsBundleData,
  logDates: string[],
  todayISO: string = localDateISO(new Date()),
): { bundle: MacroGoalsBundleData; changed: boolean } {
  const yesterday = addDaysISO(todayISO, -1)
  if (compareISO(yesterday, '1970-01-01') < 0) return { bundle, changed: false }

  const snapshotDates = Object.keys(bundle.snapshotsByDay)
  const startCandidates = [
    earliestDateFromKeys(logDates),
    earliestDateFromKeys(snapshotDates),
    earliestDateFromKeys(bundle.goalHistory.map((e) => e.effectiveDate)),
  ].filter((d): d is string => d != null)

  if (startCandidates.length === 0) return { bundle, changed: false }

  const start = startCandidates.sort()[0]!
  const snapshots = { ...bundle.snapshotsByDay }
  let changed = false

  for (let d = start; compareISO(d, yesterday) <= 0; d = addDaysISO(d, 1)) {
    if (snapshots[d]) continue
    const resolved = latestMacroHistoryOnOrBefore(d, bundle.goalHistory) ?? macroTargetsFromGoals(bundle.current)
    snapshots[d] = resolved
    changed = true
  }

  if (!changed) return { bundle, changed: false }
  return { bundle: { ...bundle, snapshotsByDay: snapshots }, changed: true }
}

export function recordMacroGoalChange(
  bundle: MacroGoalsBundleData,
  nextGoals: MacroGoals,
  todayISO: string = localDateISO(new Date()),
): MacroGoalsBundleData {
  const prevTargets = macroTargetsFromGoals(bundle.current)
  const nextTargets = macroTargetsFromGoals(nextGoals)
  if (!macroTargetsChanged(prevTargets, nextTargets)) {
    return { ...bundle, current: nextGoals }
  }

  const history = [...bundle.goalHistory]
  const existingIdx = history.findIndex((e) => e.effectiveDate === todayISO)
  const entry: MacroGoalHistoryEntry = {
    effectiveDate: todayISO,
    calorieGoal: nextTargets.calorieGoal,
    proteinPctGoal: nextTargets.proteinPctGoal,
  }
  if (existingIdx >= 0) history[existingIdx] = entry
  else history.push(entry)
  history.sort((a, b) => compareISO(a.effectiveDate, b.effectiveDate))

  return { ...bundle, current: nextGoals, goalHistory: history }
}

export function getWeekStartISO(date: Date | string, firstDayOfWeek: number): string {
  const d = typeof date === 'string' ? parseISODateOnly(date) : new Date(date)
  d.setHours(12, 0, 0, 0)
  const dayOfWeek = d.getDay()
  const diff =
    dayOfWeek >= firstDayOfWeek ? dayOfWeek - firstDayOfWeek : 7 - (firstDayOfWeek - dayOfWeek)
  d.setDate(d.getDate() - diff)
  return localDateISO(d)
}

function habitsGoalsEqual(a: HabitsGoals, b: HabitsGoals): boolean {
  const keys = ['water', 'diet', 'cardio', 'lift'] as const
  for (const key of keys) {
    const ga = a[key]
    const gb = b[key]
    if (ga.min !== gb.min || ga.max !== gb.max) return false
    if (key === 'water' && ga.dailyTarget !== gb.dailyTarget) return false
  }
  return true
}

function latestHabitsHistoryOnOrBefore(
  weekStart: string,
  history: HabitsGoalHistoryEntry[],
): HabitsGoals | null {
  let best: HabitsGoalHistoryEntry | null = null
  for (const entry of history) {
    if (compareISO(entry.effectiveWeekStart, weekStart) <= 0) {
      if (!best || compareISO(entry.effectiveWeekStart, best.effectiveWeekStart) > 0) best = entry
    }
  }
  return best?.goals ?? null
}

/** Goals for a week: current week uses live goals; past weeks use cemented snapshot or history. */
export function resolveHabitsWeekGoals(
  weekStart: string,
  bundle: HabitsGoalsBundleData,
  firstDayOfWeek: number,
  todayISO: string = localDateISO(new Date()),
): HabitsGoals {
  const currentWeekStart = getWeekStartISO(todayISO, firstDayOfWeek)
  if (weekStart >= currentWeekStart) return bundle.current
  const cemented = bundle.snapshotsByWeek[weekStart]
  if (cemented) return cemented
  const fromHistory = latestHabitsHistoryOnOrBefore(weekStart, bundle.goalHistory)
  if (fromHistory) return fromHistory
  return bundle.current
}

function listPastWeekStarts(
  logDates: string[],
  currentDate: Date,
  firstDayOfWeek: number,
  todayISO: string,
): string[] {
  const earliest = earliestDateFromKeys(logDates)
  if (!earliest) return []

  const currentWeekStart = getWeekStartISO(currentDate, firstDayOfWeek)
  const starts: string[] = []
  let iter = addDaysISO(currentWeekStart, -7)

  const earliestWeekStart = getWeekStartISO(earliest, firstDayOfWeek)
  while (compareISO(iter, earliestWeekStart) >= 0 && compareISO(iter, getWeekStartISO(todayISO, firstDayOfWeek)) < 0) {
    starts.push(iter)
    iter = addDaysISO(iter, -7)
  }
  return starts
}

/** Fill missing weekly snapshots for completed weeks (lazy backfill). */
export function cementHabitsSnapshots(
  bundle: HabitsGoalsBundleData,
  logDates: string[],
  currentDate: Date,
  firstDayOfWeek: number,
  todayISO: string = localDateISO(new Date()),
): { bundle: HabitsGoalsBundleData; changed: boolean } {
  const currentWeekStart = getWeekStartISO(todayISO, firstDayOfWeek)
  const snapshots = { ...bundle.snapshotsByWeek }
  let changed = false

  const weekStarts = new Set([
    ...listPastWeekStarts(logDates, currentDate, firstDayOfWeek, todayISO),
    ...Object.keys(snapshots).filter((w) => compareISO(w, currentWeekStart) < 0),
  ])

  for (const weekStart of weekStarts) {
    if (compareISO(weekStart, currentWeekStart) >= 0) continue
    if (snapshots[weekStart]) continue
    const resolved =
      latestHabitsHistoryOnOrBefore(weekStart, bundle.goalHistory) ?? structuredClone(bundle.current)
    snapshots[weekStart] = resolved
    changed = true
  }

  if (!changed) return { bundle, changed: false }
  return { bundle: { ...bundle, snapshotsByWeek: snapshots }, changed: true }
}

export function recordHabitsGoalChange(
  bundle: HabitsGoalsBundleData,
  nextGoals: HabitsGoals,
  firstDayOfWeek: number,
  todayISO: string = localDateISO(new Date()),
): HabitsGoalsBundleData {
  if (habitsGoalsEqual(bundle.current, nextGoals)) {
    return { ...bundle, current: nextGoals }
  }

  const weekStart = getWeekStartISO(todayISO, firstDayOfWeek)
  const history = [...bundle.goalHistory]
  const existingIdx = history.findIndex((e) => e.effectiveWeekStart === weekStart)
  const entry: HabitsGoalHistoryEntry = { effectiveWeekStart: weekStart, goals: structuredClone(nextGoals) }
  if (existingIdx >= 0) history[existingIdx] = entry
  else history.push(entry)
  history.sort((a, b) => compareISO(a.effectiveWeekStart, b.effectiveWeekStart))

  return { ...bundle, current: nextGoals, goalHistory: history }
}
