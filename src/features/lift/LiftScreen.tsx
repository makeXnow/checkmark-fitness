import { useCallback, useEffect, useMemo, useState } from 'react'
import { ChevronDown, Plus, Trash2 } from 'lucide-react'
import type { LiftHistoryEntry, LiftPayload, LiftSubRoute, LiftWeightUnit } from '../../types/domain'
import {
  buildGroupedSets,
  formatLogDate,
  formatWeightStr,
  getOptimalPlates,
  groupHistory,
  isNonPositiveProgressionMultiplier,
  parseStatusMultiplier,
} from './plates'

function LiftStatusSelector({
  isNegative,
  value,
  onChange,
  className = '',
  children,
}: {
  isNegative: boolean
  value: string
  onChange: (e: React.ChangeEvent<HTMLSelectElement>) => void
  className?: string
  children: React.ReactNode
}) {
  return (
    <div
      className={`relative min-w-0 rounded-lg border transition-colors duration-300 ${
        isNegative ? 'border-red-500/40 bg-red-500/10' : 'border-emerald-500/40 bg-emerald-500/10'
      } ${className}`}
    >
      <select
        className={`h-auto min-h-10 w-full cursor-pointer appearance-none bg-transparent py-2.5 pl-3 pr-9 text-left text-sm font-black leading-snug outline-none transition-colors [overflow-wrap:break-word] [word-break:normal] whitespace-normal ${
          isNegative ? 'text-red-400' : 'text-emerald-400'
        }`}
        value={value}
        onChange={onChange}
      >
        {children}
      </select>
      <ChevronDown
        className={`pointer-events-none absolute right-2 top-3 h-4 w-4 shrink-0 ${
          isNegative ? 'text-red-400' : 'text-emerald-400'
        }`}
        aria-hidden
      />
    </div>
  )
}

function FieldLabel({ children }: { children: React.ReactNode }) {
  return (
    <label className="mb-1 block text-xs font-bold uppercase tracking-wider text-neutral-400">{children}</label>
  )
}

function LiftHistoryEntryCard({
  entry,
  payload,
  onPersist,
}: {
  entry: LiftHistoryEntry
  payload: LiftPayload
  onPersist?: (next: LiftPayload) => void | Promise<void>
}) {
  const [selectResetKey, setSelectResetKey] = useState(0)
  const w = payload.workouts.find((wk) => wk.id === entry.workoutId)
  const statuses = payload.statuses || []
  const plates = payload.availablePlates || []
  const unit = payload.weightUnit ?? 'lbs'

  const logDateLabel = (() => {
    try {
      const d = new Date(entry.date)
      return Number.isNaN(d.getTime()) ? String(entry.date) : formatLogDate(d)
    } catch {
      return String(entry.date)
    }
  })()

  const statusStr = String(entry.statusName ?? statuses[0]?.name ?? '')
  const statusObj = statuses.find((s) => s.name === statusStr)
  const mVal = statusObj ? parseStatusMultiplier(statusObj.multiplier) : 1
  const isNegative = isNonPositiveProgressionMultiplier(mVal)
  const currentStatusExists = statuses.some((s) => s.name === statusStr)

  const targetWeight = entry.weight !== undefined ? entry.weight : entry.oldWeight
  const targetNext = entry.newWeight

  const displayWeight =
    w && targetWeight !== undefined
      ? getOptimalPlates(targetWeight, w.barWeight, plates).actualWeight
      : (targetWeight ?? 0)
  const displayNext =
    w && targetNext !== undefined ? getOptimalPlates(targetNext, w.barWeight, plates).actualWeight : targetNext

  return (
    <div className="relative rounded-xl border border-neutral-800 bg-neutral-900 p-5 shadow-sm">
      <h4 className="mb-3 text-lg font-bold text-white">{entry.workoutName || 'Workout'}</h4>
      <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end sm:justify-between sm:gap-3">
        <div className="flex min-w-0 flex-wrap gap-x-3 text-sm font-medium text-neutral-400">
          <span>
            {displayWeight} {unit}
          </span>
          {displayNext !== undefined && (
            <span>
              Next: {displayNext} {unit}
            </span>
          )}
        </div>
        {onPersist ? (
          <div className="min-w-0 w-full max-w-full sm:w-auto sm:max-w-[min(100%,14rem)]">
            <LiftStatusSelector
              key={`${entry.id}-${selectResetKey}`}
              isNegative={isNegative}
              value={statuses.length === 0 ? '__NONE__' : statusStr || '__NONE__'}
              onChange={(e) => {
                const v = e.target.value
                if (v === '__DELETE__') {
                  const ok = window.confirm(
                    `Remove this log entry?\n\n"${entry.workoutName || 'Workout'}" · ${logDateLabel}\n\nThis only removes the saved session from your log. It does not delete an exercise from your plan.`,
                  )
                  if (!ok) {
                    setSelectResetKey((k) => k + 1)
                    return
                  }
                  void onPersist({
                    ...payload,
                    history: (payload.history || []).filter((h) => h.id !== entry.id),
                  })
                  return
                }
                if (v === '__NONE__') {
                  void onPersist({
                    ...payload,
                    history: (payload.history || []).map((h) =>
                      h.id === entry.id ? { ...h, statusName: '' } : h,
                    ),
                  })
                  return
                }
                void onPersist({
                  ...payload,
                  history: (payload.history || []).map((h) => (h.id === entry.id ? { ...h, statusName: v } : h)),
                })
              }}
            >
              {statuses.length === 0 ? (
                <option value="__NONE__" className="bg-neutral-900 text-white">
                  —
                </option>
              ) : (
                <>
                  <option value="__NONE__" className="bg-neutral-900 text-white">
                    —
                  </option>
                  {!currentStatusExists && statusStr && (
                    <option value={statusStr} className="bg-neutral-900 text-white">
                      {statusStr}
                    </option>
                  )}
                  {statuses.map((s) => (
                    <option key={s.id} value={s.name} className="bg-neutral-900 text-white">
                      {s.name}
                    </option>
                  ))}
                </>
              )}
              <option value="__DELETE__" className="bg-red-950 text-white">
                Delete
              </option>
            </LiftStatusSelector>
          </div>
        ) : null}
      </div>
    </div>
  )
}

function makeId(prefix: string) {
  return `${prefix}${crypto.randomUUID()}`
}

export function LiftScreen({
  payload,
  subRoute,
  currentDayIndex,
  onDayIndexChange,
  view,
  onPersist,
  onSeeAllLog,
}: {
  payload: LiftPayload
  subRoute: LiftSubRoute
  currentDayIndex: number
  onDayIndexChange: (idx: number) => void
  view: 'tracker' | 'settings'
  onPersist?: (next: LiftPayload) => void | Promise<void>
  /** Shown on workout view above the day log preview; navigates to full log. */
  onSeeAllLog?: () => void
}) {
  const sortedDays = useMemo(
    () => [...payload.days].sort((a, b) => (a.order || 0) - (b.order || 0)),
    [payload.days],
  )
  const currentDay = sortedDays[currentDayIndex]
  const statuses = payload.statuses || []
  const weightUnit = payload.weightUnit ?? 'lbs'
  const plateUnit = payload.plateUnit ?? 'lbs'

  const [workoutStatusById, setWorkoutStatusById] = useState<Record<string, string>>({})
  const [newPlateInput, setNewPlateInput] = useState('')

  useEffect(() => {
    setWorkoutStatusById({})
  }, [currentDayIndex])

  const persist = useCallback(
    (next: LiftPayload) => {
      if (onPersist) void onPersist(next)
    },
    [onPersist],
  )

  const todaysWorkouts = useMemo(
    () => payload.workouts.filter((w) => w.dayId === currentDay?.id),
    [payload.workouts, currentDay?.id],
  )

  const logGroups = useMemo(
    () => groupHistory(payload.history || [], sortedDays, payload.workouts),
    [payload.history, sortedDays, payload.workouts],
  )

  const currentDayHistory = useMemo(() => {
    if (!currentDay) return []
    return (payload.history || []).filter((h) => {
      const w = payload.workouts.find((wk) => wk.id === h.workoutId)
      return Boolean(w && w.dayId === currentDay.id)
    })
  }, [payload.history, payload.workouts, currentDay?.id])

  const dayLogGroups = useMemo(
    () => groupHistory(currentDayHistory, sortedDays, payload.workouts, { dateOnly: true }),
    [currentDayHistory, sortedDays, payload.workouts],
  )

  const effectiveStatusId = useCallback(
    (workoutId: string) => {
      const fallback = statuses[0]?.id ?? ''
      const chosen = workoutStatusById[workoutId]
      if (chosen && statuses.some((s) => s.id === chosen)) return chosen
      return fallback
    },
    [statuses, workoutStatusById],
  )

  const submitWorkoutDay = useCallback(() => {
    if (!onPersist || !currentDay) return
    const today = new Date().toISOString().slice(0, 10)
    const nextHistory = [...(payload.history || [])]
    const twIds = new Set(todaysWorkouts.map((x) => x.id))
    const nextWorkouts = payload.workouts.map((w) => {
      if (!twIds.has(w.id)) return w
      const sid = effectiveStatusId(w.id)
      const status = statuses.find((s) => s.id === sid) ?? statuses[0]
      const mult = parseStatusMultiplier(status?.multiplier)
      const inc = w.increment || 0
      const newWeight = Math.max(0, w.mainWeight + inc * mult)
      nextHistory.push({
        id: crypto.randomUUID(),
        workoutId: w.id,
        workoutName: w.name,
        date: today,
        weight: w.mainWeight,
        oldWeight: w.mainWeight,
        newWeight,
        statusName: status?.name ?? '',
      })
      return { ...w, mainWeight: newWeight }
    })
    void onPersist({
      ...payload,
      history: nextHistory,
      workouts: nextWorkouts,
    })
    setWorkoutStatusById({})
    onDayIndexChange((currentDayIndex + 1) % Math.max(1, sortedDays.length))
  }, [
    currentDay,
    currentDayIndex,
    effectiveStatusId,
    onDayIndexChange,
    onPersist,
    payload,
    sortedDays.length,
    statuses,
    todaysWorkouts,
  ])

  if (view === 'settings') {
    return (
      <div className="space-y-6">
        <div className="rounded-xl border border-neutral-800 bg-neutral-900 p-5">
          <h3 className="mb-5 text-lg font-black uppercase tracking-tight text-white">Units</h3>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <FieldLabel>Weight</FieldLabel>
              <div className="relative rounded-lg border border-neutral-700 bg-black">
                <select
                  className="w-full cursor-pointer appearance-none bg-transparent p-3 font-bold text-white outline-none"
                  value={weightUnit}
                  disabled={!onPersist}
                  onChange={(e) =>
                    persist({ ...payload, weightUnit: e.target.value as LiftWeightUnit })
                  }
                >
                  <option value="lbs">lbs</option>
                  <option value="kg">kg</option>
                </select>
                <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-neutral-500" />
              </div>
            </div>
            <div>
              <FieldLabel>Plate labels</FieldLabel>
              <div className="relative rounded-lg border border-neutral-700 bg-black">
                <select
                  className="w-full cursor-pointer appearance-none bg-transparent p-3 font-bold text-white outline-none"
                  value={plateUnit}
                  disabled={!onPersist}
                  onChange={(e) =>
                    persist({ ...payload, plateUnit: e.target.value as LiftWeightUnit })
                  }
                >
                  <option value="lbs">lbs</option>
                  <option value="kg">kg</option>
                </select>
                <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-neutral-500" />
              </div>
            </div>
          </div>
        </div>

        <div className="rounded-xl border border-neutral-800 bg-neutral-900 p-5">
          <h3 className="mb-4 text-lg font-black uppercase tracking-tight text-white">Plate rack</h3>
          <div className="mb-5 flex gap-2">
            <input
              type="number"
              step="any"
              value={newPlateInput}
              onChange={(e) => setNewPlateInput(e.target.value)}
              placeholder="Add plate (e.g. 2.5)"
              disabled={!onPersist}
              className="min-w-0 flex-1 rounded-lg border border-neutral-700 bg-black p-3 text-sm font-bold text-white outline-none focus:border-emerald-400 placeholder:text-neutral-600"
            />
            <button
              type="button"
              disabled={!onPersist}
              onClick={() => {
                const val = parseFloat(newPlateInput)
                const list = [...(payload.availablePlates || [])]
                if (!Number.isFinite(val) || val <= 0 || list.includes(val)) {
                  setNewPlateInput('')
                  return
                }
                list.push(val)
                list.sort((a, b) => b - a)
                setNewPlateInput('')
                persist({ ...payload, availablePlates: list })
              }}
              className="flex shrink-0 items-center justify-center gap-1 rounded-lg bg-emerald-400 px-4 py-2 text-xs font-black uppercase tracking-widest text-black transition-colors hover:bg-emerald-300 disabled:opacity-40"
            >
              <Plus className="h-4 w-4" /> Add
            </button>
          </div>
          <div className="space-y-3">
            {(payload.availablePlates || []).map((p) => (
              <div
                key={p}
                className="flex items-center justify-between rounded-xl border border-neutral-800 bg-black p-4"
              >
                <span className="font-black text-white">
                  {formatWeightStr(p)} {plateUnit}
                </span>
                <button
                  type="button"
                  disabled={!onPersist}
                  onClick={() =>
                    persist({
                      ...payload,
                      availablePlates: (payload.availablePlates || []).filter((x) => x !== p),
                    })
                  }
                  className="text-red-900 transition-colors hover:text-red-500 disabled:opacity-40"
                  aria-label={`Remove ${p}`}
                >
                  <Trash2 className="h-5 w-5" />
                </button>
              </div>
            ))}
          </div>
        </div>

        <div className="rounded-xl border border-neutral-800 bg-neutral-900 p-5">
          <h3 className="mb-5 text-lg font-black uppercase tracking-tight text-white">Progression multipliers</h3>
          <p className="mb-4 text-xs text-neutral-500">
            Next weight = current + (increment × multiplier). ≤0 shows red on workout and log cards.
          </p>
          <div className="mb-5 space-y-3">
            {statuses.map((status) => (
              <div key={status.id} className="flex gap-2 items-center">
                <div className="flex flex-1 items-center rounded-lg border border-neutral-800 bg-black px-3 py-1 transition-colors focus-within:border-emerald-400">
                  <input
                    type="text"
                    value={status.name}
                    disabled={!onPersist}
                    onChange={(e) =>
                      persist({
                        ...payload,
                        statuses: statuses.map((s) =>
                          s.id === status.id ? { ...s, name: e.target.value } : s,
                        ),
                      })
                    }
                    className="w-full bg-transparent py-2 text-sm font-bold text-white outline-none"
                    placeholder="Name"
                  />
                </div>
                <div className="flex w-24 items-center rounded-lg border border-neutral-800 bg-black px-2 py-1 transition-colors focus-within:border-emerald-400">
                  <span className="mr-1 text-xs font-bold text-neutral-500">×</span>
                  <input
                    type="number"
                    step="any"
                    value={status.multiplier}
                    disabled={!onPersist}
                    onChange={(e) =>
                      persist({
                        ...payload,
                        statuses: statuses.map((s) =>
                          s.id === status.id ? { ...s, multiplier: e.target.value } : s,
                        ),
                      })
                    }
                    className="w-full bg-transparent py-2 text-center text-sm font-bold text-white outline-none placeholder:text-neutral-700"
                    placeholder="1"
                  />
                </div>
                <button
                  type="button"
                  disabled={!onPersist}
                  onClick={() =>
                    persist({
                      ...payload,
                      statuses: statuses.filter((s) => s.id !== status.id),
                    })
                  }
                  className="shrink-0 p-2 text-red-900 transition-colors hover:text-red-500 disabled:opacity-40"
                  aria-label="Remove status"
                >
                  <Trash2 className="h-5 w-5" />
                </button>
              </div>
            ))}
          </div>
          <button
            type="button"
            disabled={!onPersist}
            onClick={() =>
              persist({
                ...payload,
                statuses: [...statuses, { id: makeId('s_'), name: 'New status', multiplier: 1 }],
              })
            }
            className="flex w-full items-center justify-center gap-1 rounded-lg bg-emerald-400 px-4 py-3 text-xs font-black uppercase tracking-widest text-black transition-colors hover:bg-emerald-300 disabled:opacity-40"
          >
            <Plus className="h-4 w-4" /> Add status
          </button>
        </div>
      </div>
    )
  }

  if (subRoute === 'plan') {
    return (
      <div className="space-y-8">
        {sortedDays.length === 0 ? (
          <p className="py-12 text-center text-neutral-500">No plan yet.</p>
        ) : (
          sortedDays.map((day) => (
            <div key={day.id}>
              <h2 className="mb-4 text-2xl font-black uppercase tracking-tight text-white">{day.name}</h2>
              <div className="space-y-4">
                {payload.workouts
                  .filter((w) => w.dayId === day.id)
                  .map((w) => (
                    <div key={w.id} className="rounded-xl border border-neutral-800 bg-neutral-900 p-4">
                      <div className="mb-1 flex items-start justify-between">
                        <h4 className="text-lg font-bold text-white">{w.name}</h4>
                        <span className="text-sm font-bold text-emerald-400">+{w.increment}</span>
                      </div>
                      <p className="mb-2 text-sm font-medium text-neutral-400">
                        {w.reps} reps • {w.barWeight} {weightUnit} bar • {w.mainWeight} {weightUnit} target
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
    if (logGroups.length === 0) {
      return (
        <div className="p-12 text-center text-neutral-500">
          <p>No logged sessions yet.</p>
        </div>
      )
    }
    return (
      <div className="space-y-8">
        {logGroups.map((group, idx) => (
          <div key={idx}>
            <div className="mb-4 flex items-baseline justify-between">
              <h2 className="text-xl font-bold text-neutral-300">{group.dateStr}</h2>
              <span className="text-sm font-bold uppercase tracking-widest text-neutral-300">{group.dayName}</span>
            </div>
            <div className="space-y-4">
              {group.entries.map((entry) => (
                <LiftHistoryEntryCard key={entry.id} entry={entry} payload={payload} onPersist={onPersist} />
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
      <div className="flex flex-col items-center justify-center p-12 py-24 text-center text-neutral-500">
        <p className="text-lg font-bold">No plan created yet.</p>
      </div>
    )
  }

  if (todaysWorkouts.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center p-12 py-24 text-center text-neutral-500">
        <p className="text-lg font-bold">No workouts for {currentDay.name}.</p>
      </div>
    )
  }

  let runningSetNum = 1
  return (
    <div className="space-y-6 pb-4">
      {todaysWorkouts.map((workout) => {
        const { groupedSets, nextSetNum } = buildGroupedSets(
          workout,
          payload.availablePlates || [],
          runningSetNum,
        )
        runningSetNum = nextSetNum
        const sid = effectiveStatusId(workout.id)
        const currentStatus = statuses.find((s) => s.id === sid) ?? statuses[0]
        const mVal = parseStatusMultiplier(currentStatus?.multiplier)
        const isNeg = isNonPositiveProgressionMultiplier(mVal)

        return (
          <div key={workout.id} className="rounded-xl border border-neutral-800 bg-neutral-900 p-5 shadow-md">
            <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-3">
              <h3 className="min-w-0 flex-1 text-xl font-bold leading-tight text-white [overflow-wrap:break-word] [word-break:normal]">
                {workout.name}
              </h3>
              {statuses.length > 0 ? (
                <LiftStatusSelector
                  className="w-full min-w-0 sm:w-auto sm:max-w-[min(100%,12rem)]"
                  isNegative={isNeg}
                  value={sid}
                  onChange={(e) =>
                    setWorkoutStatusById((prev) => ({ ...prev, [workout.id]: e.target.value }))
                  }
                >
                  {statuses.map((s) => (
                    <option key={s.id} value={s.id} className="bg-neutral-900 text-white">
                      {s.name}
                    </option>
                  ))}
                </LiftStatusSelector>
              ) : (
                <span className="shrink-0 text-[10px] font-bold uppercase tracking-widest text-neutral-500">
                  Add statuses in settings
                </span>
              )}
            </div>
            <div>
              {groupedSets.map((set, idx) => {
                const setRangeLabel =
                  set.startNum === set.endNum ? `${set.startNum}` : `${set.startNum}-${set.endNum}`
                return (
                  <div key={idx} className="mb-3 flex flex-col overflow-hidden rounded-2xl shadow-sm">
                    <div
                      className={`${
                        set.isWarmup ? 'bg-emerald-100' : 'bg-emerald-300'
                      } relative flex min-h-[72px] items-center justify-center`}
                    >
                      <div className="flex flex-wrap items-center justify-center px-4 py-3">
                        {set.plates.length > 0 ? (
                          set.plates.map((p, i) => (
                            <span
                              key={i}
                              className="mr-4 font-black text-[36px] tracking-tighter text-black last:mr-0 sm:text-[42px]"
                            >
                              {formatWeightStr(p.weight)}
                              {p.count > 1 && (
                                <sub className="ml-0.5 text-[18px] font-bold tracking-normal text-emerald-800">
                                  {p.count}
                                </sub>
                              )}
                            </span>
                          ))
                        ) : (
                          <span className="text-[28px] font-black uppercase text-black">Bar only</span>
                        )}
                      </div>
                    </div>
                    <div
                      className={`${
                        set.isWarmup ? 'bg-emerald-400' : 'bg-emerald-700'
                      } flex items-center justify-between px-5 py-2 text-xs font-bold uppercase tracking-[0.15em] text-emerald-100`}
                    >
                      <span className="w-1/3 text-left opacity-95">
                        {set.isWarmup ? 'Set ' : 'Sets '}
                        {setRangeLabel}
                      </span>
                      <span className="w-1/3 text-center opacity-95">
                        {set.actualWeight} {weightUnit}
                      </span>
                      <span className="w-1/3 text-right opacity-95">{set.reps} reps</span>
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
          className="mt-2 w-full rounded-xl bg-emerald-400 px-4 py-4 text-sm font-black uppercase tracking-[0.2em] text-black shadow-lg transition-colors hover:bg-emerald-300 active:scale-[0.99]"
          onClick={submitWorkoutDay}
        >
          Submit
        </button>
      )}

      {onSeeAllLog && (
        <div className="mt-12 border-t border-neutral-800 pt-8">
          <div className="mb-6 flex items-center justify-between gap-4">
            <h2 className="text-lg font-black uppercase tracking-tight text-white">Log</h2>
            <button
              type="button"
              onClick={onSeeAllLog}
              className="shrink-0 font-black text-[10px] uppercase tracking-[0.2em] text-emerald-400 transition-colors hover:text-emerald-300"
            >
              SEE ALL
            </button>
          </div>
          {dayLogGroups.length > 0 ? (
            <div className="space-y-8">
              {dayLogGroups.map((group, idx) => (
                <div key={idx}>
                  <h3 className="mb-4 text-xl font-bold text-neutral-300">{group.dateStr}</h3>
                  <div className="space-y-4">
                    {group.entries.map((entry) => (
                      <LiftHistoryEntryCard key={entry.id} entry={entry} payload={payload} onPersist={onPersist} />
                    ))}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-neutral-500">No entries for this day yet.</p>
          )}
        </div>
      )}
    </div>
  )
}
