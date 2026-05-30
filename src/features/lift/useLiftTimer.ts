import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { LiftPayload, LiftTimerSession, LiftWorkout } from '../../types/domain'
import {
  buildLiftTimerSegments,
  clearLiftTimerSession,
  DEFAULT_TIMER_WARNING_SECONDS,
  formatLiftTimerDuration,
  getLiftTimerActiveWorkoutId,
  getLiftTimerDisplayStatus,
  getLiftTimerLiveElapsedMs,
  getLiftTimerRemainingMs,
  getLiftTimerSegmentIndex,
  getLiftTimerTotalDurationMs,
  isLiftTimerActive,
  pauseLiftTimerSession,
  resumeLiftTimerSession,
  startLiftTimerSession,
  syncLiftTimerSoundMarkers,
} from './liftTimer'
import {
  playLiftTimerSegmentCompleteSound,
  playLiftTimerWarningSound,
  playLiftTimerWorkoutCompleteSound,
} from './liftTimerSounds'

type UseLiftTimerOptions = {
  payload: LiftPayload
  dayId: string | undefined
  dayWorkouts: LiftWorkout[]
  enabled: boolean
  onPersist: (next: LiftPayload) => void | Promise<void>
}

export function useLiftTimer({ payload, dayId, dayWorkouts, enabled, onPersist }: UseLiftTimerOptions) {
  const session = payload.timerSession ?? null
  const warningSeconds = payload.timerWarningSeconds ?? DEFAULT_TIMER_WARNING_SECONDS

  const previewSegments = useMemo(() => buildLiftTimerSegments(dayWorkouts), [dayWorkouts])
  const previewTotalMs = useMemo(() => getLiftTimerTotalDurationMs(previewSegments), [previewSegments])

  const [frameTick, setFrameTick] = useState(0)
  const lastSegIdxRef = useRef<number>(-1)

  const liveElapsedMs = useMemo(() => {
    if (!session || !isLiftTimerActive(session)) return 0
    if (session.status === 'running') {
      void frameTick
      return getLiftTimerLiveElapsedMs(session)
    }
    return session.elapsedMs
  }, [session, frameTick])

  const displayStatus = useMemo(() => {
    if (!session) return 'idle' as const
    if (session.status === 'running') void frameTick
    return getLiftTimerDisplayStatus(session, getLiftTimerLiveElapsedMs(session))
  }, [session, frameTick])

  const activeWorkoutId = useMemo(() => {
    if (!session || !isLiftTimerActive(session)) return null
    if (session.status === 'running') void frameTick
    return getLiftTimerActiveWorkoutId(session, getLiftTimerLiveElapsedMs(session))
  }, [session, frameTick])

  const persistSession = useCallback(
    (nextSession: LiftTimerSession | null) => {
      onPersist({ ...payload, timerSession: nextSession })
    },
    [onPersist, payload],
  )

  const reconcileSounds = useCallback(
    (currentSession: LiftTimerSession, elapsedMs: number, playAudio: boolean) => {
      const segIdx = getLiftTimerSegmentIndex(currentSession, elapsedMs)
      const totalMs = getLiftTimerTotalDurationMs(currentSession.segments)
      const markers = syncLiftTimerSoundMarkers(currentSession, elapsedMs, warningSeconds)

      let nextSession: LiftTimerSession = {
        ...currentSession,
        ...markers,
        resumeAt: markers.status === 'complete' ? null : currentSession.resumeAt,
      }

      if (markers.status === 'complete') {
        nextSession = {
          ...nextSession,
          status: 'complete',
          elapsedMs: totalMs,
          resumeAt: null,
        }
      }

      if (playAudio && document.visibilityState === 'visible') {
        if (
          segIdx < currentSession.segments.length &&
          markers.warningFiredForSegment > currentSession.warningFiredForSegment
        ) {
          playLiftTimerWarningSound()
        }

        if (markers.completeFiredThroughSegment > currentSession.completeFiredThroughSegment) {
          const finishedAll =
            markers.status === 'complete' &&
            markers.completeFiredThroughSegment >= currentSession.segments.length - 1
          if (finishedAll) {
            playLiftTimerWorkoutCompleteSound()
          } else {
            playLiftTimerSegmentCompleteSound()
          }
        }
      }

      const changed =
        nextSession.warningFiredForSegment !== currentSession.warningFiredForSegment ||
        nextSession.completeFiredThroughSegment !== currentSession.completeFiredThroughSegment ||
        nextSession.status !== currentSession.status

      return { nextSession, changed }
    },
    [warningSeconds],
  )

  useEffect(() => {
    if (!session || session.status !== 'running') return
    let rafId = 0
    const loop = () => {
      setFrameTick(Date.now())
      rafId = requestAnimationFrame(loop)
    }
    rafId = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(rafId)
  }, [session?.status, session?.resumeAt])

  useEffect(() => {
    if (!session || session.status !== 'running') return
    const checkSounds = () => {
      const elapsedMs = getLiftTimerLiveElapsedMs(session)
      const { nextSession, changed } = reconcileSounds(session, elapsedMs, true)
      if (changed) persistSession(nextSession)
      lastSegIdxRef.current = getLiftTimerSegmentIndex(session, elapsedMs)
    }
    checkSounds()
    const id = window.setInterval(checkSounds, 200)
    return () => window.clearInterval(id)
  }, [session, reconcileSounds, persistSession])

  useEffect(() => {
    const onVisible = () => {
      if (!session || session.status !== 'running') return
      const elapsedMs = getLiftTimerLiveElapsedMs(session)
      const { nextSession, changed } = reconcileSounds(session, elapsedMs, true)
      if (changed) persistSession(nextSession)
      setFrameTick(Date.now())
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => document.removeEventListener('visibilitychange', onVisible)
  }, [session, reconcileSounds, persistSession])

  useEffect(() => {
    if (!enabled || !session || !dayId) return
    if (session.dayId !== dayId && isLiftTimerActive(session)) {
      persistSession(clearLiftTimerSession())
    }
  }, [dayId, enabled, persistSession, session])

  const toggle = useCallback(() => {
    if (!dayId || dayWorkouts.length === 0) return

    if (!session || session.dayId !== dayId || session.status === 'complete' || session.status === 'idle') {
      const segments = buildLiftTimerSegments(dayWorkouts)
      if (segments.length === 0) return
      persistSession(startLiftTimerSession(dayId, segments))
      lastSegIdxRef.current = 0
      return
    }

    if (session.status === 'running') {
      persistSession(pauseLiftTimerSession(session))
      return
    }

    if (session.status === 'paused') {
      persistSession(resumeLiftTimerSession(session))
    }
  }, [dayId, dayWorkouts, persistSession, session])

  const clearTimer = useCallback(() => {
    if (session) persistSession(clearLiftTimerSession())
  }, [persistSession, session])

  const pause = useCallback(() => {
    if (session?.status === 'running') {
      persistSession(pauseLiftTimerSession(session))
    }
  }, [persistSession, session])

  const headerLabel = useMemo(() => {
    if (!session || session.dayId !== dayId || !isLiftTimerActive(session)) {
      return formatLiftTimerDuration(previewTotalMs)
    }
    void frameTick
    const elapsed = getLiftTimerLiveElapsedMs(session)
    if (displayStatus === 'complete') {
      return formatLiftTimerDuration(previewTotalMs)
    }
    return formatLiftTimerDuration(getLiftTimerRemainingMs(session, elapsed))
  }, [dayId, displayStatus, previewTotalMs, session, frameTick])

  const isPlaying = displayStatus === 'running' && session?.dayId === dayId
  const isPaused = displayStatus === 'paused' && session?.dayId === dayId
  const showControls = enabled && dayWorkouts.length > 0

  return {
    session: session?.dayId === dayId ? session : null,
    displayStatus: session?.dayId === dayId ? displayStatus : 'idle',
    liveElapsedMs: session?.dayId === dayId ? liveElapsedMs : 0,
    activeWorkoutId: session?.dayId === dayId ? activeWorkoutId : null,
    headerLabel,
    isPlaying,
    isPaused,
    showControls,
    toggle,
    pause,
    clearTimer,
    warningSeconds,
  }
}

export type LiftTimerController = ReturnType<typeof useLiftTimer>
