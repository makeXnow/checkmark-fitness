import { describe, expect, it } from 'vitest'
import type { LiftTimerSegment, LiftTimerSession } from '../../types/domain'
import {
  getLiftTimerActiveWorkoutId,
  getLiftTimerWorkoutStartMs,
  seekLiftTimerSessionToWorkout,
} from './liftTimer'

function makeSegment(
  workoutId: string,
  durationMs: number,
  setNumber = 1,
): LiftTimerSegment {
  return {
    workoutId,
    setNumber,
    groupEndSetNumber: setNumber,
    durationMs,
    isWarmup: false,
  }
}

function makeSession(
  segments: LiftTimerSegment[],
  overrides: Partial<LiftTimerSession> = {},
): LiftTimerSession {
  return {
    dayId: 'day-1',
    status: 'running',
    elapsedMs: 0,
    resumeAt: Date.now() - 5_000,
    segments,
    warningFiredForSegment: 2,
    completeFiredThroughSegment: 1,
    ...overrides,
  }
}

describe('seekLiftTimerSessionToWorkout', () => {
  const segments = [
    makeSegment('squat', 60_000, 1),
    makeSegment('squat', 60_000, 2),
    makeSegment('bench', 90_000, 1),
    makeSegment('deadlift', 120_000, 1),
  ]

  it('jumps to the start of the tapped workout and keeps running', () => {
    const session = makeSession(segments, { elapsedMs: 10_000, resumeAt: Date.now() - 10_000 })
    const next = seekLiftTimerSessionToWorkout(session, 'bench')

    expect(next).not.toBeNull()
    expect(next!.status).toBe('running')
    expect(next!.elapsedMs).toBe(120_000)
    expect(next!.resumeAt).toEqual(expect.any(Number))
    expect(getLiftTimerActiveWorkoutId(next!, next!.elapsedMs)).toBe('bench')
  })

  it('resumes running when seeking from a paused session', () => {
    const session = makeSession(segments, {
      status: 'paused',
      elapsedMs: 150_000,
      resumeAt: null,
    })
    const next = seekLiftTimerSessionToWorkout(session, 'squat')

    expect(next!.status).toBe('running')
    expect(next!.elapsedMs).toBe(0)
    expect(next!.resumeAt).toEqual(expect.any(Number))
  })

  it('resets sound markers so later segments can fire again', () => {
    const session = makeSession(segments, {
      elapsedMs: 200_000,
      warningFiredForSegment: 3,
      completeFiredThroughSegment: 2,
    })
    const next = seekLiftTimerSessionToWorkout(session, 'bench')

    expect(next!.completeFiredThroughSegment).toBe(1)
    expect(next!.warningFiredForSegment).toBe(-1)
  })

  it('returns null for unknown workouts or idle sessions', () => {
    const running = makeSession(segments)
    expect(seekLiftTimerSessionToWorkout(running, 'missing')).toBeNull()
    expect(
      seekLiftTimerSessionToWorkout(makeSession(segments, { status: 'idle' }), 'bench'),
    ).toBeNull()
  })
})

describe('getLiftTimerWorkoutStartMs', () => {
  it('returns the cumulative start offset for a workout', () => {
    const session = makeSession([
      makeSegment('a', 10_000),
      makeSegment('b', 20_000),
      makeSegment('c', 30_000),
    ])
    expect(getLiftTimerWorkoutStartMs(session, 'a')).toBe(0)
    expect(getLiftTimerWorkoutStartMs(session, 'b')).toBe(10_000)
    expect(getLiftTimerWorkoutStartMs(session, 'c')).toBe(30_000)
    expect(getLiftTimerWorkoutStartMs(session, 'missing')).toBeNull()
  })
})
