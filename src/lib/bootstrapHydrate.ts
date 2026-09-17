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
  /** Which bundles were normalized and should be written back (via the App save queues). */
  persist: { macro: boolean; habits: boolean; lift: boolean }
}

/** Apply client-side normalization / snapshot cement; caller decides when to PUT. */
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

  const persistMacro = logsChanged || foodsChanged || macroCement.changed
  const persistHabits = habitsCement.changed
  const persistLift = liftHistoryChanged

  if (persistMacro || persistHabits) {
    data.macro.logs = logs
    data.macro.goals = macroBundle.current
    data.macro.goalsSnapshotsByDay = macroBundle.snapshotsByDay
    data.macro.goalsHistory = macroBundle.goalHistory
    data.habits.goals = cementedHabitsBundle.current
    data.habits.goalsSnapshotsByWeek = cementedHabitsBundle.snapshotsByWeek
    data.habits.goalsHistory = cementedHabitsBundle.goalHistory
  }

  return {
    data,
    persist: { macro: persistMacro, habits: persistHabits, lift: persistLift },
  }
}
