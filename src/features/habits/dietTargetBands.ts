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

export function isDietMetByTargetBands(
  totals: { cal: number; pro: number },
  targets: MacroDayGoalsSnapshot,
  diet: HabitGoalConfig,
): boolean {
  if (!diet.autoFromMacros) return false
  const bands = resolveDietTargetBands(diet)
  const calorieGoal = targets.calorieGoal
  const proteinGoal =
    targets.proteinGramsGoal ?? proteinGramsFromPct(targets.calorieGoal, targets.proteinPctGoal)
  if (calorieGoal <= 0 || proteinGoal <= 0) return false

  // Integer-safe band checks (avoids float miss at exact bounds like 110%).
  return (
    totals.cal * 100 >= calorieGoal * bands.caloriePctMin &&
    totals.cal * 100 <= calorieGoal * bands.caloriePctMax &&
    totals.pro * 100 >= proteinGoal * bands.proteinPctMin &&
    totals.pro * 100 <= proteinGoal * bands.proteinPctMax
  )
}

/**
 * When target bands are enabled, rewrite `diet` flags from macro totals.
 * Returns null when nothing changed (or auto mode is off).
 */
export function syncDietLogsFromMacros(
  habitsLogs: Record<string, DayLog>,
  macroLogs: Record<string, MacroDayItem[]>,
  diet: HabitGoalConfig,
  resolveTargets: (date: string) => MacroDayGoalsSnapshot,
): Record<string, DayLog> | null {
  if (!diet.autoFromMacros) return null

  const dates = new Set([...Object.keys(habitsLogs), ...Object.keys(macroLogs)])
  let changed = false
  const next: Record<string, DayLog> = { ...habitsLogs }

  for (const date of dates) {
    const met = isDietMetByTargetBands(sumMacroDayTotals(macroLogs[date]), resolveTargets(date), diet)
    const day = next[date] || {}
    if (!!day.diet === met) continue
    next[date] = { ...day, diet: met }
    changed = true
  }

  return changed ? next : null
}
