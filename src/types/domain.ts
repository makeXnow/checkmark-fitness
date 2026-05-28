export type BottomTab = 'habits' | 'macro' | 'lift'

export type LiftSubRoute = 'workout' | 'plan' | 'log'

export type SettingsSection = 'habits' | 'macro' | 'lift'

export interface AppStateRow {
  device_id: string
  selected_tab: BottomTab | string
  settings_open: number
  settings_section: SettingsSection | string
  lift_sub_route: LiftSubRoute | string
  lift_selected_day_id: string | null
  lift_current_day_index: number
  selected_date: string
  updated_at: number
}

export interface HabitGoalConfig {
  min: number
  max: number
  color: string
  icon: string
  label: string
  dailyTarget?: number
}

export interface HabitsGoals {
  water: HabitGoalConfig
  diet: HabitGoalConfig
  cardio: HabitGoalConfig
  lift: HabitGoalConfig
}

export interface DayLog {
  cardio?: boolean
  lift?: boolean
  diet?: boolean
  water?: number
}

export type LiftAssumptionPrompt = {
  dayId: string
  localDate: string
  dayName: string
}

export interface BootstrapResponse {
  appState: AppStateRow
  liftAssumption?: {
    pendingPrompt: LiftAssumptionPrompt | null
  }
  habits: {
    goals: HabitsGoals
    goalsSnapshotsByWeek?: Record<string, HabitsGoals>
    goalsHistory?: { effectiveWeekStart: string; goals: HabitsGoals }[]
    logs: Record<string, DayLog>
    appSettings: { firstDayOfWeek: number }
    updatedAt: number
  }
  macro: {
    goals: MacroGoals
    goalsSnapshotsByDay?: Record<string, MacroDayGoalsSnapshot>
    goalsHistory?: MacroGoalHistoryEntry[]
    customFoods: MacroCustomFood[]
    logs: Record<string, MacroDayItem[]>
    updatedAt: number
  }
  lift: {
    payload: LiftPayload
    updatedAt: number
  }
}

export type FatSecretServingRef = {
  servingId: string
  description: string
  calories: number
  protein: number
  isDefault?: boolean
}

export type FatSecretFoodRef = {
  foodId: string
  name: string
  brandName?: string
  foodType?: string
  servings: FatSecretServingRef[]
}

export type MacroGoalMode = 'fast-cut' | 'slow-cut' | 'maintain' | 'bulk'

export type ProteinTrackMode = 'percent' | 'grams'

export interface MacroGoals {
  calorieGoal: number
  proteinPctGoal: number
  proteinGramsGoal?: number
  proteinTrackMode?: ProteinTrackMode
  weightLbs?: number
  bodyFatPct?: number
  activeHours?: number
  goalMode?: MacroGoalMode | null
}

/** Cemented calorie + protein targets for one calendar day. */
export type MacroDayGoalsSnapshot = {
  calorieGoal: number
  proteinPctGoal: number
  proteinGramsGoal?: number
  proteinTrackMode?: ProteinTrackMode
}

export type MacroGoalHistoryEntry = MacroDayGoalsSnapshot & {
  effectiveDate: string
}

export interface MacroCustomFood {
  id: string
  emoji?: string
  name: string
  baseAmount?: string
  calories: number
  protein: number
  fat: number
  carbs: number
  createdAt?: number
}

/** Snapshot from the parser AI for one food item. */
export type MacroParseSnapshot = {
  emoji?: string
  name: string
  amount: string
  notes?: string
  fatSecretSearch?: string
}

/** Raw macro-estimate AI response before resolveMacroEstimate. */
export type MacroEstimateSnapshot = {
  libraryIndex?: number | null
  fatSecretIndex?: number | null
  servingIndex?: number | null
  multiplier?: number
  /** Short unit label for direct AI estimates (e.g. "can", "cup", "slice"). */
  servingType?: string
  calories?: number
  protein?: number
}

export interface MacroDayItem {
  id: string
  emoji?: string
  name: string
  amount: string
  /** Parser context for macro estimation; not shown in the UI. */
  notes?: string
  calories?: number
  protein?: number
  fat?: number
  carbs?: number
  status?: string
  timestamp?: number
  rawText?: string
  /** Original voice/text input (shared when one utterance splits into multiple items). */
  userInput?: string
  /** Parser classification snapshot for the info panel. */
  parseSnapshot?: MacroParseSnapshot
  /** Macro AI JSON response snapshot for the info panel. */
  macroEstimateSnapshot?: MacroEstimateSnapshot
  /** Set when macros were scaled from the food library. */
  libraryFoodId?: string
  /** AI-assigned unit label for one base portion (e.g. "can", "1 cup", "slice"). */
  servingType?: string
  /** User-editable count multiplier applied to servingType base macros. */
  servingMultiplier?: number
  /** Calories per one servingType unit; used to recalc when servingMultiplier changes. */
  baseCalories?: number
  /** Protein (g) per one servingType unit. */
  baseProtein?: number
  /** FatSecret search query from parser; not shown in UI. */
  fatSecretSearch?: string
  /** Cached FatSecret search snapshot; reused on macro refresh (no re-search). */
  fatSecretResults?: FatSecretFoodRef[]
}

export type LiftWeightUnit = 'lbs' | 'kg'

export interface LiftPayload {
  days: { id: string; name: string; order: number }[]
  workouts: LiftWorkout[]
  statuses: { id: string; name: string; multiplier: number | string }[]
  history: LiftHistoryEntry[]
  availablePlates: number[]
  /** When true, plate order is optimized across warmups + working sets per exercise. */
  optimizedPlateOrder?: boolean
  /** Display and labels; plate math still uses the same numeric rack until kg-specific logic is added. */
  weightUnit?: LiftWeightUnit
  plateUnit?: LiftWeightUnit
}

export interface LiftWarmupSet {
  id?: string
  reps: number
  percentage: number
}

export interface LiftWorkout {
  id: string
  dayId: string
  name: string
  mainWeight: number
  sets: number
  reps: number
  increment: number
  barWeight: number
  hasWarmup: boolean
  warmupSets: LiftWarmupSet[]
  notes?: string
}

export interface LiftHistoryEntry {
  id: string
  workoutId: string
  workoutName?: string
  date: string
  weight?: number
  oldWeight?: number
  newWeight?: number
  statusName?: string
}
