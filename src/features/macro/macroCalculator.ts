import type { MacroGoalMode, MacroGoals, ProteinTrackMode } from '../../types/domain'

export const MACRO_GOAL_MODES: MacroGoalMode[] = ['fast-cut', 'slow-cut', 'maintain', 'bulk']

export const MACRO_GOAL_LABELS: Record<MacroGoalMode, string> = {
  'fast-cut': 'Fast Cut',
  'slow-cut': 'Slow Cut',
  maintain: 'Maintain',
  bulk: 'Bulk',
}

const ACTIVITY_PER_HR = 0.067
const ACTIVITY_BASE = 1.165

const GOAL_MODIFIERS: Record<MacroGoalMode, number> = {
  'fast-cut': -0.25,
  'slow-cut': -0.15,
  maintain: 0,
  bulk: 0.05,
}

export const DEFAULT_MACRO_INPUTS = {
  weightLbs: 180,
  bodyFatPct: 18,
  activeHours: 5,
  goalMode: 'fast-cut' as MacroGoalMode,
}

export type MacroCalcInputs = {
  weightLbs: number
  bodyFatPct: number
  activeHours: number
}

export type MacroCalcResult = {
  calories: number
  proteinPercent: number
}

export function proteinGramsFromPct(calorieGoal: number, proteinPctGoal: number): number {
  if (calorieGoal <= 0 || proteinPctGoal <= 0) return 0
  return Math.round((calorieGoal * proteinPctGoal) / 100 / 4)
}

export function proteinPctFromGrams(calorieGoal: number, proteinGramsGoal: number): number {
  if (calorieGoal <= 0 || proteinGramsGoal <= 0) return 0
  return Math.round((proteinGramsGoal * 4 * 100) / calorieGoal)
}

export function normalizeMacroGoals(raw: Partial<MacroGoals> | null | undefined): MacroGoals {
  const weightLbs =
    typeof raw?.weightLbs === 'number' && raw.weightLbs > 0 ? raw.weightLbs : DEFAULT_MACRO_INPUTS.weightLbs
  const bodyFatPct =
    typeof raw?.bodyFatPct === 'number' && raw.bodyFatPct > 0 ? raw.bodyFatPct : DEFAULT_MACRO_INPUTS.bodyFatPct
  const activeHours =
    typeof raw?.activeHours === 'number' && raw.activeHours >= 0 ? raw.activeHours : DEFAULT_MACRO_INPUTS.activeHours
  const calorieGoal =
    typeof raw?.calorieGoal === 'number' && raw.calorieGoal > 0
      ? raw.calorieGoal
      : getMacrosForGoal(DEFAULT_MACRO_INPUTS.goalMode, { weightLbs, bodyFatPct, activeHours }).calories
  const proteinPctGoal =
    typeof raw?.proteinPctGoal === 'number' && raw.proteinPctGoal > 0
      ? raw.proteinPctGoal
      : getMacrosForGoal(DEFAULT_MACRO_INPUTS.goalMode, { weightLbs, bodyFatPct, activeHours }).proteinPercent

  const inputs = { weightLbs, bodyFatPct, activeHours }
  const detected = matchGoalMode(inputs, calorieGoal, proteinPctGoal)
  let goalMode: MacroGoalMode | null =
    raw?.goalMode && MACRO_GOAL_MODES.includes(raw.goalMode) ? raw.goalMode : null

  if (goalMode) {
    const expected = getMacrosForGoal(goalMode, inputs)
    if (expected.calories !== calorieGoal || expected.proteinPercent !== proteinPctGoal) {
      goalMode = detected
    }
  } else {
    goalMode = detected
  }

  const proteinTrackMode: ProteinTrackMode = raw?.proteinTrackMode === 'grams' ? 'grams' : 'percent'
  const proteinGramsGoal =
    typeof raw?.proteinGramsGoal === 'number' && raw.proteinGramsGoal > 0
      ? Math.round(raw.proteinGramsGoal)
      : proteinGramsFromPct(calorieGoal, proteinPctGoal)

  return {
    calorieGoal,
    proteinPctGoal,
    proteinGramsGoal,
    proteinTrackMode,
    weightLbs,
    bodyFatPct,
    activeHours,
    goalMode,
  }
}

export function inputsValid(weightLbs: number, bodyFatPct: number): boolean {
  return Number.isFinite(weightLbs) && Number.isFinite(bodyFatPct) && weightLbs > 0 && bodyFatPct > 0
}

export function getMacrosForGoal(
  goalName: MacroGoalMode,
  { weightLbs, bodyFatPct, activeHours }: MacroCalcInputs,
): MacroCalcResult {
  const bfPercent = bodyFatPct / 100
  const lbmLbs = weightLbs * (1 - bfPercent)
  const lbmKg = lbmLbs / 2.20462
  const bmr = 370 + 21.6 * lbmKg
  const activityMultiplier = ACTIVITY_BASE + activeHours * ACTIVITY_PER_HR
  const tdee = bmr * activityMultiplier
  const rawTargetCalories = tdee * (1 + GOAL_MODIFIERS[goalName])
  const targetCalories = Math.round(rawTargetCalories / 50) * 50

  let proteinPercent = Math.round((weightLbs * 4) / targetCalories / 0.05) * 0.05
  proteinPercent = Math.min(proteinPercent, 0.5)

  return {
    calories: targetCalories,
    proteinPercent: Math.round(proteinPercent * 100),
  }
}

export function matchGoalMode(
  inputs: MacroCalcInputs,
  calories: number,
  proteinPercent: number,
): MacroGoalMode | null {
  if (!inputsValid(inputs.weightLbs, inputs.bodyFatPct)) return null
  for (const goal of MACRO_GOAL_MODES) {
    const macros = getMacrosForGoal(goal, inputs)
    if (macros.calories === calories && macros.proteinPercent === proteinPercent) {
      return goal
    }
  }
  return null
}
