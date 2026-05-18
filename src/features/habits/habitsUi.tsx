import { useEffect, useRef, useState } from 'react'
import type { LucideIcon } from 'lucide-react'
import { Apple, Dumbbell, Droplet, Heart } from 'lucide-react'
import { localDateISO } from '../../lib/localDate'
import type { HabitsGoals, DayLog } from '../../types/domain'
import {
  HABIT_COLOR_SWATCH_OPTIONS,
  habitAccentFillHex,
  habitDoneCardClasses,
  habitEmptyDotBorderClass,
} from './habitTailwindColors'

export function DualSlider({
  minLim,
  maxLim,
  val1,
  val2,
  setVal1,
  setVal2,
  colorClass,
}: {
  minLim: number
  maxLim: number
  val1: number
  val2: number
  setVal1: (n: number) => void
  setVal2: (n: number) => void
  colorClass: string
}) {
  const getPercent = (val: number) => ((val - minLim) / (maxLim - minLim)) * 100
  return (
    <div className="relative w-full h-1.5 bg-neutral-800 rounded-lg mt-6 mb-2 flex items-center">
      <div
        className={`absolute h-full rounded-lg ${colorClass}`}
        style={{ left: `${getPercent(val1)}%`, right: `${100 - getPercent(val2)}%` }}
      />
      <input
        type="range"
        min={minLim}
        max={maxLim}
        value={val1}
        onChange={(e) => setVal1(Math.min(Number(e.target.value), val2))}
        className="absolute w-full appearance-none bg-transparent pointer-events-none [&::-webkit-slider-thumb]:pointer-events-auto [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-5 [&::-webkit-slider-thumb]:h-5 [&::-webkit-slider-thumb]:bg-white [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:shadow-md [&::-moz-range-thumb]:pointer-events-auto [&::-moz-range-thumb]:w-5 [&::-moz-range-thumb]:h-5 [&::-moz-range-thumb]:bg-white [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border-none z-20"
      />
      <input
        type="range"
        min={minLim}
        max={maxLim}
        value={val2}
        onChange={(e) => setVal2(Math.max(Number(e.target.value), val1))}
        className="absolute w-full appearance-none bg-transparent pointer-events-none [&::-webkit-slider-thumb]:pointer-events-auto [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-5 [&::-webkit-slider-thumb]:h-5 [&::-webkit-slider-thumb]:bg-white [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:shadow-md [&::-moz-range-thumb]:pointer-events-auto [&::-moz-range-thumb]:w-5 [&::-moz-range-thumb]:h-5 [&::-moz-range-thumb]:bg-white [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border-none z-30"
      />
    </div>
  )
}

export function HabitColorPicker({
  value,
  onChange,
}: {
  value: string
  onChange: (bgClass: string) => void
}) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDocDown = (e: MouseEvent) => {
      const el = rootRef.current
      if (el && !el.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDocDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDocDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const swatchClass = value.startsWith('bg-') ? value : 'bg-neutral-600'

  return (
    <div ref={rootRef} className="relative mt-5">
      <button
        type="button"
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-label="Choose accent color"
        onClick={() => setOpen((o) => !o)}
        className={[
          'flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-black/40 shadow-inner transition-transform',
          swatchClass,
          open ? 'ring-2 ring-white ring-offset-2 ring-offset-neutral-900' : 'active:scale-95',
        ].join(' ')}
      />
      {open && (
        <div
          className="absolute left-0 top-[calc(100%+10px)] z-50 min-w-[200px] rounded-xl border border-neutral-800 bg-neutral-950 p-3 shadow-2xl"
          role="listbox"
          aria-label="Accent colors"
        >
          <div className="grid grid-cols-6 gap-2">
            {HABIT_COLOR_SWATCH_OPTIONS.map((o) => {
              const selected = value === o.value
              return (
                <button
                  key={o.value}
                  type="button"
                  role="option"
                  aria-selected={selected}
                  aria-label={o.label}
                  onClick={() => {
                    onChange(o.value)
                    setOpen(false)
                  }}
                  className={[
                    'h-8 w-8 shrink-0 rounded-full border border-black/40 shadow-inner transition-transform active:scale-95',
                    o.value,
                    selected ? 'ring-2 ring-white ring-offset-2 ring-offset-neutral-950 scale-105' : 'hover:scale-105',
                  ].join(' ')}
                />
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}

const Icons = { Heart, Dumbbell, Apple, Droplet }

function habitOutlineBorderClass(colorClass: string): string {
  if (colorClass.startsWith('bg-')) return colorClass.replace(/^bg-/, 'border-')
  return 'border-neutral-500'
}

export function GoalCard({
  goalKey,
  config,
  weeklyCount,
  todayDone,
  waterToday,
  onTap,
}: {
  goalKey: keyof HabitsGoals
  config: HabitsGoals[keyof HabitsGoals]
  /** Completed days this week; dots fill 0…weeklyCount−1 in row order (LTR, then top-to-bottom). */
  weeklyCount: number
  todayDone: boolean
  /** Selected day’s bottle count (water only); drives partial fill on the next open slot. */
  waterToday: number
  onTap: () => void
}) {
  const isWater = goalKey === 'water'
  const IconComponent = Icons[config.icon as keyof typeof Icons] || Icons.Heart
  const outlineBorder = habitOutlineBorderClass(config.color)
  const dayComplete = todayDone
  const cardElevated = dayComplete || (isWater && waterToday > 0)
  const doneCard = habitDoneCardClasses(config.color)

  const total = config.max
  let row1Count = total
  let row2Count = 0
  if (total > 2) {
    row1Count = Math.floor(total / 2)
    row2Count = Math.ceil(total / 2)
  }

  const target = config.dailyTarget ?? 1
  /** First empty dot in LTR order — same slot as the water partial when in progress. */
  const nextSlotIndex = weeklyCount < total ? weeklyCount : -1

  const renderCircle = (index: number) => {
    const isOptional = index >= config.min
    const isFilled = index < weeklyCount
    const isWaterActiveDay = isWater && !todayDone && index === weeklyCount && waterToday > 0
    const waterPercent = isWaterActiveDay ? (waterToday / target) * 100 : 0

    /** No “next slot” outline once this habit is done for the selected day (water partial already requires !todayDone). */
    const showHabitOutline =
      !todayDone && nextSlotIndex >= 0 && index === nextSlotIndex && !isFilled && !isWaterActiveDay

    const emptyBorder = showHabitOutline
      ? outlineBorder
      : cardElevated
        ? habitEmptyDotBorderClass(config.color, isOptional)
        : isOptional
          ? 'border-neutral-700 opacity-30'
          : 'border-neutral-700'

    const waterPartialBorder = cardElevated
      ? habitEmptyDotBorderClass(config.color, false)
      : 'border-neutral-700'

    if (isWaterActiveDay) {
      const fillHex = habitAccentFillHex(config.color)
      const trackHex = '#262626'
      return (
        <div
          key={index}
          className={[
            'relative box-border h-5 w-5 shrink-0 rounded-full border-[3px] transition-all duration-500',
            waterPartialBorder,
          ].join(' ')}
        >
          <div
            className="absolute left-1/2 top-1/2 h-[14px] w-[14px] -translate-x-1/2 -translate-y-1/2 overflow-hidden rounded-full"
            style={{
              background: `conic-gradient(${fillHex} 0%, ${fillHex} ${waterPercent}%, ${trackHex} ${waterPercent}%, ${trackHex} 100%)`,
            }}
          />
        </div>
      )
    }

    return (
      <div
        key={index}
        className={[
          'w-5 h-5 rounded-full border-[3px] transition-all duration-500',
          isFilled ? `${config.color} border-transparent scale-110 shadow-lg shadow-black/40` : '',
          !isFilled ? emptyBorder : '',
        ]
          .filter(Boolean)
          .join(' ')}
      />
    )
  }

  return (
    <button
      type="button"
      onClick={onTap}
      className={`relative overflow-hidden cursor-pointer select-none rounded-[var(--radius-card)] p-4 h-[8.5rem] flex flex-col justify-between transition-all duration-300 border w-full text-left ${
        dayComplete ? `${doneCard.surface} ${doneCard.border} shadow-md` : cardElevated ? 'bg-neutral-800 border-neutral-700 shadow-md' : 'bg-neutral-900 border-neutral-800'
      } active:scale-95`}
    >
      <div className="flex justify-between items-start z-10">
        <div
          className={`p-2 rounded-xl transition-colors ${
            cardElevated ? config.color : 'bg-black border border-neutral-800'
          }`}
        >
          <IconComponent
            className={
              cardElevated ? 'text-white w-5 h-5' : 'text-neutral-500 w-5 h-5'
            }
          />
        </div>
        <span
          className={`text-[9px] font-black uppercase tracking-[0.15em] ${
            cardElevated ? 'text-neutral-300' : 'text-neutral-500'
          }`}
        >
          {config.label}
        </span>
      </div>
      <div className="z-10 flex flex-col items-center gap-2 pb-1">
        <div className="flex justify-center gap-2">
          {Array.from({ length: row1Count }).map((_, i) => renderCircle(i))}
        </div>
        {row2Count > 0 && (
          <div className="flex justify-center gap-2">
            {Array.from({ length: row2Count }).map((_, i) => renderCircle(row1Count + i))}
          </div>
        )}
      </div>
    </button>
  )
}

export const habitOrder: (keyof HabitsGoals)[] = ['water', 'diet', 'cardio', 'lift']

export function computeWeeklyProgress(
  weekDates: string[],
  logs: Record<string, DayLog>,
  goals: HabitsGoals,
): {
  cardio: number
  lift: number
  diet: number
  waterWeekly: number
} {
  const dt = goals.water.dailyTarget ?? 1
  let cardio = 0
  let lift = 0
  let diet = 0
  let waterWeekly = 0
  for (const d of weekDates) {
    const l = logs[d] || {}
    if (l.cardio) cardio++
    if (l.lift) lift++
    if (l.diet) diet++
    if ((l.water || 0) >= dt) waterWeekly++
  }
  return { cardio, lift, diet, waterWeekly }
}

export function getWeekDatesFor(anchor: Date, firstDayOfWeek: number): string[] {
  const start = new Date(anchor)
  const dayOfWeek = start.getDay()
  const diff = dayOfWeek >= firstDayOfWeek ? dayOfWeek - firstDayOfWeek : 7 - (firstDayOfWeek - dayOfWeek)
  start.setDate(start.getDate() - diff)
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(start)
    d.setDate(d.getDate() + i)
    return localDateISO(d)
  })
}

export interface PastWeekSummary {
  id: string
  startDate: Date
  goals: HabitsGoals
  cardioCount: number
  liftCount: number
  dietCount: number
  waterCount: number
  percentage: number
}

export function computePastWeeks(
  logs: Record<string, DayLog>,
  currentDate: Date,
  firstDayOfWeek: number,
  goalsForWeek: (weekStartISO: string) => HabitsGoals,
): PastWeekSummary[] {
  const logDates = Object.keys(logs).filter((k) => /^\d{4}-\d{2}-\d{2}$/.test(k)).sort()
  if (logDates.length === 0) return []

  const [y, m, d] = logDates[0].split('-').map((x) => parseInt(x, 10))
  const earliestDate = new Date(y, m - 1, d, 12, 0, 0)

  const startOfCurrentWeek = new Date(currentDate)
  startOfCurrentWeek.setHours(12, 0, 0, 0)
  const currentDayOfWeek = startOfCurrentWeek.getDay()
  const currentDiff =
    currentDayOfWeek >= firstDayOfWeek
      ? currentDayOfWeek - firstDayOfWeek
      : 7 - (firstDayOfWeek - currentDayOfWeek)
  startOfCurrentWeek.setDate(startOfCurrentWeek.getDate() - currentDiff)

  const startOfEarliestWeek = new Date(earliestDate)
  const earliestDayOfWeek = startOfEarliestWeek.getDay()
  const earliestDiff =
    earliestDayOfWeek >= firstDayOfWeek
      ? earliestDayOfWeek - firstDayOfWeek
      : 7 - (firstDayOfWeek - earliestDayOfWeek)
  startOfEarliestWeek.setDate(startOfEarliestWeek.getDate() - earliestDiff)

  const weeks: PastWeekSummary[] = []
  const iter = new Date(startOfCurrentWeek)
  iter.setDate(iter.getDate() - 7)

  while (iter >= startOfEarliestWeek) {
    const weekDates = Array.from({ length: 7 }, (_, i) => {
      const dObj = new Date(iter)
      dObj.setDate(dObj.getDate() + i)
      return localDateISO(dObj)
    })

    const weekGoals = goalsForWeek(weekDates[0]!)
    const waterTarget = weekGoals.water.dailyTarget ?? 4

    let cardioCount = 0
    let liftCount = 0
    let dietCount = 0
    let waterCount = 0

    for (const day of weekDates) {
      const dayLog = logs[day] || {}
      if (dayLog.cardio) cardioCount++
      if (dayLog.lift) liftCount++
      if (dayLog.diet) dietCount++
      if ((dayLog.water || 0) >= waterTarget) waterCount++
    }

    const cardioScore = Math.min(cardioCount / weekGoals.cardio.min, 1)
    const liftScore = Math.min(liftCount / weekGoals.lift.min, 1)
    const dietScore = Math.min(dietCount / weekGoals.diet.min, 1)
    const waterScore = Math.min(waterCount / weekGoals.water.min, 1)
    const percentage = Math.round(((cardioScore + liftScore + dietScore + waterScore) / 4) * 100) || 0

    weeks.push({
      id: weekDates[0],
      startDate: new Date(iter),
      goals: weekGoals,
      cardioCount,
      liftCount,
      dietCount,
      waterCount,
      percentage,
    })

    iter.setDate(iter.getDate() - 7)
  }

  return weeks
}

function habitIconTextClass(colorClass: string): string {
  if (colorClass.startsWith('bg-')) return colorClass.replace(/^bg-/, 'text-')
  return 'text-neutral-400'
}

function MiniGoalSummary({
  config,
  count,
  icon: IconComponent,
}: {
  config: HabitsGoals[keyof HabitsGoals]
  count: number
  icon: LucideIcon
}) {
  const total = config.max
  let row1Count = total
  let row2Count = 0
  if (total > 2) {
    row1Count = Math.floor(total / 2)
    row2Count = Math.ceil(total / 2)
  }

  const fillClass = config.color
  const borderClass = habitOutlineBorderClass(config.color)
  const iconClass = habitIconTextClass(config.color)

  const renderCircle = (index: number) => {
    const isOptional = index >= config.min
    const isFilled = index < count
    return (
      <div
        key={index}
        className={`w-1.5 h-1.5 rounded-full border ${
          isFilled ? `${fillClass} border-transparent` : `${borderClass} ${isOptional ? 'opacity-30' : ''}`
        }`}
      />
    )
  }

  return (
    <div className="flex items-center gap-2">
      <IconComponent size={14} className={iconClass} />
      <div className="flex flex-col items-center gap-1">
        <div className="flex justify-center gap-1">
          {Array.from({ length: row1Count }).map((_, i) => renderCircle(i))}
        </div>
        {row2Count > 0 && (
          <div className="flex justify-center gap-1">
            {Array.from({ length: row2Count }).map((_, i) => renderCircle(row1Count + i))}
          </div>
        )}
      </div>
    </div>
  )
}

export function HabitsWeekHistoryCard({ week }: { week: PastWeekSummary }) {
  const goals = week.goals
  return (
    <div className="bg-neutral-900 border border-neutral-800 rounded-[var(--radius-card)] p-4">
      <div className="flex justify-between items-center mb-4">
        <span className="font-bold text-white uppercase tracking-widest text-[10px]">
          Week of{' '}
          {week.startDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
        </span>
        <span
          className={`font-black text-sm ${week.percentage >= 100 ? 'text-emerald-400' : 'text-white'}`}
        >
          {week.percentage}%
        </span>
      </div>
      <div className="flex justify-between items-start px-1">
        <MiniGoalSummary config={goals.water} count={week.waterCount} icon={Droplet} />
        <MiniGoalSummary config={goals.diet} count={week.dietCount} icon={Apple} />
        <MiniGoalSummary config={goals.cardio} count={week.cardioCount} icon={Heart} />
        <MiniGoalSummary config={goals.lift} count={week.liftCount} icon={Dumbbell} />
      </div>
    </div>
  )
}
