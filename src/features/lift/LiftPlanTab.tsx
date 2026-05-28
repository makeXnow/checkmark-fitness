import { useEffect, useRef, useState } from 'react'
import { FileText, Plus, Trash2 } from 'lucide-react'
import type { LiftPayload, LiftWarmupSet, LiftWeightUnit, LiftWorkout } from '../../types/domain'
import { defaultWarmupSets, makeLiftId, newEmptyWorkout } from './liftDefaults'
import { workoutWithSessionWeight } from './plates'

function FieldLabel({ children }: { children: React.ReactNode }) {
  return (
    <label className="mb-1 block text-xs font-bold uppercase tracking-wider text-neutral-400">{children}</label>
  )
}

function PlanInput({
  label,
  value,
  placeholder,
  onChange,
  disabled,
}: {
  label: string
  value: string
  placeholder: string
  onChange: (v: string) => void
  disabled?: boolean
}) {
  return (
    <div>
      <FieldLabel>{label}</FieldLabel>
      <input
        type="number"
        step="any"
        value={value}
        placeholder={placeholder}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-lg border border-neutral-700 bg-black p-3 text-white outline-none placeholder:text-neutral-700 focus:border-emerald-300 disabled:opacity-40"
      />
    </div>
  )
}

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

interface WorkoutDraft {
  id: string
  dayId: string
  name: string
  notes: string
  mainWeight: string
  sets: string
  reps: string
  increment: string
  barWeight: string
  hasWarmup: boolean
  warmupSets: { id: string; reps: string; percentage: string }[]
}

function liftToDraft(w: LiftWorkout): WorkoutDraft {
  return {
    id: w.id,
    dayId: w.dayId,
    name: w.name,
    notes: w.notes ?? '',
    mainWeight: String(w.mainWeight),
    sets: String(w.sets),
    reps: String(w.reps),
    increment: String(w.increment),
    barWeight: String(w.barWeight),
    hasWarmup: w.hasWarmup,
    warmupSets: (w.warmupSets || []).map((wu) => ({
      id: wu.id || makeLiftId('wu_'),
      reps: String(wu.reps),
      percentage: String(wu.percentage),
    })),
  }
}

function draftToLift(d: WorkoutDraft, original: LiftWorkout | undefined): LiftWorkout {
  const orig = original || ({} as LiftWorkout)
  const num = (s: string, fallback: number) => {
    if (s.trim() === '') return fallback
    const n = parseFloat(s)
    return Number.isFinite(n) ? n : fallback
  }
  const int = (s: string, fallback: number) => {
    if (s.trim() === '') return fallback
    const n = parseInt(s, 10)
    return Number.isFinite(n) ? n : fallback
  }
  const warmupSets: LiftWarmupSet[] = d.hasWarmup
    ? d.warmupSets.map((wu, idx) => {
        const origWu = orig.warmupSets?.[idx]
        return {
          id: wu.id,
          reps: int(wu.reps, origWu?.reps ?? orig.reps ?? 5),
          percentage: int(wu.percentage, origWu?.percentage ?? 50),
        }
      })
    : []
  const idOut = d.id && d.id.length > 0 ? d.id : makeLiftId('w_')
  return {
    id: idOut,
    dayId: d.dayId,
    name: d.name,
    notes: d.notes,
    mainWeight: num(d.mainWeight, orig.mainWeight ?? 100),
    sets: int(d.sets, orig.sets ?? 3),
    reps: int(d.reps, orig.reps ?? 5),
    increment: num(d.increment, orig.increment ?? 5),
    barWeight: num(d.barWeight, orig.barWeight ?? 45),
    hasWarmup: d.hasWarmup,
    warmupSets,
  }
}

function WorkoutEditor({
  source,
  onCancel,
  onSave,
  onDelete,
  weightUnit,
  disabled,
}: {
  source: LiftWorkout
  onCancel: () => void
  onSave: (w: LiftWorkout) => void
  onDelete: (id: string) => void
  weightUnit: LiftWeightUnit
  disabled?: boolean
}) {
  const [draft, setDraft] = useState<WorkoutDraft>(() => liftToDraft(source))
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)

  useEffect(() => {
    setDraft(liftToDraft(source))
    setShowDeleteConfirm(false)
  }, [source])

  const updateWarmupRow = (idx: number, patch: Partial<{ reps: string; percentage: string }>) => {
    setDraft((d) => {
      const warmupSets = [...d.warmupSets]
      warmupSets[idx] = { ...warmupSets[idx], ...patch }
      return { ...d, warmupSets }
    })
  }

  return (
    <div className="space-y-5 text-white">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-2xl font-bold">{source.id ? 'Edit workout' : 'New workout'}</h2>
        <button
          type="button"
          disabled={disabled}
          onClick={onCancel}
          className="text-xs font-bold uppercase tracking-widest text-neutral-400 transition-colors hover:text-white disabled:opacity-40"
        >
          Cancel
        </button>
      </div>

      <div className="space-y-4 rounded-xl border border-neutral-800 bg-neutral-900 p-4">
        <div>
          <FieldLabel>Workout name</FieldLabel>
          <input
            type="text"
            value={draft.name}
            disabled={disabled}
            onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
            className="w-full rounded-lg border border-neutral-700 bg-black p-3 text-white outline-none focus:border-emerald-300 disabled:opacity-40"
          />
        </div>

        <div>
          <FieldLabel>Notes</FieldLabel>
          <div className="flex items-start gap-3 rounded-lg border border-neutral-700 bg-black p-3 transition-colors focus-within:border-emerald-300">
            <FileText className="mt-0.5 h-4 w-4 shrink-0 text-neutral-500" />
            <AutoResizeTextarea
              value={draft.notes}
              disabled={disabled}
              onChange={(e) => setDraft((d) => ({ ...d, notes: e.target.value }))}
              placeholder="Notes…"
              className="w-full bg-transparent text-sm text-white outline-none placeholder:text-neutral-600"
            />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <PlanInput
            label="Sets"
            value={draft.sets}
            placeholder={String(source.sets ?? 3)}
            disabled={disabled}
            onChange={(v) => setDraft((d) => ({ ...d, sets: v }))}
          />
          <PlanInput
            label="Reps"
            value={draft.reps}
            placeholder={String(source.reps ?? 5)}
            disabled={disabled}
            onChange={(v) => setDraft((d) => ({ ...d, reps: v }))}
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <PlanInput
            label={`Inc (${weightUnit})`}
            value={draft.increment}
            placeholder={String(source.increment ?? 5)}
            disabled={disabled}
            onChange={(v) => setDraft((d) => ({ ...d, increment: v }))}
          />
          <PlanInput
            label={`Bar (${weightUnit})`}
            value={draft.barWeight}
            placeholder={String(source.barWeight ?? 45)}
            disabled={disabled}
            onChange={(v) => setDraft((d) => ({ ...d, barWeight: v }))}
          />
        </div>

        <div className="mt-6 border-t border-neutral-800 pt-4">
          <div className="mb-4 flex items-center justify-between">
            <label className="text-sm font-bold text-neutral-300">Include warm-up sets</label>
            <button
              type="button"
              disabled={disabled}
              onClick={() => {
                setDraft((d) => {
                  const nextHas = !d.hasWarmup
                  let warm = [...d.warmupSets]
                  if (nextHas && warm.length === 0) {
                    warm = defaultWarmupSets().map((wu) => ({
                      id: wu.id!,
                      reps: String(wu.reps),
                      percentage: String(wu.percentage),
                    }))
                  }
                  return { ...d, hasWarmup: nextHas, warmupSets: warm }
                })
              }}
              className={`relative flex h-6 w-12 items-center rounded-full px-1 transition-colors disabled:opacity-40 ${
                draft.hasWarmup ? 'bg-emerald-400' : 'bg-neutral-700'
              }`}
            >
              <span
                className={`h-4 w-4 rounded-full bg-white shadow-md transition-transform duration-200 ${
                  draft.hasWarmup ? 'translate-x-6' : 'translate-x-0'
                }`}
              />
            </button>
          </div>

          {draft.hasWarmup && (
            <div className="space-y-3 rounded-xl border border-neutral-800 bg-black/50 p-4">
              {draft.warmupSets.map((wu, idx) => (
                <div key={wu.id} className="flex items-center gap-3">
                  <span className="w-4 font-black text-neutral-500">{idx + 1}</span>
                  <div className="min-w-0 flex-1">
                    <FieldLabel>Reps</FieldLabel>
                    <input
                      type="number"
                      value={wu.reps}
                      placeholder={String(source.reps ?? 5)}
                      disabled={disabled}
                      onChange={(e) => updateWarmupRow(idx, { reps: e.target.value })}
                      className="w-full rounded-lg border border-neutral-700 bg-neutral-900 p-2 text-white outline-none focus:border-emerald-300 disabled:opacity-40"
                    />
                  </div>
                  <div className="min-w-0 flex-1">
                    <FieldLabel>%</FieldLabel>
                    <input
                      type="number"
                      value={wu.percentage}
                      placeholder="50"
                      disabled={disabled}
                      onChange={(e) => updateWarmupRow(idx, { percentage: e.target.value })}
                      className="w-full rounded-lg border border-neutral-700 bg-neutral-900 p-2 text-white outline-none focus:border-emerald-300 disabled:opacity-40"
                    />
                  </div>
                  <button
                    type="button"
                    disabled={disabled}
                    onClick={() =>
                      setDraft((d) => ({
                        ...d,
                        warmupSets: d.warmupSets.filter((_, i) => i !== idx),
                      }))
                    }
                    className="mt-5 p-2 text-red-500/80 transition-colors hover:text-red-400 disabled:opacity-40"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              ))}
              <button
                type="button"
                disabled={disabled}
                onClick={() =>
                  setDraft((d) => ({
                    ...d,
                    warmupSets: [
                      ...d.warmupSets,
                      { id: makeLiftId('wu_'), reps: '5', percentage: '50' },
                    ],
                  }))
                }
                className="mt-2 w-full rounded-lg border border-dashed border-neutral-700 py-2 text-sm font-bold text-emerald-300 transition-colors hover:bg-neutral-800 disabled:opacity-40"
              >
                + Add warm-up set
              </button>
            </div>
          )}
        </div>
      </div>

      <div className="rounded-xl border border-neutral-800 bg-neutral-900 p-4">
        <PlanInput
          label="Next weight"
          value={draft.mainWeight}
          placeholder={String(source.mainWeight ?? 100)}
          disabled={disabled}
          onChange={(v) => setDraft((d) => ({ ...d, mainWeight: v }))}
        />
      </div>

      <div className="flex w-full gap-2">
        {showDeleteConfirm ? (
          <>
            <button
              type="button"
              disabled={disabled}
              onClick={() => source.id && onDelete(source.id)}
              className="flex-1 rounded-lg bg-red-600 py-3 font-bold text-white transition-colors hover:bg-red-500 disabled:opacity-40"
            >
              Confirm delete
            </button>
            <button
              type="button"
              disabled={disabled}
              onClick={() => setShowDeleteConfirm(false)}
              className="flex-1 rounded-lg bg-neutral-800 py-3 font-bold text-white transition-colors hover:bg-neutral-700 disabled:opacity-40"
            >
              Cancel
            </button>
          </>
        ) : (
          <>
            <button
              type="button"
              disabled={disabled}
              onClick={() => onSave(draftToLift(draft, source.id ? source : undefined))}
              className="flex-1 rounded-lg bg-emerald-400 py-3 font-black uppercase tracking-widest text-black transition-colors hover:bg-emerald-300 disabled:opacity-40"
            >
              Save
            </button>
            {source.id ? (
              <button
                type="button"
                disabled={disabled}
                onClick={() => setShowDeleteConfirm(true)}
                className="flex items-center justify-center rounded-lg border border-red-900/50 bg-red-900/20 px-5 text-red-500 transition-colors hover:bg-red-900/30 disabled:opacity-40"
                aria-label="Delete workout"
              >
                <Trash2 className="h-5 w-5" />
              </button>
            ) : null}
          </>
        )}
      </div>
    </div>
  )
}

function DaySection({
  day,
  dayWorkouts,
  confirmDeleteDay,
  setConfirmDeleteDay,
  onDeleteDay,
  onOpenWorkout,
  setEditingWorkout,
  weightUnit,
}: {
  day: LiftPayload['days'][0]
  dayWorkouts: LiftWorkout[]
  confirmDeleteDay: string | null
  setConfirmDeleteDay: (id: string | null) => void
  onDeleteDay: (dayId: string) => void
  onOpenWorkout: (w: LiftWorkout) => void
  setEditingWorkout: (w: LiftWorkout | null) => void
  weightUnit: LiftWeightUnit
}) {
  return (
    <div className="mb-8">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-2xl font-black uppercase tracking-tight text-white">{day.name}</h2>
        {confirmDeleteDay === day.id ? (
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => onDeleteDay(day.id)}
              className="rounded-lg bg-red-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-red-500"
            >
              Confirm
            </button>
            <button
              type="button"
              onClick={() => setConfirmDeleteDay(null)}
              className="rounded-lg bg-neutral-800 px-3 py-1.5 text-xs font-bold text-white hover:bg-neutral-700"
            >
              Cancel
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setConfirmDeleteDay(day.id)}
            className="p-2 text-neutral-500 transition-colors hover:text-red-500"
            aria-label={`Delete ${day.name}`}
          >
            <Trash2 className="h-4 w-4" />
          </button>
        )}
      </div>
      <div className="space-y-4">
        {dayWorkouts.map((workout) => (
          <button
            key={workout.id}
            type="button"
            onClick={() => onOpenWorkout(workout)}
            className="w-full cursor-pointer rounded-xl border border-neutral-800 bg-neutral-900 p-4 text-left transition-colors hover:border-neutral-600"
          >
            <div className="mb-1 flex items-start justify-between">
              <h4 className="text-lg font-bold text-white">{workout.name}</h4>
              <span className="text-sm font-bold text-emerald-400">+{workout.increment}</span>
            </div>
            <p className="mb-4 text-sm font-medium text-neutral-400">
              {workout.reps} reps • {workout.barWeight}
              {weightUnit} bar
            </p>
            {workout.notes ? (
              <div className="mb-4 flex items-start gap-2 rounded-lg border border-neutral-800/50 bg-black/40 p-2.5">
                <FileText className="mt-0.5 h-3.5 w-3.5 shrink-0 text-neutral-500" />
                <p className="line-clamp-2 whitespace-pre-wrap text-xs italic leading-relaxed text-neutral-400">
                  {workout.notes}
                </p>
              </div>
            ) : null}
            {workout.hasWarmup && (workout.warmupSets || []).length > 0 ? (
              <div>
                <p className="mb-2 text-[10px] font-black uppercase tracking-[0.2em] text-neutral-500">
                  Warm-up strategy
                </p>
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="border-b border-neutral-800 text-neutral-400">
                      <th className="pb-2 font-black uppercase">Set</th>
                      <th className="pb-2 font-black uppercase">Reps</th>
                      <th className="pb-2 font-black uppercase">%</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(workout.warmupSets || []).map((wu, idx) => (
                      <tr
                        key={wu.id ?? idx}
                        className="border-b border-neutral-800/50 text-neutral-300 last:border-none"
                      >
                        <td className="py-2 font-bold">{idx + 1}</td>
                        <td className="py-2 font-bold">{wu.reps}</td>
                        <td className="py-2 font-bold">{wu.percentage}%</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : null}
          </button>
        ))}
        <button
          type="button"
          onClick={() => setEditingWorkout(newEmptyWorkout(day.id))}
          className="flex w-full items-center justify-center rounded-xl border border-neutral-800 py-3 text-xs font-bold uppercase tracking-widest text-emerald-400 transition-colors hover:bg-neutral-800"
        >
          <Plus className="mr-2 h-4 w-4" /> Add workout
        </button>
      </div>
    </div>
  )
}

export function LiftPlanTab({
  payload,
  onPersist,
  weightUnit,
}: {
  payload: LiftPayload
  onPersist?: (next: LiftPayload) => void | Promise<void>
  weightUnit: LiftWeightUnit
}) {
  const [editingWorkout, setEditingWorkout] = useState<LiftWorkout | null>(null)
  const [confirmDeleteDay, setConfirmDeleteDay] = useState<string | null>(null)
  const [addingDay, setAddingDay] = useState(false)
  const [newDayName, setNewDayName] = useState('')

  const sortedDays = [...payload.days].sort((a, b) => (a.order || 0) - (b.order || 0))
  const plates = payload.availablePlates || []

  const openWorkoutEditor = (workout: LiftWorkout) => {
    setEditingWorkout(workoutWithSessionWeight(workout, payload.history, plates))
  }

  const persist = (next: LiftPayload) => {
    if (onPersist) void onPersist(next)
  }

  const saveWorkout = (sanitized: LiftWorkout) => {
    const isUpdate = sanitized.id && payload.workouts.some((wk) => wk.id === sanitized.id)
    if (isUpdate) {
      persist({
        ...payload,
        workouts: payload.workouts.map((wk) => (wk.id === sanitized.id ? sanitized : wk)),
      })
    } else {
      persist({
        ...payload,
        workouts: [...payload.workouts, sanitized],
      })
    }
    setEditingWorkout(null)
  }

  const deleteWorkout = (id: string) => {
    persist({
      ...payload,
      workouts: payload.workouts.filter((w) => w.id !== id),
    })
    setEditingWorkout(null)
  }

  const handleAddDay = () => {
    const name = newDayName.trim()
    if (!name || !onPersist) return
    persist({
      ...payload,
      days: [...payload.days, { id: makeLiftId('d_'), name, order: payload.days.length }],
    })
    setAddingDay(false)
    setNewDayName('')
  }

  const handleDeleteDay = (dayId: string) => {
    persist({
      ...payload,
      days: payload.days.filter((d) => d.id !== dayId),
      workouts: payload.workouts.filter((w) => w.dayId !== dayId),
    })
    setConfirmDeleteDay(null)
  }

  if (editingWorkout) {
    return (
      <WorkoutEditor
        key={editingWorkout.id || editingWorkout.dayId}
        source={editingWorkout}
        onCancel={() => setEditingWorkout(null)}
        onSave={saveWorkout}
        onDelete={deleteWorkout}
        weightUnit={weightUnit}
        disabled={!onPersist}
      />
    )
  }

  return (
    <div className="space-y-5">
      {sortedDays.length === 0 && (
        <div className="rounded-xl border border-dashed border-neutral-800 bg-neutral-900 p-6 text-center text-neutral-500">
          {addingDay ? (
            <div className="mx-auto flex max-w-xs flex-col gap-3">
              <input
                autoFocus
                type="text"
                value={newDayName}
                onChange={(e) => setNewDayName(e.target.value)}
                placeholder="Day name (e.g. Push)"
                disabled={!onPersist}
                className="w-full rounded-lg border border-neutral-700 bg-black p-3 text-white outline-none focus:border-emerald-300 disabled:opacity-40"
              />
              <div className="flex gap-2">
                <button
                  type="button"
                  disabled={!onPersist}
                  onClick={handleAddDay}
                  className="flex-1 rounded-lg bg-emerald-400 py-2 font-bold text-black hover:bg-emerald-300 disabled:opacity-40"
                >
                  Save
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setAddingDay(false)
                    setNewDayName('')
                  }}
                  className="flex-1 rounded-lg bg-neutral-800 py-2 font-bold text-white hover:bg-neutral-700"
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              disabled={!onPersist}
              onClick={() => setAddingDay(true)}
              className="mx-auto block max-w-xs rounded-2xl bg-emerald-400 px-6 py-4 font-black uppercase tracking-widest text-black hover:bg-emerald-300 disabled:opacity-40"
            >
              Add first day
            </button>
          )}
        </div>
      )}

      {sortedDays.map((day) => (
        <DaySection
          key={day.id}
          day={day}
          dayWorkouts={payload.workouts.filter((w) => w.dayId === day.id)}
          confirmDeleteDay={confirmDeleteDay}
          setConfirmDeleteDay={setConfirmDeleteDay}
          onDeleteDay={handleDeleteDay}
          onOpenWorkout={openWorkoutEditor}
          setEditingWorkout={setEditingWorkout}
          weightUnit={weightUnit}
        />
      ))}

      {sortedDays.length > 0 && !addingDay && (
        <button
          type="button"
          disabled={!onPersist}
          onClick={() => setAddingDay(true)}
          className="mt-4 w-full rounded-xl border border-neutral-800 bg-black py-4 text-sm font-black uppercase tracking-widest text-neutral-500 transition-colors hover:text-white disabled:opacity-40"
        >
          + Add new day
        </button>
      )}

      {addingDay && sortedDays.length > 0 && (
        <div className="mt-4 rounded-xl border border-neutral-800 bg-neutral-900 p-4">
          <input
            autoFocus
            type="text"
            value={newDayName}
            onChange={(e) => setNewDayName(e.target.value)}
            placeholder="Day name"
            disabled={!onPersist}
            className="mb-3 w-full rounded-lg border border-neutral-700 bg-black p-3 text-white outline-none focus:border-emerald-300 disabled:opacity-40"
          />
          <div className="flex gap-2">
            <button
              type="button"
              disabled={!onPersist}
              onClick={handleAddDay}
              className="flex-1 rounded-lg bg-emerald-400 py-2 text-xs font-black uppercase tracking-widest text-black hover:bg-emerald-300 disabled:opacity-40"
            >
              Save day
            </button>
            <button
              type="button"
              onClick={() => {
                setAddingDay(false)
                setNewDayName('')
              }}
              className="flex-1 rounded-lg bg-neutral-800 py-2 text-xs font-black uppercase tracking-widest text-white hover:bg-neutral-700"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
