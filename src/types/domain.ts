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
  /**
   * Machine-readable portion the AI resolved for the user: "<number> <singular-unit>".
   * Examples: "6 gummy", "4 oz", "0.5 sandwich", "25 g", "2 slice", "1 serving".
   * The app uses this to compute the correct multiplier against the DB serving — not the AI.
   */
  resolvedAmount?: string
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
  /** Human-readable label for one base portion (e.g. "1/2 cup", "2 tablespoons"). */
  servingType?: string
  /** Numeric quantity in one base portion (e.g. 0.5 for "1/2 cup", 2 for "2 tbsp"). */
  servingSize?: number
  /** Unit for one base portion (e.g. "cup prepared", "tablespoon", "slice"). */
  servingUnit?: string
  /** User-editable count of base portions consumed. */
  servingMultiplier?: number
  /** Calories per one servingType unit; used to recalc when servingMultiplier changes. */
  baseCalories?: number
  /** Protein (g) per one servingType unit. */
  baseProtein?: number
  /** FatSecret search query from parser; not shown in UI. */
  fatSecretSearch?: string
  /** Cached FatSecret search snapshot; reused on macro refresh (no re-search). */
  fatSecretResults?: FatSecretFoodRef[]
  /** Card is waiting on FatSecret barcode lookup (no code shown in UI). */
  barcodeLookup?: boolean
  /** Macros came from a barcode scan (single fixed FatSecret match). */
  fromBarcode?: boolean
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
  /** Seconds before each segment ends to play a warning sound. */
  timerWarningSeconds?: number
  /** Server-persisted workout timer (timestamp-based for multi-device sync). */
  timerSession?: LiftTimerSession | null
}

export interface LiftTimerSegment {
  workoutId: string
  setNumber: number
  groupEndSetNumber: number
  durationMs: number
  isWarmup: boolean
}

export type LiftTimerStatus = 'idle' | 'running' | 'paused' | 'complete'

export interface LiftTimerSession {
  dayId: string
  status: LiftTimerStatus
  /** Elapsed ms at last pause (or at start). */
  elapsedMs: number
  /** Epoch ms when the current running stretch started; null when paused/idle/complete. */
  resumeAt: number | null
  segments: LiftTimerSegment[]
  /** Segment index whose warning sound has fired (-1 = none). */
  warningFiredForSegment: number
  /** Highest segment index whose end chime has fired (-1 = none). */
  completeFiredThroughSegment: number
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
  /** Rest + lift block duration for warm-up sets (seconds). */
  warmupDurationSeconds?: number
  /** Rest + lift block duration for working sets (seconds). */
  liftDurationSeconds?: number
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
