import { putHabits, putLift, putMacro } from '../core/api'
import {
  normalizeLiftHistoryOnLoad,
  reconcileWorkoutMainWeightsFromHistory,
} from '../features/lift/liftHistory'
import { normalizeMacroGoals } from '../features/macro/macroCalculator'
import {
  normalizeMacroCustomFoodsOnLoad,
  normalizeMacroLogsOnLoad,
} from '../features/macro/macroLib'
import {
  cementHabitsSnapshots,
  cementMacroSnapshots,
  type HabitsGoalsBundleData,
  type MacroGoalsBundleData,
} from './goalSnapshots'
import { localDateISO } from './localDate'
import type { BootstrapResponse, HabitsGoals, LiftPayload } from '../types/domain'

export type BootstrapHydrateResult = {
  data: BootstrapResponse
  /** When set, persist normalized state to the server without blocking UI. */
  persist: (() => Promise<void>) | null
}

/** Apply client-side normalization / snapshot cement; optionally queue server PUTs. */
export function hydrateBootstrap(raw: BootstrapResponse): BootstrapHydrateResult {
  const data = raw
  const todayISO = localDateISO(new Date())
  const firstDayOfWeek = data.habits.appSettings?.firstDayOfWeek ?? 0

  const macroCurrent = normalizeMacroGoals(data.macro.goals)
  let macroBundle: MacroGoalsBundleData = {
    current: macroCurrent,
    snapshotsByDay: data.macro.goalsSnapshotsByDay ?? {},
    goalHistory: data.macro.goalsHistory ?? [],
  }
  const macroCement = cementMacroSnapshots(macroBundle, Object.keys(data.macro.logs || {}), todayISO)
  if (macroCement.changed) macroBundle = macroCement.bundle

  const habitsBundle: HabitsGoalsBundleData = {
    current: data.habits.goals as HabitsGoals,
    snapshotsByWeek: data.habits.goalsSnapshotsByWeek ?? {},
    goalHistory: data.habits.goalsHistory ?? [],
  }
  const habitsCement = cementHabitsSnapshots(
    habitsBundle,
    Object.keys(data.habits.logs || {}),
    new Date(),
    firstDayOfWeek,
    todayISO,
  )
  const cementedHabitsBundle = habitsCement.changed ? habitsCement.bundle : habitsBundle

  const customFoodsNorm = normalizeMacroCustomFoodsOnLoad(data.macro.customFoods || [])
  const logs = normalizeMacroLogsOnLoad(data.macro.logs || {}, customFoodsNorm.foods)
  const logsChanged = logs !== data.macro.logs
  const foodsChanged = customFoodsNorm.changed
  if (foodsChanged) data.macro.customFoods = customFoodsNorm.foods

  const liftPayload = data.lift.payload as LiftPayload
  const liftHistoryNorm = normalizeLiftHistoryOnLoad(liftPayload.history)
  const liftReconcile = reconcileWorkoutMainWeightsFromHistory(
    liftPayload.workouts,
    liftHistoryNorm.history,
  )
  const liftHistoryChanged = liftHistoryNorm.changed || liftReconcile.changed
  if (liftHistoryChanged) {
    data.lift.payload = {
      ...liftPayload,
      history: liftHistoryNorm.history,
      workouts: liftReconcile.workouts,
    }
  }

  const needsPersist =
    logsChanged || foodsChanged || macroCement.changed || habitsCement.changed || liftHistoryChanged

  if (needsPersist) {
    data.macro.logs = logs
    data.macro.goals = macroBundle.current
    data.macro.goalsSnapshotsByDay = macroBundle.snapshotsByDay
    data.macro.goalsHistory = macroBundle.goalHistory
    data.habits.goals = cementedHabitsBundle.current
    data.habits.goalsSnapshotsByWeek = cementedHabitsBundle.snapshotsByWeek
    data.habits.goalsHistory = cementedHabitsBundle.goalHistory
  }

  const persist = needsPersist
    ? () => {
        const tasks: Promise<unknown>[] = [
          putMacro({
            goals: macroBundle.current,
            goalsSnapshotsByDay: macroBundle.snapshotsByDay,
            goalsHistory: macroBundle.goalHistory,
            customFoods: data.macro.customFoods || [],
            logs,
          }),
          putHabits({
            goals: cementedHabitsBundle.current,
            goalsSnapshotsByWeek: cementedHabitsBundle.snapshotsByWeek,
            goalsHistory: cementedHabitsBundle.goalHistory,
            logs: data.habits.logs,
            appSettings: data.habits.appSettings,
          }),
        ]
        if (liftHistoryChanged) {
          tasks.push(putLift(data.lift.payload as LiftPayload))
        }
        return Promise.all(tasks).then(() => undefined)
      }
    : null

  return { data, persist }
}
