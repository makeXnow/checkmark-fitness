import { useMemo } from 'react'
import type { LiftPayload, LiftSubRoute } from '../../types/domain'
import { buildGroupedSets, formatWeightStr, groupHistory } from './plates'

export function LiftScreen({
  payload,
  subRoute,
  currentDayIndex,
  onDayIndexChange,
  view,
  onPersist,
}: {
  payload: LiftPayload
  subRoute: LiftSubRoute
  currentDayIndex: number
  onDayIndexChange: (idx: number) => void
  view: 'tracker' | 'settings'
  onPersist?: (next: LiftPayload) => void | Promise<void>
}) {
  const sortedDays = useMemo(
    () => [...payload.days].sort((a, b) => (a.order || 0) - (b.order || 0)),
    [payload.days],
  )
  const currentDay = sortedDays[currentDayIndex]

  const todaysWorkouts = useMemo(
    () => payload.workouts.filter((w) => w.dayId === currentDay?.id),
    [payload.workouts, currentDay?.id],
  )

  if (view === 'settings') {
    return (
      <div className="space-y-6">
        <div className="bg-neutral-900 rounded-xl p-5 border border-neutral-800">
          <h3 className="text-lg font-black mb-4 uppercase tracking-tight text-white">Plate Rack</h3>
          <div className="space-y-2">
            {(payload.availablePlates || []).map((p) => (
              <div key={p} className="flex justify-between bg-black p-4 rounded-xl border border-neutral-800">
                <span className="font-black text-white">{formatWeightStr(p)} lbs</span>
              </div>
            ))}
          </div>
          <p className="text-[10px] text-neutral-500 mt-4 uppercase tracking-widest">
            Editing plates and units will use the same persistence pipeline next.
          </p>
        </div>

        <div className="bg-neutral-900 rounded-xl p-5 border border-neutral-800">
          <h3 className="text-lg font-black mb-4 uppercase tracking-tight text-white">Progression Multipliers</h3>
          <div className="space-y-2">
            {(payload.statuses || []).map((s) => (
              <div key={s.id} className="flex justify-between text-sm text-white font-bold">
                <span>{s.name}</span>
                <span className="text-emerald-400">×{s.multiplier}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    )
  }

  if (subRoute === 'plan') {
    return (
      <div className="space-y-8">
        {sortedDays.length === 0 ? (
          <p className="text-neutral-500 text-center py-12">No plan yet.</p>
        ) : (
          sortedDays.map((day) => (
            <div key={day.id}>
              <h2 className="text-2xl font-black text-white uppercase tracking-tight mb-4">{day.name}</h2>
              <div className="space-y-4">
                {payload.workouts
                  .filter((w) => w.dayId === day.id)
                  .map((w) => (
                    <div key={w.id} className="bg-neutral-900 rounded-xl p-4 border border-neutral-800">
                      <div className="flex justify-between items-start mb-1">
                        <h4 className="font-bold text-white text-lg">{w.name}</h4>
                        <span className="text-emerald-400 text-sm font-bold">+{w.increment}lbs</span>
                      </div>
                      <p className="text-sm text-neutral-400 mb-2 font-medium">
                        {w.reps} reps • {w.barWeight}lbs bar • {w.mainWeight} lbs target
                      </p>
                    </div>
                  ))}
              </div>
            </div>
          ))
        )}
      </div>
    )
  }

  if (subRoute === 'log') {
    const groups = groupHistory(payload.history || [], sortedDays, payload.workouts)
    if (groups.length === 0) {
      return (
        <div className="text-center p-12 text-neutral-500">
          <p>No logged sessions yet.</p>
        </div>
      )
    }
    return (
      <div className="space-y-8">
        {groups.map((group, idx) => (
          <div key={idx}>
            <div className="flex justify-between items-baseline mb-4">
              <h2 className="text-xl font-bold text-neutral-300">{group.dateStr}</h2>
              <span className="text-sm font-bold text-neutral-300 uppercase tracking-widest">{group.dayName}</span>
            </div>
            <div className="space-y-4">
              {group.entries.map((entry) => (
                <div key={entry.id} className="bg-neutral-900 rounded-xl p-5 border border-neutral-800">
                  <h4 className="font-bold text-white text-lg mb-2">{entry.workoutName || 'Workout'}</h4>
                  <div className="text-sm text-neutral-400 flex flex-wrap gap-x-3">
                    <span>{entry.weight ?? entry.oldWeight ?? 0} lbs</span>
                    {entry.newWeight !== undefined && <span>Next: {entry.newWeight} lbs</span>}
                    {entry.statusName && <span className="text-emerald-400">{entry.statusName}</span>}
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    )
  }

  // workout
  if (sortedDays.length === 0 || !currentDay) {
    return (
      <div className="flex flex-col items-center justify-center p-12 py-24 text-neutral-500 text-center">
        <p className="text-lg font-bold">No plan created yet.</p>
      </div>
    )
  }

  if (todaysWorkouts.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center p-12 py-24 text-neutral-500 text-center">
        <p className="text-lg font-bold">No workouts for {currentDay.name}.</p>
      </div>
    )
  }

  let runningSetNum = 1
  return (
    <div className="space-y-6">
      {todaysWorkouts.map((workout) => {
        const { groupedSets, nextSetNum } = buildGroupedSets(workout, payload.availablePlates || [], runningSetNum)
        runningSetNum = nextSetNum
        return (
          <div key={workout.id} className="bg-neutral-900 rounded-xl p-5 border border-neutral-800 shadow-md">
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-xl font-bold text-white max-w-[60%] leading-tight">{workout.name}</h3>
            </div>
            <div>
              {groupedSets.map((set, idx) => {
                const setRangeLabel = set.startNum === set.endNum ? `${set.startNum}` : `${set.startNum}-${set.endNum}`
                return (
                  <div key={idx} className="flex flex-col rounded-2xl mb-3 shadow-sm overflow-hidden">
                    <div
                      className={`${set.isWarmup ? 'bg-emerald-100' : 'bg-emerald-300'} flex items-center justify-center relative min-h-[72px]`}
                    >
                      <div className="flex items-center justify-center py-3 px-4 flex-wrap">
                        {set.plates.length > 0 ? (
                          set.plates.map((p, i) => (
                            <span
                              key={i}
                              className="font-black text-[36px] sm:text-[42px] text-black mr-4 last:mr-0 tracking-tighter leading-none"
                            >
                              {formatWeightStr(p.weight)}
                              {p.count > 1 && (
                                <sub className="text-[18px] font-bold tracking-normal ml-0.5 bottom-0 text-emerald-800">
                                  {p.count}
                                </sub>
                              )}
                            </span>
                          ))
                        ) : (
                          <span className="font-black text-[28px] text-black uppercase">Bar Only</span>
                        )}
                      </div>
                    </div>
                    <div
                      className={`${set.isWarmup ? 'bg-emerald-400' : 'bg-emerald-700'} px-5 py-2 flex justify-between items-center text-emerald-100 text-xs font-bold tracking-[0.15em] uppercase`}
                    >
                      <span className="w-1/3 text-left opacity-95">{set.isWarmup ? 'Set ' : 'Sets '}{setRangeLabel}</span>
                      <span className="w-1/3 text-center opacity-95">{set.actualWeight} lbs</span>
                      <span className="w-1/3 text-right opacity-95">{set.reps} Reps</span>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        )
      })}
      {onPersist && todaysWorkouts.length > 0 && (
        <button
          type="button"
          className="w-full py-4 rounded-2xl bg-emerald-600 text-white font-black uppercase tracking-widest text-xs shadow-lg active:scale-[0.98] transition-transform"
          onClick={() => {
            const today = new Date().toISOString().slice(0, 10)
            const nextHistory = [...(payload.history || [])]
            const twIds = new Set(todaysWorkouts.map((x) => x.id))
            for (const w of todaysWorkouts) {
              nextHistory.push({
                id: crypto.randomUUID(),
                workoutId: w.id,
                workoutName: w.name,
                date: today,
                weight: w.mainWeight,
                oldWeight: w.mainWeight,
                newWeight: w.mainWeight + w.increment,
                statusName: 'Progression',
              })
            }
            const nextWorkouts = payload.workouts.map((w) =>
              twIds.has(w.id) ? { ...w, mainWeight: w.mainWeight + w.increment } : w,
            )
            void onPersist({
              ...payload,
              history: nextHistory,
              workouts: nextWorkouts,
            })
            onDayIndexChange((currentDayIndex + 1) % sortedDays.length)
          }}
        >
          Log workout & next day
        </button>
      )}
    </div>
  )
}
