import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ChevronDown, FileText, Pencil, Plus, Trash2, X } from 'lucide-react'
import { AppAccentTextButton } from '../../core/AppAccentTextButton'
import { localDateISO } from '../../lib/localDate'
import type { LiftHistoryEntry, LiftPayload, LiftSubRoute, LiftWeightUnit } from '../../types/domain'
import { LiftPlanTab } from './LiftPlanTab'
import {
  buildGroupedSets,
  formatLogDate,
  formatProgressDelta,
  formatWeightStr,
  getNextLiftWeight,
  getOptimalPlates,
  getProgressDelta,
  groupHistory,
  isNonPositiveProgressionMultiplier,
  nextDayIndexFromHistory,
  parseStatusMultiplier,
} from './plates'

function AutoResizeTextarea({
  value,
  onChange,
  placeholder,
  className,
  disabled,
}: {
  value: string
  onChange: (e: React.ChangeEvent<HTMLTextAreaElement>) => void
  placeholder: string
  className?: string
  disabled?: boolean
}) {
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  useEffect(() => {
    const el = textareaRef.current
    if (el) {
      el.style.height = 'auto'
      el.style.height = `${el.scrollHeight}px`
    }
  }, [value])
  return (
    <textarea
      ref={textareaRef}
      value={value}
      onChange={onChange}
      placeholder={placeholder}
      disabled={disabled}
      rows={1}
      className={`resize-none overflow-hidden ${className ?? ''}`}
    />
  )
}

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

type LiftLogDayGroup = {
  dayName: string
  dateStr: string
  entries: LiftHistoryEntry[]
}

function historyEntryToDateInput(iso: string): string {
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '' : localDateISO(d)
}

function applyDateInputToEntry(iso: string, dateInput: string): string {
  const old = new Date(iso)
  const [y, m, day] = dateInput.split('-').map((x) => parseInt(x, 10))
  if (!y || !m || !day) return iso
  const merged = new Date(y, m - 1, day, old.getHours(), old.getMinutes(), old.getSeconds(), old.getMilliseconds())
  return merged.toISOString()
}

function LiftLogDayCard({
  group,
  payload,
  onPersist,
  showDayName = true,
}: {
  group: LiftLogDayGroup
  payload: LiftPayload
  onPersist?: (next: LiftPayload) => void | Promise<void>
  /** When false (workout tab preview), only the date is shown in the cap. */
  showDayName?: boolean
}) {
  const [isEditing, setIsEditing] = useState(false)
  const [draftDate, setDraftDate] = useState('')
  const [draftById, setDraftById] = useState<Record<string, LiftHistoryEntry>>({})

  const openEdit = () => {
    const first = group.entries[0]
    setDraftDate(first ? historyEntryToDateInput(first.date) : localDateISO(new Date()))
    setDraftById(Object.fromEntries(group.entries.map((e) => [e.id, { ...e }])))
    setIsEditing(true)
  }

  const cancelEdit = () => {
    setIsEditing(false)
    setDraftById({})
  }

  const saveEdit = () => {
    if (!onPersist || !draftDate) {
      setIsEditing(false)
      return
    }
    const ids = new Set(group.entries.map((e) => e.id))
    void onPersist({
      ...payload,
      history: (payload.history || []).map((h) => {
        if (!ids.has(h.id)) return h
        const draft = draftById[h.id]
        if (!draft) return h
        return {
          ...h,
          date: applyDateInputToEntry(h.date, draftDate),
          workoutName: draft.workoutName,
          weight: draft.weight,
          oldWeight: draft.oldWeight,
          newWeight: draft.newWeight,
          statusName: draft.statusName,
        }
      }),
    })
    setIsEditing(false)
  }

  const statuses = payload.statuses || []

  return (
    <div className="box-border w-full min-w-0 max-w-full overflow-hidden rounded-xl border border-neutral-800 bg-neutral-900 shadow-sm">
      <div className="relative flex w-full min-w-0 items-center justify-between gap-3 border-b border-neutral-800 bg-neutral-800 py-3 pl-4 pr-12 text-neutral-200">
        <span className="min-w-0 flex-1 truncate text-left text-base font-bold leading-snug">
          {group.dateStr}
        </span>
        {showDayName ? (
          <span className="max-w-[40%] shrink-0 truncate text-right text-[10px] font-bold uppercase tracking-widest text-neutral-400">
            {group.dayName}
          </span>
        ) : null}
        {onPersist && !isEditing ? (
          <button
            type="button"
            onClick={openEdit}
            className="absolute right-2 top-1/2 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-lg text-neutral-400 transition-colors hover:bg-neutral-700 hover:text-white"
            aria-label={`Edit log for ${group.dateStr}`}
          >
            <Pencil className="h-4 w-4" aria-hidden />
          </button>
        ) : null}
      </div>

      <div className="min-w-0 space-y-4 p-4">
        {isEditing ? (
          <>
            <div>
              <FieldLabel>Date</FieldLabel>
              <input
                type="date"
                value={draftDate}
                onChange={(e) => setDraftDate(e.target.value)}
                className="w-full rounded-lg border border-neutral-700 bg-black p-3 text-sm font-bold text-white outline-none focus:border-emerald-400"
              />
            </div>
            {group.entries.map((entry) => {
              const draft = draftById[entry.id] ?? entry
              const unit = payload.weightUnit ?? 'lbs'
              return (
                <div key={entry.id} className="min-w-0 space-y-3 rounded-lg border border-neutral-800 bg-black/40 p-3">
                  <div className="min-w-0">
                    <FieldLabel>Exercise</FieldLabel>
                    <input
                      type="text"
                      value={draft.workoutName ?? ''}
                      onChange={(e) =>
                        setDraftById((prev) => ({
                          ...prev,
                          [entry.id]: { ...draft, workoutName: e.target.value },
                        }))
                      }
                      className="w-full max-w-full rounded-lg border border-neutral-700 bg-black p-3 text-sm font-bold text-white outline-none focus:border-emerald-400"
                    />
                  </div>
                  <div className="grid min-w-0 grid-cols-2 gap-3">
                    <div className="min-w-0">
                      <FieldLabel>Weight ({unit})</FieldLabel>
                      <input
                        type="number"
                        step="any"
                        value={draft.weight ?? draft.oldWeight ?? ''}
                        onChange={(e) => {
                          const v = parseFloat(e.target.value)
                          setDraftById((prev) => ({
                            ...prev,
                            [entry.id]: {
                              ...draft,
                              weight: Number.isFinite(v) ? v : undefined,
                              oldWeight: Number.isFinite(v) ? v : draft.oldWeight,
                            },
                          }))
                        }}
                        className="w-full max-w-full rounded-lg border border-neutral-700 bg-black p-3 text-sm font-bold text-white outline-none focus:border-emerald-400"
                      />
                    </div>
                    <div className="min-w-0">
                      <FieldLabel>Next ({unit})</FieldLabel>
                      <input
                        type="number"
                        step="any"
                        value={draft.newWeight ?? ''}
                        onChange={(e) => {
                          const v = parseFloat(e.target.value)
                          setDraftById((prev) => ({
                            ...prev,
                            [entry.id]: {
                              ...draft,
                              newWeight: Number.isFinite(v) ? v : undefined,
                            },
                          }))
                        }}
                        className="w-full max-w-full rounded-lg border border-neutral-700 bg-black p-3 text-sm font-bold text-white outline-none focus:border-emerald-400"
                      />
                    </div>
                  </div>
                  {statuses.length > 0 ? (
                    <div>
                      <FieldLabel>Status</FieldLabel>
                      <div className="relative rounded-lg border border-neutral-700 bg-black">
                        <select
                          className="w-full cursor-pointer appearance-none bg-transparent p-3 text-sm font-bold text-white outline-none"
                          value={draft.statusName ?? ''}
                          onChange={(e) =>
                            setDraftById((prev) => ({
                              ...prev,
                              [entry.id]: { ...draft, statusName: e.target.value },
                            }))
                          }
                        >
                          <option value="" className="bg-neutral-900">
                            —
                          </option>
                          {statuses.map((s) => (
                            <option key={s.id} value={s.name} className="bg-neutral-900">
                              {s.name}
                            </option>
                          ))}
                        </select>
                        <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-neutral-500" />
                      </div>
                    </div>
                  ) : null}
                </div>
              )
            })}
            <div className="flex gap-3">
              <button
                type="button"
                onClick={cancelEdit}
                className="flex flex-1 items-center justify-center rounded-lg border border-neutral-700 px-4 py-3 text-xs font-black uppercase tracking-widest text-neutral-400 transition-colors hover:border-neutral-600 hover:text-neutral-200"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={!onPersist || !draftDate}
                onClick={saveEdit}
                className="flex flex-1 items-center justify-center rounded-lg bg-emerald-400 px-4 py-3 text-xs font-black uppercase tracking-widest text-black transition-colors hover:bg-emerald-300 disabled:opacity-40"
              >
                Save
              </button>
            </div>
          </>
        ) : (
          group.entries.map((entry) => (
            <LiftHistoryEntryCard
              key={entry.id}
              entry={entry}
              payload={payload}
              onPersist={onPersist}
              nested
            />
          ))
        )}
      </div>
    </div>
  )
}

function LiftHistoryEntryCard({
  entry,
  payload,
  onPersist,
  nested = false,
}: {
  entry: LiftHistoryEntry
  payload: LiftPayload
  onPersist?: (next: LiftPayload) => void | Promise<void>
  nested?: boolean
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
    <div
      className={
        nested
          ? 'w-full min-w-0 max-w-full border-t border-neutral-800 pt-4 first:border-t-0 first:pt-0'
          : 'relative box-border w-full min-w-0 max-w-full rounded-xl border border-neutral-800 bg-neutral-900 p-4 shadow-sm'
      }
    >
      <h4 className="mb-3 min-w-0 truncate text-lg font-bold text-white">{entry.workoutName || 'Workout'}</h4>
      <div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end sm:justify-between sm:gap-3">
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

const LIFT_WORKOUT_ANIM_MS = 1500

function WorkoutDayTransition({
  dayIndex,
  children,
}: {
  dayIndex: number
  children: (activeIndex: number) => React.ReactNode
}) {
  const [shownIndex, setShownIndex] = useState(dayIndex)
  const [fromIndex, setFromIndex] = useState(dayIndex)
  const [isSwapping, setIsSwapping] = useState(false)

  useEffect(() => {
    if (dayIndex === shownIndex && !isSwapping) return

    if (!isSwapping) {
      setFromIndex(shownIndex)
      setIsSwapping(true)
    }
  }, [dayIndex, shownIndex, isSwapping])

  useEffect(() => {
    if (!isSwapping) return
    const id = window.setTimeout(() => {
      setShownIndex(dayIndex)
      setFromIndex(dayIndex)
      setIsSwapping(false)
    }, LIFT_WORKOUT_ANIM_MS)
    return () => window.clearTimeout(id)
  }, [isSwapping, dayIndex])

  useEffect(() => {
    const root = document.documentElement
    if (isSwapping) {
      root.classList.add('lift-workout-swapping')
      return () => root.classList.remove('lift-workout-swapping')
    }
    root.classList.remove('lift-workout-swapping')
  }, [isSwapping])

  if (isSwapping) {
    return (
      <div className="lift-workout-transition-root w-full min-w-0 max-w-full">
        <div
          className="lift-workout-layer lift-workout-layer-exit-right w-full min-w-0 space-y-5 pb-4"
          aria-hidden
        >
          {children(fromIndex)}
        </div>
        <div className="lift-workout-layer lift-workout-layer-enter-from-left w-full min-w-0 space-y-5 pb-4">
          {children(dayIndex)}
        </div>
      </div>
    )
  }

  return (
    <div className="lift-workout-transition-root w-full min-w-0 max-w-full">
      <div className="w-full min-w-0 space-y-5 pb-4">{children(shownIndex)}</div>
    </div>
  )
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
  const [openNotesByWorkoutId, setOpenNotesByWorkoutId] = useState<Record<string, boolean>>({})
  const [editingWeightWorkoutId, setEditingWeightWorkoutId] = useState<string | null>(null)
  const [tempMainWeight, setTempMainWeight] = useState('')

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
        date: new Date().toISOString(),
        weight: w.mainWeight,
        oldWeight: w.mainWeight,
        newWeight,
        statusName: status?.name ?? '',
      })
      return { ...w, mainWeight: newWeight }
    })
    const combinedHistory = nextHistory
    void onPersist({
      ...payload,
      history: combinedHistory,
      workouts: nextWorkouts,
    })
    setWorkoutStatusById({})
    onDayIndexChange(nextDayIndexFromHistory(payload.days, nextWorkouts, combinedHistory))
  }, [currentDay, effectiveStatusId, onDayIndexChange, onPersist, payload, statuses, todaysWorkouts])

  if (view === 'settings') {
    return (
      <div className="space-y-5">
        <div className="rounded-xl border border-neutral-800 bg-neutral-900 p-4">
          <h3 className="mb-4 text-lg font-black uppercase tracking-tight text-white">Units</h3>
          <div className="grid grid-cols-2 gap-3">
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

        <div className="rounded-xl border border-neutral-800 bg-neutral-900 p-4">
          <h3 className="mb-4 text-lg font-black uppercase tracking-tight text-white">Plate rack</h3>
          <div className="mb-4 flex gap-2">
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

        <div className="rounded-xl border border-neutral-800 bg-neutral-900 p-4">
          <h3 className="mb-4 text-lg font-black uppercase tracking-tight text-white">Progression multipliers</h3>
          <p className="mb-4 text-xs text-neutral-500">
            Next weight = current + (increment × multiplier). ≤0 shows red on workout and log cards.
          </p>
          <div className="mb-4 space-y-3">
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
    return <LiftPlanTab payload={payload} onPersist={onPersist} weightUnit={weightUnit} />
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
      <div className="w-full min-w-0 space-y-5">
        {logGroups.map((group, idx) => (
          <LiftLogDayCard key={idx} group={group} payload={payload} onPersist={onPersist} />
        ))}
      </div>
    )
  }

  // workout
  if (sortedDays.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center p-12 py-24 text-center text-neutral-500">
        <p className="text-lg font-bold">No plan created yet.</p>
      </div>
    )
  }

  return (
    <WorkoutDayTransition dayIndex={currentDayIndex}>
      {(activeIndex) => {
        const activeDay = sortedDays[activeIndex]
        if (!activeDay) return null

        const activeWorkouts = payload.workouts.filter((w) => w.dayId === activeDay.id)
        if (activeWorkouts.length === 0) {
          return (
            <div className="flex flex-col items-center justify-center p-12 py-24 text-center text-neutral-500">
              <p className="text-lg font-bold">No workouts for {activeDay.name}.</p>
            </div>
          )
        }

        const activeDayHistory = (payload.history || []).filter((h) => {
          const w = payload.workouts.find((wk) => wk.id === h.workoutId)
          return Boolean(w && w.dayId === activeDay.id)
        })
        const activeDayLogGroups = groupHistory(
          activeDayHistory,
          sortedDays,
          payload.workouts,
          { dateOnly: true },
        )

        let runningSetNum = 1
        return (
          <>
            {activeWorkouts.map((workout) => {
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
        const plates = payload.availablePlates || []
        const progressDelta = getProgressDelta(workout.increment, mVal)
        const nextLiftWeight = getNextLiftWeight(workout, mVal, plates)

        const hasNotes = Boolean(workout.notes?.trim())
        const isNotesOpen = Boolean(openNotesByWorkoutId[workout.id])

        return (
          <div key={workout.id} className="rounded-xl border border-neutral-800 bg-neutral-900 p-4 shadow-md">
            <div className="mb-4 flex items-start justify-between gap-2">
              <h3 className="min-w-0 flex-1 text-xl font-bold leading-snug text-white line-clamp-2 [overflow-wrap:break-word] [word-break:normal]">
                {workout.name}
              </h3>
              {onPersist ? (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation()
                    setOpenNotesByWorkoutId((prev) => ({ ...prev, [workout.id]: !prev[workout.id] }))
                  }}
                  className={`relative flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border outline-none transition-all focus:ring-2 ${
                    isNotesOpen
                      ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-400 focus:ring-emerald-500/30'
                      : 'border-neutral-700 bg-transparent text-neutral-400 hover:bg-neutral-800 hover:text-neutral-200 focus:ring-neutral-700'
                  }`}
                  title={isNotesOpen ? 'Hide notes' : hasNotes ? 'View notes' : 'Add notes'}
                >
                  <FileText className="h-5 w-5" />
                  {!isNotesOpen && hasNotes ? (
                    <span className="absolute top-1.5 right-1.5 h-2 w-2 rounded-full bg-emerald-400 ring-2 ring-neutral-900" />
                  ) : null}
                </button>
              ) : null}
            </div>

            {isNotesOpen && onPersist ? (
              <div className="mb-4 flex items-start gap-3 rounded-xl border border-neutral-800 bg-black/40 p-3">
                <FileText className="mt-0.5 h-4 w-4 shrink-0 text-neutral-500" />
                <AutoResizeTextarea
                  value={workout.notes || ''}
                  onChange={(e) =>
                    persist({
                      ...payload,
                      workouts: payload.workouts.map((w) =>
                        w.id === workout.id ? { ...w, notes: e.target.value } : w,
                      ),
                    })
                  }
                  placeholder="Add notes…"
                  className="w-full bg-transparent text-sm leading-relaxed text-neutral-300 outline-none placeholder:text-neutral-600"
                />
              </div>
            ) : null}

            <div>
              {groupedSets.map((set, idx) => {
                const setRangeLabel =
                  set.startNum === set.endNum ? `${set.startNum}` : `${set.startNum}-${set.endNum}`
                const isEditingWeight = editingWeightWorkoutId === workout.id && !set.isWarmup
                return (
                  <div
                    key={`${workout.id}-${idx}`}
                    role={!set.isWarmup && onPersist ? 'button' : undefined}
                    tabIndex={!set.isWarmup && onPersist ? 0 : undefined}
                    onClick={() => {
                      if (!set.isWarmup && onPersist && !isEditingWeight) {
                        setEditingWeightWorkoutId(workout.id)
                        setTempMainWeight(String(workout.mainWeight))
                      }
                    }}
                    onKeyDown={(e) => {
                      if (!set.isWarmup && onPersist && (e.key === 'Enter' || e.key === ' ')) {
                        e.preventDefault()
                        setEditingWeightWorkoutId(workout.id)
                        setTempMainWeight(String(workout.mainWeight))
                      }
                    }}
                    className={`mb-3 flex flex-col overflow-hidden rounded-2xl shadow-sm transition-all duration-200 ${
                      !set.isWarmup && onPersist ? 'cursor-pointer' : ''
                    } ${isEditingWeight ? 'ring-4 ring-emerald-300/50' : ''}`}
                  >
                    <div
                      className={`${
                        set.isWarmup ? 'bg-emerald-100' : 'bg-emerald-300'
                      } relative flex min-h-[72px] items-center justify-center sm:min-h-[85px]`}
                    >
                      {isEditingWeight ? (
                        <div
                          className="absolute inset-0 flex items-center px-4"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <input
                            autoFocus
                            type="number"
                            step="any"
                            inputMode="decimal"
                            value={tempMainWeight}
                            placeholder={String(workout.mainWeight)}
                            onChange={(e) => setTempMainWeight(e.target.value)}
                            onBlur={() => {
                              if (tempMainWeight.trim() === '' || Number.isNaN(parseFloat(tempMainWeight))) {
                                setEditingWeightWorkoutId(null)
                              } else {
                                persist({
                                  ...payload,
                                  workouts: payload.workouts.map((w) =>
                                    w.id === workout.id
                                      ? { ...w, mainWeight: parseFloat(tempMainWeight) }
                                      : w,
                                  ),
                                })
                                setEditingWeightWorkoutId(null)
                              }
                            }}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') {
                                ;(e.target as HTMLInputElement).blur()
                              } else if (e.key === 'Escape') {
                                setEditingWeightWorkoutId(null)
                              }
                            }}
                            className="w-full bg-transparent text-center text-[40px] font-black text-black outline-none [appearance:textfield] placeholder:text-black/20 sm:text-[48px] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                          />
                          <button
                            type="button"
                            onMouseDown={(e) => {
                              e.preventDefault()
                              setEditingWeightWorkoutId(null)
                            }}
                            className="absolute right-4 top-1/2 -translate-y-1/2 rounded-full p-2 text-black opacity-50 transition-all hover:bg-black/10 hover:opacity-100"
                            title="Cancel"
                          >
                            <X className="h-8 w-8" />
                          </button>
                        </div>
                      ) : (
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
                            <span className="text-[28px] font-black uppercase text-black sm:text-[32px]">
                              Bar only
                            </span>
                          )}
                        </div>
                      )}
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

            <div className="mt-4 flex items-end justify-between gap-3">
              <p
                className={`min-w-0 text-sm font-bold tabular-nums leading-tight ${
                  isNeg ? 'text-red-400' : 'text-emerald-400'
                }`}
              >
                <span>{formatProgressDelta(progressDelta)}</span>
                <span className="text-neutral-500">, </span>
                <span className="font-semibold text-neutral-300">
                  {nextLiftWeight} {weightUnit}
                </span>
              </p>
              {statuses.length > 0 ? (
                <LiftStatusSelector
                  className="h-10 w-auto min-w-0 max-w-[min(100%,12rem)] shrink-0"
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
          </div>
        )
      })}
            {onPersist && activeWorkouts.length > 0 && (
        <button
          type="button"
          className="mt-2 w-full rounded-xl bg-emerald-400 px-4 py-4 text-sm font-black uppercase tracking-[0.2em] text-black shadow-lg transition-colors hover:bg-emerald-300 active:scale-[0.99]"
          onClick={submitWorkoutDay}
        >
          Submit
        </button>
      )}

      {onSeeAllLog && (
        <div className="mt-12 w-full min-w-0 border-t border-neutral-800 pt-8">
          <div className="mb-4 flex items-center justify-between gap-4">
            <h2 className="text-lg font-black uppercase tracking-tight text-white">Log</h2>
            <AppAccentTextButton onClick={onSeeAllLog}>See all</AppAccentTextButton>
          </div>
          {activeDayLogGroups.length > 0 ? (
            <div className="w-full min-w-0 space-y-5">
              {activeDayLogGroups.map((group, idx) => (
                <LiftLogDayCard
                  key={idx}
                  group={group}
                  payload={payload}
                  onPersist={onPersist}
                  showDayName={false}
                />
              ))}
            </div>
          ) : (
            <p className="text-sm text-neutral-500">No entries for this day yet.</p>
          )}
        </div>
      )}
          </>
        )
      }}
    </WorkoutDayTransition>
  )
}
