import { useEffect } from 'react'
import { closeLiftSession, openLiftSession } from '../../core/api'
import { localDateISO } from '../../lib/localDate'
import type { LiftSubRoute } from '../../types/domain'

/** Tell the backend when a workout day screen is open; 10s dwell is counted on close. */
export function useLiftOpenSession(
  enabled: boolean,
  dayId: string | undefined,
  subRoute: LiftSubRoute,
  view: 'tracker' | 'settings',
) {
  useEffect(() => {
    if (!enabled || view !== 'tracker' || subRoute !== 'workout' || !dayId) return

    const localDate = localDateISO(new Date())
    void openLiftSession({ dayId, localDate })

    return () => {
      void closeLiftSession({ dayId, localDate })
    }
  }, [enabled, dayId, subRoute, view])
}
