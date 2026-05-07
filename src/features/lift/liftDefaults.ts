import type { LiftWarmupSet, LiftWorkout } from '../../types/domain'

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
  }
}
