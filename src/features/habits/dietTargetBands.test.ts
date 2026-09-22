import { describe, expect, it } from 'vitest'
import {
  DEFAULT_DIET_TARGET_BANDS,
  findDietTargetBandPrompt,
  isDietMetByTargetBands,
} from './dietTargetBands'
import type { HabitGoalConfig, MacroDayGoalsSnapshot, MacroDayItem } from '../../types/domain'

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

const meal = (calories: number, protein: number): MacroDayItem => ({
  id: 'a',
  name: 'x',
  amount: '1',
  calories,
  protein,
})

describe('diet target bands', () => {
  it('checks when both calories and protein are within bands', () => {
    expect(isDietMetByTargetBands({ cal: 2000, pro: 150 }, targets, dietOn)).toBe(true)
    expect(isDietMetByTargetBands({ cal: 1600, pro: 120 }, targets, dietOn)).toBe(true)
    expect(isDietMetByTargetBands({ cal: 2200, pro: 165 }, targets, dietOn)).toBe(true)
  })

  it('fails when either macro is outside its band', () => {
    expect(isDietMetByTargetBands({ cal: 1500, pro: 150 }, targets, dietOn)).toBe(false)
    expect(isDietMetByTargetBands({ cal: 2000, pro: 100 }, targets, dietOn)).toBe(false)
    expect(isDietMetByTargetBands({ cal: 2300, pro: 150 }, targets, dietOn)).toBe(false)
  })

  it('finds yesterday when bands were hit and not yet resolved', () => {
    const prompt = findDietTargetBandPrompt(
      {},
      { '2026-09-21': [meal(2000, 150)] },
      () => dietOn,
      () => targets,
      '2026-09-22',
    )
    expect(prompt).toEqual({
      localDate: '2026-09-21',
      calories: 2000,
      proteinPctOfGoal: 100,
    })
  })

  it('skips days already checked or already answered', () => {
    expect(
      findDietTargetBandPrompt(
        { '2026-09-21': { diet: true } },
        { '2026-09-21': [meal(2000, 150)] },
        () => dietOn,
        () => targets,
        '2026-09-22',
      ),
    ).toBeNull()

    expect(
      findDietTargetBandPrompt(
        { '2026-09-21': { dietPromptResolved: true } },
        { '2026-09-21': [meal(2000, 150)] },
        () => dietOn,
        () => targets,
        '2026-09-22',
      ),
    ).toBeNull()
  })

  it('does not prompt for today or when bands are off', () => {
    expect(
      findDietTargetBandPrompt(
        {},
        { '2026-09-22': [meal(2000, 150)] },
        () => dietOn,
        () => targets,
        '2026-09-22',
      ),
    ).toBeNull()

    expect(
      findDietTargetBandPrompt(
        {},
        { '2026-09-21': [meal(2000, 150)] },
        () => ({ ...dietOn, autoFromMacros: false }),
        () => targets,
        '2026-09-22',
      ),
    ).toBeNull()
  })
})
