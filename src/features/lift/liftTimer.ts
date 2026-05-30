import type { LiftTimerSegment, LiftTimerSession, LiftTimerStatus, LiftWorkout } from '../../types/domain'
import { buildGroupedSets, collectWorkoutSetTargets } from './plates'

export const DEFAULT_WARMUP_DURATION_SECONDS = 60
export const DEFAULT_LIFT_DURATION_SECONDS = 120
export const DEFAULT_TIMER_WARNING_SECONDS = 15

export function formatLiftTimerDuration(totalMs: number): string {
  const totalSec = Math.max(0, Math.ceil(totalMs / 1000))
  const m = Math.floor(totalSec / 60)
  const s = totalSec % 60
  return `${m}:${String(s).padStart(2, '0')}`
}

function segmentDurationMs(
  workout: LiftWorkout,
  isWarmup: boolean,
  isLastWarmupBeforeWorking: boolean,
): number {
  const warmupSec = workout.warmupDurationSeconds ?? DEFAULT_WARMUP_DURATION_SECONDS
  const liftSec = workout.liftDurationSeconds ?? DEFAULT_LIFT_DURATION_SECONDS
  if (!isWarmup || isLastWarmupBeforeWorking) return liftSec * 1000
  return warmupSec * 1000
}

export function buildLiftTimerSegments(workouts: LiftWorkout[]): LiftTimerSegment[] {
  const segments: LiftTimerSegment[] = []

  for (const workout of workouts) {
    const targets = collectWorkoutSetTargets(workout)
    if (targets.length === 0) continue

    const { groupedSets } = buildGroupedSets(workout, [], 1, false)
    const setNumToGroupEnd = new Map<number, number>()
    for (const group of groupedSets) {
      for (let n = group.startNum; n <= group.endNum; n++) {
        setNumToGroupEnd.set(n, group.endNum)
      }
    }

    let setNumber = 1
    for (let i = 0; i < targets.length; i++) {
      const target = targets[i]
      const isLastWarmupBeforeWorking =
        target.isWarmup && (i === targets.length - 1 || !targets[i + 1]?.isWarmup)

      segments.push({
        workoutId: workout.id,
        setNumber,
        groupEndSetNumber: setNumToGroupEnd.get(setNumber) ?? setNumber,
        durationMs: segmentDurationMs(workout, target.isWarmup, isLastWarmupBeforeWorking),
        isWarmup: target.isWarmup,
      })
      setNumber++
    }
  }

  return segments
}

export function getLiftTimerTotalDurationMs(segments: LiftTimerSegment[]): number {
  return segments.reduce((sum, segment) => sum + segment.durationMs, 0)
}

export function getLiftTimerLiveElapsedMs(session: LiftTimerSession): number {
  if (session.status === 'running' && session.resumeAt != null) {
    return session.elapsedMs + (Date.now() - session.resumeAt)
  }
  return session.elapsedMs
}

export function getLiftTimerSegmentStarts(segments: LiftTimerSegment[]): number[] {
  const starts: number[] = []
  let offset = 0
  for (const segment of segments) {
    starts.push(offset)
    offset += segment.durationMs
  }
  return starts
}

/** Index of the active segment, or segments.length when the workout is finished. */
export function getLiftTimerSegmentIndex(session: LiftTimerSession, liveElapsedMs: number): number {
  let offset = 0
  for (let i = 0; i < session.segments.length; i++) {
    offset += session.segments[i].durationMs
    if (liveElapsedMs < offset) return i
  }
  return session.segments.length
}

export function getLiftTimerActiveWorkoutId(
  session: LiftTimerSession,
  liveElapsedMs: number,
): string | null {
  const index = getLiftTimerSegmentIndex(session, liveElapsedMs)
  if (index >= session.segments.length) return null
  return session.segments[index]?.workoutId ?? null
}

export function isLiftTimerActive(session: LiftTimerSession | null | undefined): boolean {
  return session?.status === 'running' || session?.status === 'paused'
}

export function startLiftTimerSession(dayId: string, segments: LiftTimerSegment[]): LiftTimerSession {
  return {
    dayId,
    status: 'running',
    elapsedMs: 0,
    resumeAt: Date.now(),
    segments,
    warningFiredForSegment: -1,
    completeFiredThroughSegment: -1,
  }
}

export function pauseLiftTimerSession(session: LiftTimerSession): LiftTimerSession {
  if (session.status !== 'running') return session
  const elapsedMs = getLiftTimerLiveElapsedMs(session)
  const totalMs = getLiftTimerTotalDurationMs(session.segments)
  if (elapsedMs >= totalMs) {
    return { ...session, status: 'complete', elapsedMs: totalMs, resumeAt: null }
  }
  return { ...session, status: 'paused', elapsedMs, resumeAt: null }
}

export function resumeLiftTimerSession(session: LiftTimerSession): LiftTimerSession {
  if (session.status !== 'paused') return session
  const totalMs = getLiftTimerTotalDurationMs(session.segments)
  if (session.elapsedMs >= totalMs) {
    return { ...session, status: 'complete', resumeAt: null }
  }
  return { ...session, status: 'running', resumeAt: Date.now() }
}

export function clearLiftTimerSession(): null {
  return null
}

export type LiftGroupTimerProgress = {
  groupIndex: number
  progress: number
  currentSetNumber: number | null
  groupEndSetNumber: number
}

export function getWorkoutGroupTimerProgress(
  workoutId: string,
  session: LiftTimerSession,
  liveElapsedMs: number,
  groupStartSetNumbers: number[],
  groupEndSetNumbers: number[],
): LiftGroupTimerProgress[] | null {
  if (session.status === 'idle' || session.status === 'complete') return null

  const segmentStarts = getLiftTimerSegmentStarts(session.segments)
  const workoutRanges: Array<{
    segment: LiftTimerSegment
    startMs: number
    endMs: number
    globalIndex: number
  }> = []

  for (let i = 0; i < session.segments.length; i++) {
    const segment = session.segments[i]
    const startMs = segmentStarts[i] ?? 0
    const endMs = startMs + segment.durationMs
    if (segment.workoutId === workoutId) {
      workoutRanges.push({ segment, startMs, endMs, globalIndex: i })
    }
  }

  if (workoutRanges.length === 0) return null

  return groupStartSetNumbers.map((startNum, groupIndex) => {
    const endNum = groupEndSetNumbers[groupIndex] ?? startNum
    const groupSegs = workoutRanges.filter(
      (range) => range.segment.setNumber >= startNum && range.segment.setNumber <= endNum,
    )
    const groupStartMs = groupSegs[0]?.startMs ?? 0
    const groupEndMs = groupSegs[groupSegs.length - 1]?.endMs ?? groupStartMs
    const groupTotalMs = Math.max(1, groupEndMs - groupStartMs)

    let progress = 0
    let currentSetNumber: number | null = null

    if (liveElapsedMs >= groupEndMs) {
      progress = 1
    } else if (liveElapsedMs > groupStartMs) {
      progress = Math.min(1, (liveElapsedMs - groupStartMs) / groupTotalMs)
      for (const range of groupSegs) {
        if (liveElapsedMs >= range.startMs && liveElapsedMs < range.endMs) {
          currentSetNumber = range.segment.setNumber
          break
        }
      }
    }

    return {
      groupIndex,
      progress,
      currentSetNumber,
      groupEndSetNumber: endNum,
    }
  })
}

export function syncLiftTimerSoundMarkers(
  session: LiftTimerSession,
  liveElapsedMs: number,
  warningSeconds: number,
): Pick<LiftTimerSession, 'warningFiredForSegment' | 'completeFiredThroughSegment' | 'status'> {
  const totalMs = getLiftTimerTotalDurationMs(session.segments)
  const segIdx = getLiftTimerSegmentIndex(session, liveElapsedMs)
  const warningMs = Math.max(0, warningSeconds * 1000)

  let completeFiredThroughSegment = session.completeFiredThroughSegment
  if (segIdx > 0) {
    completeFiredThroughSegment = Math.max(completeFiredThroughSegment, segIdx - 1)
  }
  if (liveElapsedMs >= totalMs && session.segments.length > 0) {
    completeFiredThroughSegment = session.segments.length - 1
  }

  let warningFiredForSegment = session.warningFiredForSegment
  if (segIdx < session.segments.length) {
    const starts = getLiftTimerSegmentStarts(session.segments)
    const segStart = starts[segIdx] ?? 0
    const seg = session.segments[segIdx]
    const segElapsed = liveElapsedMs - segStart
    const remaining = seg.durationMs - segElapsed
    if (remaining <= warningMs && segElapsed >= 0) {
      warningFiredForSegment = Math.max(warningFiredForSegment, segIdx)
    }
  }

  const status: LiftTimerStatus =
    liveElapsedMs >= totalMs && session.segments.length > 0 ? 'complete' : session.status

  return { warningFiredForSegment, completeFiredThroughSegment, status }
}

export function getLiftTimerDisplayStatus(
  session: LiftTimerSession | null | undefined,
  liveElapsedMs: number,
): LiftTimerStatus {
  if (!session) return 'idle'
  if (session.status === 'complete') return 'complete'
  const totalMs = getLiftTimerTotalDurationMs(session.segments)
  if (liveElapsedMs >= totalMs && session.segments.length > 0) return 'complete'
  return session.status
}

export function getWorkoutTimerProgress(
  workoutId: string,
  session: LiftTimerSession,
  liveElapsedMs: number,
): number {
  const starts = getLiftTimerSegmentStarts(session.segments)
  let workoutStart = -1
  let workoutEnd = 0

  for (let i = 0; i < session.segments.length; i++) {
    const segment = session.segments[i]
    const end = (starts[i] ?? 0) + segment.durationMs
    if (segment.workoutId === workoutId) {
      if (workoutStart === -1) workoutStart = starts[i] ?? 0
      workoutEnd = end
    }
  }

  if (workoutStart === -1) return 0
  const total = Math.max(1, workoutEnd - workoutStart)
  if (liveElapsedMs <= workoutStart) return 0
  if (liveElapsedMs >= workoutEnd) return 1
  return (liveElapsedMs - workoutStart) / total
}

export function getLiftTimerRemainingMs(session: LiftTimerSession, liveElapsedMs: number): number {
  const totalMs = getLiftTimerTotalDurationMs(session.segments)
  return Math.max(0, totalMs - liveElapsedMs)
}
