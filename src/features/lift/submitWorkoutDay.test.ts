import { describe, expect, it } from 'vitest'
import type { LiftPayload, LiftWorkout } from '../../types/domain'
import { hasLiftHistoryForDayOnDate } from './liftHistory'
import { SKIP_LIFT_STATUS_ID } from './liftStatuses'
import { getSessionMainWeight } from './plates'
import { buildSubmitWorkoutDayPayload, dateAtLocalNoonISO } from './submitWorkoutDay'

const localDate = '2026-11-03'

function workout(id: string, dayId = 'day-1'): LiftWorkout {
  return {
    id, dayId, name: id, mainWeight: 100, increment: 5,
    sets: 3, reps: 5, barWeight: 45, hasWarmup: false, warmupSets: [],
  }
}

function payload(): LiftPayload {
  return {
    days: [
      { id: 'day-2', name: 'B', order: 2 },
      { id: 'day-1', name: 'A', order: 1 },
    ],
    workouts: [workout('squat'), workout('bench'), workout('row'), workout('press', 'day-2')],
    statuses: [
      { id: 'success', name: 'Success', multiplier: 1 },
      { id: 'fail', name: 'Fail', multiplier: 0 },
      { id: 'big-fail', name: 'Big Fail', multiplier: -1 },
    ],
    availablePlates: [45, 25, 10, 5, 2.5],
    history: [],
  }
}

describe('submitting a workout day with Skip', () => {
  it('logs completed exercises, keeps the skipped weight, and advances the day', () => {
    const original = payload()
    const { nextPayload, nextDayIndex } = buildSubmitWorkoutDayPayload(original, 'day-1', {
      localDate, advanceDayIndex: true,
      statusByWorkoutId: { bench: SKIP_LIFT_STATUS_ID },
    })

    expect(nextPayload.history.map((h) => h.workoutId)).toEqual(['squat', 'row'])
    expect(nextPayload.workouts.map((w) => w.mainWeight)).toEqual([105, 100, 105, 100])
    expect(nextPayload.workouts[1]).toEqual(original.workouts[1])
    expect(nextPayload.workouts[3]).toEqual(original.workouts[3])
    expect(nextDayIndex).toBe(1)
    expect(hasLiftHistoryForDayOnDate(nextPayload, 'day-1', localDate)).toBe(true)
    expect(original.history).toEqual([])
    expect(original.workouts.map((w) => w.mainWeight)).toEqual([100, 100, 100, 100])
  })

  it('preserves the next session weight and a manual override without consuming it', () => {
    const original = payload()
    original.workouts[1] = { ...original.workouts[1], mainWeight: 90, nextWeight: 120 }
    original.history = [{
      id: 'prior', workoutId: 'bench', date: dateAtLocalNoonISO('2026-10-27'),
      weight: 100, newWeight: 105, statusName: 'Success',
    }]
    const { nextPayload } = buildSubmitWorkoutDayPayload(original, 'day-1', {
      localDate, statusByWorkoutId: { bench: SKIP_LIFT_STATUS_ID },
    })

    expect(nextPayload.history.filter((h) => h.workoutId === 'bench')).toEqual(original.history)
    expect(nextPayload.workouts[1]).toEqual(original.workouts[1])
    expect(getSessionMainWeight(nextPayload.workouts[1], nextPayload.history, nextPayload.availablePlates)).toBe(105)
  })

  it('still logs Fail and Big Fail with their configured progression', () => {
    const { nextPayload } = buildSubmitWorkoutDayPayload(payload(), 'day-1', {
      localDate,
      statusByWorkoutId: { squat: 'fail', bench: 'big-fail', row: SKIP_LIFT_STATUS_ID },
    })

    expect(nextPayload.history.map((h) => [h.workoutId, h.statusName, h.newWeight])).toEqual([
      ['squat', 'Fail', 100], ['bench', 'Big Fail', 95],
    ])
  })

  it('supports Skip even when no custom statuses have been configured', () => {
    const original = { ...payload(), statuses: [] }
    const { nextPayload } = buildSubmitWorkoutDayPayload(original, 'day-1', {
      localDate, statusByWorkoutId: { bench: SKIP_LIFT_STATUS_ID },
    })

    expect(nextPayload.history.map((h) => h.workoutId)).toEqual(['squat', 'row'])
    expect(nextPayload.workouts[1].mainWeight).toBe(100)
    expect(nextPayload.workouts[0].mainWeight).toBe(105)
  })

  it('does not count or advance a day when every exercise is skipped', () => {
    const original = payload()
    const { nextPayload, nextDayIndex } = buildSubmitWorkoutDayPayload(original, 'day-1', {
      localDate, advanceDayIndex: true,
      statusByWorkoutId: {
        squat: SKIP_LIFT_STATUS_ID, bench: SKIP_LIFT_STATUS_ID, row: SKIP_LIFT_STATUS_ID,
      },
    })

    expect(nextPayload.history).toEqual([])
    expect(nextPayload.workouts).toEqual(original.workouts)
    expect(nextDayIndex).toBeUndefined()
    expect(hasLiftHistoryForDayOnDate(nextPayload, 'day-1', localDate)).toBe(false)
  })

  it('replaces same-day entries without leaving a log for a skipped exercise', () => {
    const original = payload()
    original.history = ['2026-10-27', localDate].map((date) => ({
      id: date, workoutId: 'bench', date: dateAtLocalNoonISO(date),
      weight: 100, newWeight: 100, statusName: 'Fail',
    }))
    const { nextPayload } = buildSubmitWorkoutDayPayload(original, 'day-1', {
      localDate, statusByWorkoutId: { bench: SKIP_LIFT_STATUS_ID },
    })

    expect(nextPayload.history.filter((h) => h.workoutId === 'bench')).toEqual([original.history[0]])
  })

  it('keeps default outcomes and historical submissions working', () => {
    const { nextPayload, nextDayIndex } = buildSubmitWorkoutDayPayload(payload(), 'day-1', {
      localDate, statusByWorkoutId: { bench: 'deleted-status' },
    })

    expect(nextPayload.history).toHaveLength(3)
    expect(nextPayload.history.every((h) => h.statusName === 'Success' && h.newWeight === 105)).toBe(true)
    expect(nextDayIndex).toBeUndefined()
  })
})
