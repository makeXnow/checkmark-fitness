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

export interface BootstrapResponse {
  appState: AppStateRow
  habits: {
    goals: HabitsGoals
    logs: Record<string, DayLog>
    appSettings: { firstDayOfWeek: number }
    updatedAt: number
  }
  macro: {
    goals: { calorieGoal: number; proteinPctGoal: number }
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
  /** Set when macros were scaled from the food library. */
  libraryFoodId?: string
  servingMultiplier?: number
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
