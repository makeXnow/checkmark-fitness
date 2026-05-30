import type { LiftWarmupSet, LiftWorkout } from '../../types/domain'
import { DEFAULT_LIFT_DURATION_SECONDS, DEFAULT_WARMUP_DURATION_SECONDS } from './liftTimer'

export function makeLiftId(prefix: string) {
  return `${prefix}${crypto.randomUUID()}`
}

export function defaultWarmupSets(): LiftWarmupSet[] {
  return [
    { id: makeLiftId('wu_'), reps: 10, percentage: 50 },
    { id: makeLiftId('wu_'), reps: 5, percentage: 75 },
  ]
}

export function newEmptyWorkout(dayId: string): LiftWorkout {
  return {
    id: '',
    dayId,
    name: 'New Workout',
    mainWeight: 100,
    sets: 3,
    reps: 5,
    increment: 5,
    barWeight: 45,
    hasWarmup: false,
    warmupSets: [],
    notes: '',
    warmupDurationSeconds: DEFAULT_WARMUP_DURATION_SECONDS,
    liftDurationSeconds: DEFAULT_LIFT_DURATION_SECONDS,
  }
}
