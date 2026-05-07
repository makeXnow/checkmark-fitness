import { Apple, Dumbbell, Droplet, Heart } from 'lucide-react'
import type { HabitsGoals, DayLog } from '../../types/domain'

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
    const pieStyle = isWaterActiveDay
      ? { backgroundImage: `conic-gradient(#3b82f6 ${waterPercent}%, transparent 0)` }
      : {}

    /** No “next slot” outline once this habit is done for the selected day (water partial already requires !todayDone). */
    const showHabitOutline =
      !todayDone && nextSlotIndex >= 0 && index === nextSlotIndex && !isFilled && !isWaterActiveDay

    const emptyBorder = showHabitOutline
      ? outlineBorder
      : isOptional
        ? 'border-neutral-700 opacity-30'
        : 'border-neutral-700'

    return (
      <div
        key={index}
        className={[
          'w-5 h-5 rounded-full border-[3px] transition-all duration-500',
          isFilled ? `${config.color} border-transparent scale-110 shadow-lg shadow-black/40` : '',
          isWaterActiveDay ? 'border-neutral-700' : '',
          !isFilled && !isWaterActiveDay ? emptyBorder : '',
        ]
          .filter(Boolean)
          .join(' ')}
        style={pieStyle}
      />
    )
  }

  return (
    <button
      type="button"
      onClick={onTap}
      className={`relative overflow-hidden cursor-pointer select-none rounded-[var(--radius-card)] p-5 h-40 flex flex-col justify-between transition-all duration-300 border w-full text-left ${
        todayDone || (isWater && waterToday > 0)
          ? 'bg-neutral-800 border-neutral-700 shadow-md'
          : 'bg-neutral-900 border-neutral-800'
      } active:scale-95`}
    >
      <div className="flex justify-between items-start z-10">
        <div
          className={`p-2 rounded-xl transition-colors ${
            todayDone || (isWater && waterToday > 0) ? config.color : 'bg-black border border-neutral-800'
          }`}
        >
          <IconComponent
            className={
              todayDone || (isWater && waterToday > 0) ? 'text-white w-5 h-5' : 'text-neutral-500 w-5 h-5'
            }
          />
        </div>
        <span
          className={`text-[9px] font-black uppercase tracking-[0.15em] ${
            todayDone || (isWater && waterToday > 0) ? 'text-neutral-300' : 'text-neutral-500'
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
