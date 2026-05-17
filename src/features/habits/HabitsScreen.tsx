import { useMemo } from 'react'
import { localDateISO } from '../../lib/localDate'
import type { HabitsGoals, DayLog } from '../../types/domain'
import {
  DualSlider,
  GoalCard,
  HabitColorPicker,
  HabitsWeekHistoryCard,
  computePastWeeks,
  computeWeeklyProgress,
  getWeekDatesFor,
  habitOrder,
} from './habitsUi'

export function HabitsScreen({
  currentDate,
  goals,
  logs,
  appSettings,
  onSaveGoals,
  onSaveLogs,
  onSaveAppSettings,
  view,
}: {
  currentDate: Date
  goals: HabitsGoals
  logs: Record<string, DayLog>
  appSettings: { firstDayOfWeek: number }
  onSaveGoals: (g: HabitsGoals) => void
  onSaveLogs: (l: Record<string, DayLog>) => void
  onSaveAppSettings: (s: { firstDayOfWeek: number }) => void
  view: 'tracker' | 'settings'
}) {
  const dateKey = localDateISO(currentDate)

  const weekDates = useMemo(
    () => getWeekDatesFor(currentDate, appSettings.firstDayOfWeek),
    [currentDate, appSettings.firstDayOfWeek],
  )

  const pastWeeks = useMemo(
    () => computePastWeeks(logs, currentDate, appSettings.firstDayOfWeek, goals),
    [logs, currentDate, appSettings.firstDayOfWeek, goals],
  )

  const currentDayLog = logs[dateKey] || {}
  const weeklyProgress = useMemo(() => computeWeeklyProgress(weekDates, logs, goals), [weekDates, logs, goals])
  const waterToday = currentDayLog.water || 0

  const completedToday = useMemo(
    () => ({
      cardio: !!currentDayLog.cardio,
      lift: !!currentDayLog.lift,
      diet: !!currentDayLog.diet,
      water: (currentDayLog.water || 0) >= goals.water.dailyTarget!,
    }),
    [currentDayLog, goals.water.dailyTarget],
  )

  const handleCardTap = (key: keyof HabitsGoals) => {
    const nextLogs = { ...logs }
    const dayLog: DayLog = { ...(nextLogs[dateKey] || {}) }
    if (key === 'water') {
      const isCurrentlyDone = (dayLog.water || 0) >= goals.water.dailyTarget!
      if (isCurrentlyDone) {
        dayLog.water = 0
      } else {
        dayLog.water = (dayLog.water || 0) + 1
      }
    } else {
      dayLog[key] = !dayLog[key]
    }
    nextLogs[dateKey] = dayLog
    onSaveLogs(nextLogs)
  }

  const patchGoal = (key: keyof HabitsGoals, patch: Partial<HabitsGoals[keyof HabitsGoals]>) => {
    onSaveGoals({ ...goals, [key]: { ...goals[key], ...patch } } as HabitsGoals)
  }

  return (
    <div className="flex-1 flex flex-col">
      {view === 'tracker' && (
        <div className="flex flex-col gap-10">
          <div className="grid grid-cols-2 gap-3 content-start">
            {habitOrder.map((key) => (
              <GoalCard
                key={key}
                goalKey={key}
                config={goals[key]}
                weeklyCount={key === 'water' ? weeklyProgress.waterWeekly : weeklyProgress[key as 'cardio' | 'lift' | 'diet']}
                todayDone={completedToday[key]}
                waterToday={key === 'water' ? waterToday : 0}
                onTap={() => handleCardTap(key)}
              />
            ))}
          </div>

          {pastWeeks.length > 0 && (
            <section className="space-y-3">
              <p className="text-[10px] font-black text-neutral-500 uppercase tracking-widest px-1">History</p>
              <div className="space-y-3">
                {pastWeeks.map((week) => (
                  <HabitsWeekHistoryCard key={week.id} week={week} goals={goals} />
                ))}
              </div>
            </section>
          )}
        </div>
      )}

      {view === 'settings' && (
      <section className="space-y-3">
        <p className="text-[10px] font-black text-neutral-500 uppercase tracking-widest px-1">Goal Targets</p>
        {habitOrder.map((key) => {
          const config = goals[key]
          return (
            <div key={key} className="bg-neutral-900 border border-neutral-800 p-4 rounded-[var(--radius-card)]">
              <div className="flex justify-between items-center mb-1">
                <span className="font-bold text-white uppercase tracking-widest text-xs">{config.label}</span>
                <div className="flex gap-3 text-[10px] font-black text-neutral-500">
                  <span>Min {config.min}</span>
                  <span className="text-neutral-400">Max {config.max}</span>
                </div>
              </div>
              <DualSlider
                minLim={1}
                maxLim={7}
                val1={config.min}
                val2={config.max}
                setVal1={(v) => patchGoal(key, { min: v })}
                setVal2={(v) => patchGoal(key, { max: v })}
                colorClass={config.color}
              />
              <HabitColorPicker value={config.color} onChange={(color) => patchGoal(key, { color })} />
            </div>
          )
        })}

        <div className="bg-blue-500/10 border border-blue-500/20 p-4 rounded-[var(--radius-card)] space-y-3">
          <div className="flex justify-between items-center">
            <span className="text-[10px] font-black text-blue-400 uppercase tracking-widest">Bottles per day</span>
            <span className="text-sm font-black text-blue-400">{goals.water.dailyTarget}</span>
          </div>
          <input
            type="range"
            min={1}
            max={12}
            value={goals.water.dailyTarget}
            onChange={(e) => patchGoal('water', { dailyTarget: parseInt(e.target.value, 10) })}
            className="w-full h-1.5 bg-blue-900/50 rounded-lg appearance-none cursor-pointer accent-blue-400"
          />
        </div>

        <div className="bg-neutral-900 border border-neutral-800 p-4 rounded-[var(--radius-card)] space-y-3">
          <span className="font-bold text-white uppercase tracking-widest text-xs">First Day of Week</span>
          <div className="flex bg-black rounded-lg p-1 border border-neutral-800">
            <button
              type="button"
              onClick={() => onSaveAppSettings({ firstDayOfWeek: 0 })}
              className={`flex-1 py-2.5 text-center text-[10px] font-black uppercase rounded-md transition-colors ${
                appSettings.firstDayOfWeek === 0 ? 'bg-emerald-400 text-black' : 'text-neutral-500'
              }`}
            >
              Sunday
            </button>
            <button
              type="button"
              onClick={() => onSaveAppSettings({ firstDayOfWeek: 1 })}
              className={`flex-1 py-2.5 text-center text-[10px] font-black uppercase rounded-md transition-colors ${
                appSettings.firstDayOfWeek === 1 ? 'bg-emerald-400 text-black' : 'text-neutral-500'
              }`}
            >
              Monday
            </button>
          </div>
        </div>
      </section>
      )}
    </div>
  )
}
