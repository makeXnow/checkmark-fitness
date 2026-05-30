import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { ChevronDown, FileText, Pencil, Plus, Trash2, X } from 'lucide-react'
import { AppAccentTextButton } from '../../core/AppAccentTextButton'
import { SettingSwitch } from '../../core/SettingSwitch'
import { localDateISO } from '../../lib/localDate'
import type { LiftHistoryEntry, LiftPayload, LiftSubRoute, LiftWeightUnit, LiftWorkout } from '../../types/domain'
import { LiftPlanTab } from './LiftPlanTab'
import { useLiftOpenSession } from './useLiftOpenSession'
import { historyEntryLocalDate } from './liftHistory'
import { buildSubmitWorkoutDayPayload, dateAtLocalNoonISO } from './submitWorkoutDay'
import {
  buildDayOptimizedPlateOrders,
  buildGroupedSets,
  formatLogDate,
  formatProgressDelta,
  formatWeightStr,
  getNextLiftWeight,
  getSessionMainWeight,
  workoutWithSessionWeight,
  getOptimalPlates,
  getProgressDelta,
  groupHistory,
  isNonPositiveProgressionMultiplier,
  parseStatusMultiplier,
  resolveMainWeightForNextLift,
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

function LiftWeightModal({
  workoutName,
  initialWeight,
  weightUnit,
  onClose,
  onSave,
}: {
  workoutName: string
  initialWeight: number
  weightUnit: LiftWeightUnit
  onClose: () => void
  onSave: (weight: number) => void
}) {
  const [value, setValue] = useState(String(initialWeight))
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    inputRef.current?.focus()
    inputRef.current?.select()
  }, [])

  const handleSave = () => {
    const trimmed = value.trim()
    if (trimmed === '' || Number.isNaN(parseFloat(trimmed))) return
    onSave(Math.max(0, parseFloat(trimmed)))
  }

  return createPortal(
    <div
      className="fixed inset-0 z-[60] flex items-end justify-center bg-black/80 p-4 backdrop-blur-sm sm:items-center"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="lift-weight-modal-title"
        className="w-full max-w-sm rounded-2xl border border-neutral-800 bg-neutral-900 p-5 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-xs font-bold uppercase tracking-wider text-neutral-500">Working weight</p>
            <h2 id="lift-weight-modal-title" className="text-lg font-black text-white line-clamp-2">
              {workoutName}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="shrink-0 rounded-full p-2 text-neutral-400 transition-colors hover:bg-neutral-800 hover:text-white"
            aria-label="Close"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="mb-5">
          <FieldLabel>Weight ({weightUnit})</FieldLabel>
          <input
            ref={inputRef}
            type="number"
            step="any"
            inputMode="decimal"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleSave()
              else if (e.key === 'Escape') onClose()
            }}
            className="w-full rounded-xl border border-neutral-700 bg-black/40 px-4 py-3 text-center text-2xl font-black text-white outline-none focus:border-emerald-500/50 focus:ring-2 focus:ring-emerald-500/20 [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
          />
        </div>
        <div className="flex gap-3">
          <button
            type="button"
            onClick={onClose}
            className="flex-1 rounded-xl border border-neutral-700 px-4 py-3 text-sm font-bold text-neutral-300 transition-colors hover:bg-neutral-800"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSave}
            className="flex-1 rounded-xl bg-emerald-400 px-4 py-3 text-sm font-black uppercase tracking-wider text-black transition-colors hover:bg-emerald-300"
          >
            Save
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}

function LiftProgressModal({
  workoutName,
  workout,
  initialAddAmount,
  initialNextWeight,
  statusMultiplier,
  weightUnit,
  availablePlates,
  onClose,
  onSave,
}: {
  workoutName: string
  workout: LiftWorkout
  initialAddAmount: number
  initialNextWeight: number
  statusMultiplier: number
  weightUnit: LiftWeightUnit
  availablePlates: number[]
  onClose: () => void
  onSave: (increment: number, nextWeight: number) => void
}) {
  const [addValue, setAddValue] = useState(String(initialAddAmount))
  const [nextValue, setNextValue] = useState(String(initialNextWeight))
  const addInputRef = useRef<HTMLInputElement>(null)

  const incrementFromAdd = useCallback(
    (addStr: string) => {
      const add = parseFloat(addStr.trim())
      if (!Number.isFinite(add)) return workout.increment
      if (statusMultiplier === 0) return add
      return add / statusMultiplier
    },
    [statusMultiplier, workout.increment],
  )

  useEffect(() => {
    addInputRef.current?.focus()
    addInputRef.current?.select()
  }, [])

  const syncNextFromAdd = (addStr: string) => {
    const inc = incrementFromAdd(addStr)
    if (!Number.isFinite(inc)) return
    const next = getNextLiftWeight({ ...workout, increment: inc }, statusMultiplier, availablePlates)
    setNextValue(String(next))
  }

  const handleSave = () => {
    const add = parseFloat(addValue.trim())
    const next = parseFloat(nextValue.trim())
    if (!Number.isFinite(add) || !Number.isFinite(next)) return
    onSave(incrementFromAdd(addValue), Math.max(0, next))
  }

  return createPortal(
    <div
      className="fixed inset-0 z-[60] flex items-end justify-center bg-black/80 p-4 backdrop-blur-sm sm:items-center"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="lift-progress-modal-title"
        className="w-full max-w-sm rounded-2xl border border-neutral-800 bg-neutral-900 p-5 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-xs font-bold uppercase tracking-wider text-neutral-500">Progress</p>
            <h2 id="lift-progress-modal-title" className="text-lg font-black text-white line-clamp-2">
              {workoutName}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="shrink-0 rounded-full p-2 text-neutral-400 transition-colors hover:bg-neutral-800 hover:text-white"
            aria-label="Close"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="mb-5 grid grid-cols-2 gap-3">
          <div className="min-w-0">
            <FieldLabel>Weekly add ({weightUnit})</FieldLabel>
            <input
              ref={addInputRef}
              type="number"
              step="any"
              inputMode="decimal"
              value={addValue}
              onChange={(e) => {
                setAddValue(e.target.value)
                syncNextFromAdd(e.target.value)
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleSave()
                else if (e.key === 'Escape') onClose()
              }}
              className="w-full rounded-xl border border-neutral-700 bg-black/40 px-4 py-3 text-center text-2xl font-black text-white outline-none focus:border-emerald-500/50 focus:ring-2 focus:ring-emerald-500/20 [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
            />
          </div>
          <div className="min-w-0">
            <FieldLabel>Next ({weightUnit})</FieldLabel>
            <input
              type="number"
              step="any"
              inputMode="decimal"
              value={nextValue}
              onChange={(e) => setNextValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleSave()
                else if (e.key === 'Escape') onClose()
              }}
              className="w-full rounded-xl border border-neutral-700 bg-black/40 px-4 py-3 text-center text-2xl font-black text-white outline-none focus:border-emerald-500/50 focus:ring-2 focus:ring-emerald-500/20 [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
            />
          </div>
        </div>
        <div className="flex gap-3">
          <button
            type="button"
            onClick={onClose}
            className="flex-1 rounded-xl border border-neutral-700 px-4 py-3 text-sm font-bold text-neutral-300 transition-colors hover:bg-neutral-800"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSave}
            className="flex-1 rounded-xl bg-emerald-400 px-4 py-3 text-sm font-black uppercase tracking-wider text-black transition-colors hover:bg-emerald-300"
          >
            Save
          </button>
        </div>
      </div>
    </div>,
    document.body,
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

function effectiveHistoryStatusName(
  entry: Pick<LiftHistoryEntry, 'statusName'>,
  statuses: LiftPayload['statuses'],
): string {
  return String(entry.statusName ?? statuses?.[0]?.name ?? '')
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
    const statuses = payload.statuses || []
    setDraftDate(first ? historyEntryToDateInput(first.date) : localDateISO(new Date()))
    setDraftById(
      Object.fromEntries(
        group.entries.map((e) => [
          e.id,
          { ...e, statusName: effectiveHistoryStatusName(e, statuses) || e.statusName },
        ]),
      ),
    )
    setIsEditing(true)
  }

  const deleteDay = () => {
    if (!onPersist) return
    const ok = window.confirm(
      `Delete this workout day?\n\n${group.dayName} · ${group.dateStr}\n\nThis removes all logged exercises for this day from your log.`,
    )
    if (!ok) return
    const ids = new Set(group.entries.map((e) => e.id))
    void onPersist({
      ...payload,
      history: (payload.history || []).filter((h) => !ids.has(h.id)),
    })
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
      <div
        className={`relative flex w-full min-w-0 items-center justify-between gap-3 border-b border-neutral-800 bg-neutral-800 py-3 pl-4 text-neutral-200 ${
          isEditing ? 'pr-4' : 'pr-12'
        }`}
      >
        {isEditing ? (
          <input
            type="date"
            value={draftDate}
            onChange={(e) => setDraftDate(e.target.value)}
            className="min-w-0 flex-1 rounded-lg border border-neutral-600 bg-black px-2 py-1.5 text-sm font-bold text-white outline-none focus:border-emerald-400"
          />
        ) : (
          <span className="min-w-0 flex-1 truncate text-left text-base font-bold leading-snug">
            {group.dateStr}
          </span>
        )}
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
            {group.entries.map((entry) => {
              const draft = draftById[entry.id] ?? entry
              const unit = payload.weightUnit ?? 'lbs'
              const statusStr = effectiveHistoryStatusName(draft, statuses)
              const statusObj = statuses.find((s) => s.name === statusStr)
              const mVal = statusObj ? parseStatusMultiplier(statusObj.multiplier) : 1
              const isNegative = isNonPositiveProgressionMultiplier(mVal)
              const currentStatusExists = statuses.some((s) => s.name === statusStr)
              return (
                <div key={entry.id} className="min-w-0 space-y-3 rounded-lg border border-neutral-800 bg-black/40 p-3">
                  <h4 className="min-w-0 truncate text-lg font-bold text-white">
                    {entry.workoutName || 'Workout'}
                  </h4>
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
                      <LiftStatusSelector
                        isNegative={isNegative}
                        value={statusStr || '__NONE__'}
                        onChange={(e) => {
                          const v = e.target.value
                          setDraftById((prev) => ({
                            ...prev,
                            [entry.id]: {
                              ...draft,
                              statusName: v === '__NONE__' ? '' : v,
                            },
                          }))
                        }}
                      >
                        <option value="__NONE__" className="bg-neutral-900 text-white">
                          —
                        </option>
                        {!currentStatusExists && statusStr ? (
                          <option value={statusStr} className="bg-neutral-900 text-white">
                            {statusStr}
                          </option>
                        ) : null}
                        {statuses.map((s) => (
                          <option key={s.id} value={s.name} className="bg-neutral-900 text-white">
                            {s.name}
                          </option>
                        ))}
                      </LiftStatusSelector>
                    </div>
                  ) : null}
                </div>
              )
            })}
            <div className="flex gap-3">
              <button
                type="button"
                onClick={deleteDay}
                className="flex flex-1 items-center justify-center gap-2 rounded-lg border border-red-900/60 bg-red-950/30 px-4 py-3 text-xs font-black uppercase tracking-widest text-red-400 transition-colors hover:border-red-800 hover:bg-red-950/50 hover:text-red-300"
              >
                <Trash2 className="h-4 w-4 shrink-0" aria-hidden />
                Delete
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

  const statusStr = effectiveHistoryStatusName(entry, statuses)
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
      <div className="flex min-w-0 flex-col gap-3 min-[360px]:flex-row min-[360px]:flex-wrap min-[360px]:items-end min-[360px]:justify-between min-[360px]:gap-3">
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
          <div className="min-w-0 w-full max-w-full min-[360px]:w-auto min-[360px]:max-w-[min(100%,14rem)]">
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
  trackOpenSession = false,
  onPersist,
  onSeeAllLog,
  onWorkoutSubmitted,
}: {
  payload: LiftPayload
  subRoute: LiftSubRoute
  currentDayIndex: number
  onDayIndexChange: (idx: number) => void
  view: 'tracker' | 'settings'
  /** When false, open-session tracking is paused (e.g. another tab is visible). */
  trackOpenSession?: boolean
  onPersist?: (next: LiftPayload) => void | Promise<void>
  /** Shown on workout view above the day log preview; navigates to full log. */
  onSeeAllLog?: () => void
  /** Called after a successful workout-day submit (for assumption cleanup). */
  onWorkoutSubmitted?: (dayId: string, localDate: string) => void
}) {
  const sortedDays = useMemo(
    () => [...payload.days].sort((a, b) => (a.order || 0) - (b.order || 0)),
    [payload.days],
  )
  const currentDay = sortedDays[currentDayIndex]
  const statuses = payload.statuses || []
  const weightUnit = payload.weightUnit ?? 'lbs'
  const plateUnit = payload.plateUnit ?? 'lbs'

  useLiftOpenSession(trackOpenSession && Boolean(onPersist), currentDay?.id, subRoute, view)

  const [workoutStatusById, setWorkoutStatusById] = useState<Record<string, string>>({})
  const [newPlateInput, setNewPlateInput] = useState('')
  const [addingPlate, setAddingPlate] = useState(false)
  const addPlateInputRef = useRef<HTMLInputElement>(null)
  const [openNotesByWorkoutId, setOpenNotesByWorkoutId] = useState<Record<string, boolean>>({})
  const [weightModalWorkoutId, setWeightModalWorkoutId] = useState<string | null>(null)
  const [progressModalWorkoutId, setProgressModalWorkoutId] = useState<string | null>(null)

  useEffect(() => {
    setWorkoutStatusById({})
  }, [currentDayIndex])

  useEffect(() => {
    if (addingPlate) addPlateInputRef.current?.focus()
  }, [addingPlate])

  const persist = useCallback(
    (next: LiftPayload) => {
      if (onPersist) void onPersist(next)
    },
    [onPersist],
  )

  const weightModalWorkout = useMemo(
    () => (weightModalWorkoutId ? payload.workouts.find((w) => w.id === weightModalWorkoutId) : undefined),
    [payload.workouts, weightModalWorkoutId],
  )

  const progressModalWorkout = useMemo(
    () => (progressModalWorkoutId ? payload.workouts.find((w) => w.id === progressModalWorkoutId) : undefined),
    [payload.workouts, progressModalWorkoutId],
  )

  const saveManualWeight = useCallback(
    (workoutId: string, newWeight: number) => {
      const workout = payload.workouts.find((w) => w.id === workoutId)
      if (!workout) {
        setWeightModalWorkoutId(null)
        return
      }
      const oldWeight = workout.mainWeight
      if (newWeight === oldWeight) {
        setWeightModalWorkoutId(null)
        return
      }
      const localToday = localDateISO(new Date())
      const nextHistory = (payload.history || []).filter(
        (e) => !(e.workoutId === workoutId && historyEntryLocalDate(e) === localToday),
      )
      nextHistory.push({
        id: crypto.randomUUID(),
        workoutId: workout.id,
        workoutName: workout.name,
        date: dateAtLocalNoonISO(localToday),
        weight: newWeight,
        oldWeight,
        newWeight,
        statusName: 'Manual',
      })
      persist({
        ...payload,
        history: nextHistory,
        workouts: payload.workouts.map((w) => (w.id === workoutId ? { ...w, mainWeight: newWeight } : w)),
      })
      setWeightModalWorkoutId(null)
    },
    [payload, persist],
  )

  const saveWorkoutProgress = useCallback(
    (workoutId: string, newIncrement: number, newNextWeight: number, multiplier: number) => {
      const workout = payload.workouts.find((w) => w.id === workoutId)
      if (!workout) {
        setProgressModalWorkoutId(null)
        return
      }
      const plates = payload.availablePlates || []
      const sessionWorkout = workoutWithSessionWeight(workout, payload.history, plates)
      const newMainWeight = resolveMainWeightForNextLift(
        newNextWeight,
        sessionWorkout,
        newIncrement,
        multiplier,
        plates,
      )
      const incrementChanged = newIncrement !== workout.increment
      const weightChanged = newMainWeight !== sessionWorkout.mainWeight
      if (!incrementChanged && !weightChanged) {
        setProgressModalWorkoutId(null)
        return
      }
      persist({
        ...payload,
        workouts: payload.workouts.map((w) =>
          w.id === workoutId ? { ...w, increment: newIncrement, mainWeight: newMainWeight } : w,
        ),
      })
      setProgressModalWorkoutId(null)
    },
    [payload, persist],
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

  const progressModalMultiplier = useMemo(() => {
    if (!progressModalWorkoutId) return 1
    const sid = effectiveStatusId(progressModalWorkoutId)
    const status = statuses.find((s) => s.id === sid)
    return parseStatusMultiplier(status?.multiplier)
  }, [progressModalWorkoutId, effectiveStatusId, statuses])

  const progressModalSessionWorkout = useMemo(() => {
    if (!progressModalWorkout) return undefined
    return workoutWithSessionWeight(progressModalWorkout, payload.history, payload.availablePlates || [])
  }, [progressModalWorkout, payload.history, payload.availablePlates])

  const submitWorkoutDay = useCallback(() => {
    if (!onPersist || !currentDay) return
    const statusByWorkoutId: Record<string, string> = {}
    for (const w of todaysWorkouts) {
      statusByWorkoutId[w.id] = effectiveStatusId(w.id)
    }
    const { nextPayload, nextDayIndex } = buildSubmitWorkoutDayPayload(payload, currentDay.id, {
      statusByWorkoutId,
      advanceDayIndex: true,
    })
    void onPersist(nextPayload)
    setWorkoutStatusById({})
    if (nextDayIndex !== undefined) onDayIndexChange(nextDayIndex)
    onWorkoutSubmitted?.(currentDay.id, localDateISO(new Date()))
  }, [currentDay, effectiveStatusId, onDayIndexChange, onPersist, onWorkoutSubmitted, payload, todaysWorkouts])

  if (view === 'settings') {
    return (
      <div className="space-y-5 pb-[var(--app-main-pad-bottom)]">
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
          <div className="mb-4">
            <SettingSwitch
              label="Optimize Order"
              checked={Boolean(payload.optimizedPlateOrder)}
              ariaLabel="Optimize plate order"
              disabled={!onPersist}
              onCheckedChange={(checked) => persist({ ...payload, optimizedPlateOrder: checked })}
              description="Minimize plate changes across warmups, working sets, and all exercises on the day."
            />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {(payload.availablePlates || []).map((p) => (
              <span
                key={p}
                className="inline-flex items-center gap-0.5 rounded-full border border-neutral-700 bg-black py-1 pl-3 pr-1 text-sm font-bold text-white"
              >
                {formatWeightStr(p)} {plateUnit}
                <button
                  type="button"
                  disabled={!onPersist}
                  onClick={() =>
                    persist({
                      ...payload,
                      availablePlates: (payload.availablePlates || []).filter((x) => x !== p),
                    })
                  }
                  className="rounded-full p-1 text-neutral-500 transition-colors hover:bg-neutral-800 hover:text-red-400 disabled:opacity-40"
                  aria-label={`Remove ${p} ${plateUnit} plate`}
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </span>
            ))}
            {addingPlate ? (
              <span className="inline-flex items-center rounded-full border border-emerald-400/60 bg-black py-1 pl-3 pr-2">
                <input
                  ref={addPlateInputRef}
                  type="number"
                  step="any"
                  inputMode="decimal"
                  value={newPlateInput}
                  onChange={(e) => setNewPlateInput(e.target.value)}
                  disabled={!onPersist}
                  placeholder="2.5"
                  className="w-14 bg-transparent text-sm font-bold text-white outline-none placeholder:text-neutral-600 [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault()
                      const val = parseFloat(newPlateInput)
                      const list = [...(payload.availablePlates || [])]
                      if (!Number.isFinite(val) || val <= 0 || list.includes(val)) {
                        setNewPlateInput('')
                        setAddingPlate(false)
                        return
                      }
                      list.push(val)
                      list.sort((a, b) => b - a)
                      setNewPlateInput('')
                      setAddingPlate(false)
                      persist({ ...payload, availablePlates: list })
                    } else if (e.key === 'Escape') {
                      setNewPlateInput('')
                      setAddingPlate(false)
                    }
                  }}
                  onBlur={() => {
                    const val = parseFloat(newPlateInput)
                    const list = [...(payload.availablePlates || [])]
                    if (Number.isFinite(val) && val > 0 && !list.includes(val)) {
                      list.push(val)
                      list.sort((a, b) => b - a)
                      persist({ ...payload, availablePlates: list })
                    }
                    setNewPlateInput('')
                    setAddingPlate(false)
                  }}
                />
              </span>
            ) : null}
            <button
              type="button"
              disabled={!onPersist}
              onClick={() => {
                setAddingPlate(true)
                setNewPlateInput('')
              }}
              className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-dashed border-neutral-600 text-neutral-400 transition-colors hover:border-emerald-400 hover:bg-neutral-800 hover:text-emerald-400 disabled:opacity-40"
              aria-label="Add plate"
            >
              <Plus className="h-4 w-4" />
            </button>
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

        <div className="rounded-xl border border-neutral-800 bg-neutral-900 p-4">
          <h3 className="mb-4 text-lg font-black uppercase tracking-tight text-white">Plan</h3>
          <LiftPlanTab payload={payload} onPersist={onPersist} weightUnit={weightUnit} />
        </div>
      </div>
    )
  }

  if (subRoute === 'plan') {
    return (
      <div className="pb-[var(--app-main-pad-bottom)]">
        <LiftPlanTab payload={payload} onPersist={onPersist} weightUnit={weightUnit} />
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
    <>
    <WorkoutDayTransition dayIndex={currentDayIndex}>
      {(activeIndex) => {
        const activeDay = sortedDays[activeIndex]
        if (!activeDay) return null

        const platesList = payload.availablePlates || []
        const activeWorkouts = payload.workouts
          .filter((w) => w.dayId === activeDay.id)
          .map((w) => workoutWithSessionWeight(w, payload.history, platesList))
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

        const useOptimized = payload.optimizedPlateOrder ?? false
        const dayPlateOrders = useOptimized
          ? buildDayOptimizedPlateOrders(activeWorkouts, platesList)
          : null

        let runningSetNum = 1
        return (
          <>
            {activeWorkouts.map((workout) => {
        const { groupedSets, nextSetNum } = buildGroupedSets(
          workout,
          platesList,
          runningSetNum,
          useOptimized,
          dayPlateOrders?.get(workout.id),
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
          <div
            key={workout.id}
            className="rounded-xl border border-neutral-800 bg-neutral-900 p-4 shadow-md"
          >
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
              <div
                className="mb-4 flex items-start gap-3 rounded-xl border border-neutral-800 bg-black/40 p-3"
                onClick={(e) => e.stopPropagation()}
              >
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
                const isFinalSetCard = idx === groupedSets.length - 1
                return (
                  <div
                    key={`${workout.id}-${idx}`}
                    onClick={() => {
                      if (isFinalSetCard && onPersist) setWeightModalWorkoutId(workout.id)
                    }}
                    className={`mb-3 flex flex-col overflow-hidden rounded-2xl shadow-sm transition-all duration-200 ${
                      isFinalSetCard && onPersist ? 'cursor-pointer' : ''
                    }`}
                  >
                    <div
                      className={`${
                        set.isWarmup ? 'bg-emerald-100' : 'bg-emerald-300'
                      } relative flex min-h-[72px] items-center justify-center sm:min-h-[85px]`}
                    >
                      {isFinalSetCard && onPersist ? (
                        <span className="pointer-events-none absolute right-2.5 top-2.5 text-emerald-700 opacity-45">
                          <Pencil className="h-3.5 w-3.5" aria-hidden />
                        </span>
                      ) : null}
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
              {onPersist ? (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation()
                    setProgressModalWorkoutId(workout.id)
                  }}
                  className="inline-flex min-w-0 items-center overflow-hidden rounded-full border border-neutral-700 bg-black/40 text-sm font-bold tabular-nums leading-tight transition-colors hover:bg-neutral-800/80"
                  aria-label={`Edit progress for ${workout.name}`}
                >
                  <span className={`px-3 py-1.5 ${isNeg ? 'text-red-400' : 'text-emerald-400'}`}>
                    {formatProgressDelta(progressDelta)}
                  </span>
                  <span className="h-3.5 w-px shrink-0 bg-neutral-700" aria-hidden />
                  <span className="px-3 py-1.5 font-semibold text-neutral-300">
                    {nextLiftWeight} {weightUnit}
                  </span>
                </button>
              ) : (
                <div className="inline-flex min-w-0 items-center overflow-hidden rounded-full border border-neutral-700 bg-black/40 text-sm font-bold tabular-nums leading-tight">
                  <span className={`px-3 py-1.5 ${isNeg ? 'text-red-400' : 'text-emerald-400'}`}>
                    {formatProgressDelta(progressDelta)}
                  </span>
                  <span className="h-3.5 w-px shrink-0 bg-neutral-700" aria-hidden />
                  <span className="px-3 py-1.5 font-semibold text-neutral-300">
                    {nextLiftWeight} {weightUnit}
                  </span>
                </div>
              )}
              {statuses.length > 0 ? (
                <div onClick={(e) => e.stopPropagation()}>
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
                </div>
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

    {weightModalWorkout && onPersist ? (
      <LiftWeightModal
        key={weightModalWorkout.id}
        workoutName={weightModalWorkout.name}
        initialWeight={getSessionMainWeight(
          weightModalWorkout,
          payload.history,
          payload.availablePlates || [],
        )}
        weightUnit={weightUnit}
        onClose={() => setWeightModalWorkoutId(null)}
        onSave={(newWeight) => saveManualWeight(weightModalWorkout.id, newWeight)}
      />
    ) : null}

    {progressModalWorkout && progressModalSessionWorkout && onPersist ? (
      <LiftProgressModal
        key={progressModalWorkout.id}
        workoutName={progressModalWorkout.name}
        workout={progressModalSessionWorkout}
        initialAddAmount={getProgressDelta(progressModalSessionWorkout.increment, progressModalMultiplier)}
        initialNextWeight={getNextLiftWeight(
          progressModalSessionWorkout,
          progressModalMultiplier,
          payload.availablePlates || [],
        )}
        statusMultiplier={progressModalMultiplier}
        weightUnit={weightUnit}
        availablePlates={payload.availablePlates || []}
        onClose={() => setProgressModalWorkoutId(null)}
        onSave={(newIncrement, newNextWeight) =>
          saveWorkoutProgress(
            progressModalWorkout.id,
            newIncrement,
            newNextWeight,
            progressModalMultiplier,
          )
        }
      />
    ) : null}
    </>
  )
}
