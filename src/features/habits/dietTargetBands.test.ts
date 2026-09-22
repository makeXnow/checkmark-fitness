import { describe, expect, it } from 'vitest'
import {
  DEFAULT_DIET_TARGET_BANDS,
  isDietMetByTargetBands,
  syncDietLogsFromMacros,
} from './dietTargetBands'
import type { HabitGoalConfig, MacroDayGoalsSnapshot } from '../../types/domain'

const dietOn: HabitGoalConfig = {
  min: 6,
  max: 7,
  color: 'bg-emerald-500',
  icon: 'Apple',
  label: 'Diet',
  autoFromMacros: true,
  ...DEFAULT_DIET_TARGET_BANDS,
}

const targets: MacroDayGoalsSnapshot = {
  calorieGoal: 2000,
  proteinPctGoal: 30,
  proteinGramsGoal: 150,
  proteinTrackMode: 'grams',
}

describe('diet target bands', () => {
  it('checks when both calories and protein are within bands', () => {
    expect(
      isDietMetByTargetBands({ cal: 2000, pro: 150 }, targets, dietOn),
    ).toBe(true)
    expect(
      isDietMetByTargetBands({ cal: 1600, pro: 120 }, targets, dietOn),
    ).toBe(true)
    expect(
      isDietMetByTargetBands({ cal: 2200, pro: 165 }, targets, dietOn),
    ).toBe(true)
  })

  it('fails when either macro is outside its band', () => {
    expect(
      isDietMetByTargetBands({ cal: 1500, pro: 150 }, targets, dietOn),
    ).toBe(false)
    expect(
      isDietMetByTargetBands({ cal: 2000, pro: 100 }, targets, dietOn),
    ).toBe(false)
    expect(
      isDietMetByTargetBands({ cal: 2300, pro: 150 }, targets, dietOn),
    ).toBe(false)
  })

  it('does nothing when auto mode is off', () => {
    const off = { ...dietOn, autoFromMacros: false }
    expect(isDietMetByTargetBands({ cal: 2000, pro: 150 }, targets, off)).toBe(false)
    expect(
      syncDietLogsFromMacros({ '2026-09-21': { diet: false } }, { '2026-09-21': [] }, off, () => targets),
    ).toBeNull()
  })

  it('syncs diet flags from macro totals', () => {
    const next = syncDietLogsFromMacros(
      { '2026-09-21': { diet: false }, '2026-09-20': { diet: true } },
      {
        '2026-09-21': [{ id: 'a', name: 'x', amount: '1', calories: 2000, protein: 150 }],
        '2026-09-20': [{ id: 'b', name: 'y', amount: '1', calories: 1000, protein: 50 }],
      },
      dietOn,
      () => targets,
    )
    expect(next?.['2026-09-21']?.diet).toBe(true)
    expect(next?.['2026-09-20']?.diet).toBe(false)
  })
})
