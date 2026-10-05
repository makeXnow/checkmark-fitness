import { describe, expect, it } from 'vitest'
import { applyHabitShortcut, weekDatesFor } from './habitShortcuts'

const cardioGoal = { min: 3, max: 5, label: 'Cardio' }
const waterGoal = { dailyTarget: 4, label: 'Water' }

function run(habit: 'cardio' | 'water', logs: Record<string, Record<string, unknown>>, today = '2026-10-07') {
  return applyHabitShortcut({
    habit,
    label: habit === 'cardio' ? 'Cardio' : 'Water',
    goal: habit === 'cardio' ? cardioGoal : waterGoal,
    today,
    logs,
    firstDayOfWeek: 0,
  })
}

describe('weekDatesFor', () => {
  it('starts on Sunday or Monday', () => {
    expect(weekDatesFor('2026-10-07', 0)[0]).toBe('2026-10-04')
    expect(weekDatesFor('2026-10-07', 1)[0]).toBe('2026-10-05')
    expect(weekDatesFor('2026-10-04', 1)[0]).toBe('2026-09-28')
  })
})

describe('applyHabitShortcut', () => {
  it('reports weekly progress below the minimum', () => {
    const r = run('cardio', { '2026-10-05': { cardio: true } })
    expect(r).toMatchObject({ changed: true, message: 'Cardio tracked. 2 of 3 this week.' })
    expect(r.day.cardio).toBe(true)
  })

  it('celebrates reaching the weekly minimum', () => {
    const r = run('cardio', { '2026-10-04': { cardio: true }, '2026-10-05': { cardio: true } })
    expect(r.message).toBe('Cardio tracked. Weekly goal hit!')
  })

  it('counts past the minimum', () => {
    const logs = { '2026-10-04': { cardio: true }, '2026-10-05': { cardio: true }, '2026-10-06': { cardio: true } }
    expect(run('cardio', logs).message).toBe('Cardio tracked. 4 this week.')
  })

  it('ignores days from last week', () => {
    expect(run('cardio', { '2026-10-03': { cardio: true } }).message).toBe('Cardio tracked. 1 of 3 this week.')
  })

  it('does nothing on a repeat run', () => {
    const r = run('cardio', { '2026-10-07': { cardio: true } })
    expect(r).toMatchObject({ changed: false, message: 'Cardio already tracked today.' })
  })

  it('counts water up to the goal, then stops', () => {
    expect(run('water', {}).message).toBe('Water 1 of 4.')
    expect(run('water', { '2026-10-07': { water: 3 } }).message).toBe('Water goal hit, 4 of 4!')
    expect(run('water', { '2026-10-07': { water: 4 } })).toMatchObject({
      changed: false,
      message: 'Water already at 4 of 4.',
    })
  })
})
