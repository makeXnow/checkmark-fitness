import { proteinGramsFromPct } from '../macro/macroCalculator'
import type { DayLog, HabitGoalConfig, MacroDayGoalsSnapshot, MacroDayItem } from '../../types/domain'

export const DEFAULT_DIET_TARGET_BANDS = {
  caloriePctMin: 80,
  caloriePctMax: 110,
  proteinPctMin: 80,
  proteinPctMax: 110,
} as const

export type DietTargetBands = {
  caloriePctMin: number
  caloriePctMax: number
  proteinPctMin: number
  proteinPctMax: number
}

export type DietTargetBandPrompt = {
  localDate: string
  calories: number
  /** Protein intake as % of that day's protein-grams goal. */
  proteinPctOfGoal: number
}

export function resolveDietTargetBands(diet: HabitGoalConfig): DietTargetBands {
  const caloriePctMin = clampPct(diet.caloriePctMin ?? DEFAULT_DIET_TARGET_BANDS.caloriePctMin)
  const caloriePctMax = clampPct(diet.caloriePctMax ?? DEFAULT_DIET_TARGET_BANDS.caloriePctMax)
  const proteinPctMin = clampPct(diet.proteinPctMin ?? DEFAULT_DIET_TARGET_BANDS.proteinPctMin)
  const proteinPctMax = clampPct(diet.proteinPctMax ?? DEFAULT_DIET_TARGET_BANDS.proteinPctMax)
  return {
    caloriePctMin: Math.min(caloriePctMin, caloriePctMax),
    caloriePctMax: Math.max(caloriePctMin, caloriePctMax),
    proteinPctMin: Math.min(proteinPctMin, proteinPctMax),
    proteinPctMax: Math.max(proteinPctMin, proteinPctMax),
  }
}

function clampPct(n: number): number {
  if (!Number.isFinite(n)) return 0
  return Math.max(0, Math.min(200, Math.round(n)))
}

export function sumMacroDayTotals(items: MacroDayItem[] | undefined): { cal: number; pro: number } {
  return (items || []).reduce(
    (acc, i) => ({
      cal: acc.cal + (i.calories || 0),
      pro: acc.pro + (i.protein || 0),
    }),
    { cal: 0, pro: 0 },
  )
}

export function proteinGoalGrams(targets: MacroDayGoalsSnapshot): number {
  return targets.proteinGramsGoal ?? proteinGramsFromPct(targets.calorieGoal, targets.proteinPctGoal)
}

export function isDietMetByTargetBands(
  totals: { cal: number; pro: number },
  targets: MacroDayGoalsSnapshot,
  diet: HabitGoalConfig,
): boolean {
  if (!diet.autoFromMacros) return false
  const bands = resolveDietTargetBands(diet)
  const calorieGoal = targets.calorieGoal
  const proteinGoal = proteinGoalGrams(targets)
  if (calorieGoal <= 0 || proteinGoal <= 0) return false

  // Integer-safe band checks (avoids float miss at exact bounds like 110%).
  return (
    totals.cal * 100 >= calorieGoal * bands.caloriePctMin &&
    totals.cal * 100 <= calorieGoal * bands.caloriePctMax &&
    totals.pro * 100 >= proteinGoal * bands.proteinPctMin &&
    totals.pro * 100 <= proteinGoal * bands.proteinPctMax
  )
}

function addDaysISO(iso: string, delta: number): string {
  const [y, m, d] = iso.split('-').map((x) => parseInt(x, 10))
  const dt = new Date(y, m - 1, d, 12, 0, 0)
  dt.setDate(dt.getDate() + delta)
  const yy = dt.getFullYear()
  const mm = String(dt.getMonth() + 1).padStart(2, '0')
  const dd = String(dt.getDate()).padStart(2, '0')
  return `${yy}-${mm}-${dd}`
}

/**
 * Most recent past day that hit target bands and has not been prompted yet.
 * Skips days already marked diet or already answered (yes/no).
 */
export function findDietTargetBandPrompt(
  habitsLogs: Record<string, DayLog>,
  macroLogs: Record<string, MacroDayItem[]>,
  dietForDate: (date: string) => HabitGoalConfig,
  resolveTargets: (date: string) => MacroDayGoalsSnapshot,
  todayISO: string,
  lookbackDays = 30,
): DietTargetBandPrompt | null {
  for (let i = 1; i <= lookbackDays; i++) {
    const date = addDaysISO(todayISO, -i)
    const diet = dietForDate(date)
    if (!diet.autoFromMacros) continue

    const dayLog = habitsLogs[date]
    if (dayLog?.diet) continue
    if (dayLog?.dietPromptResolved) continue

    const items = macroLogs[date]
    if (!items?.length) continue

    const totals = sumMacroDayTotals(items)
    const targets = resolveTargets(date)
    if (!isDietMetByTargetBands(totals, targets, diet)) continue

    const proteinGoal = proteinGoalGrams(targets)
    const proteinPctOfGoal = proteinGoal > 0 ? Math.round((totals.pro / proteinGoal) * 100) : 0

    return {
      localDate: date,
      calories: Math.round(totals.cal),
      proteinPctOfGoal,
    }
  }
  return null
}
