import type { MacroCustomFood, MacroDayItem } from '../../types/domain'
import { MacroVoiceTracker } from './MacroVoiceTracker'

export function MacroScreen({
  currentDate,
  goals,
  logs,
  customFoods,
  onSaveGoals,
  onSaveLogs,
  onSaveFoods,
  view,
}: {
  currentDate: Date
  goals: { calorieGoal: number; proteinPctGoal: number }
  logs: Record<string, MacroDayItem[]>
  customFoods: MacroCustomFood[]
  onSaveGoals: (g: { calorieGoal: number; proteinPctGoal: number }) => void
  onSaveLogs?: (logs: Record<string, MacroDayItem[]>) => void
  onSaveFoods?: (foods: MacroCustomFood[]) => void
  view: 'tracker' | 'settings'
}) {
  const dateKey = currentDate.toISOString().split('T')[0]

  return (
    <div className="flex-1 flex flex-col gap-6">
      {view === 'tracker' && onSaveLogs && onSaveFoods && (
        <MacroVoiceTracker
          dateKey={dateKey}
          goals={goals}
          logs={logs}
          customFoods={customFoods}
          onSaveLogs={onSaveLogs}
          onSaveFoods={onSaveFoods}
        />
      )}

      {view === 'settings' && (
        <div className="space-y-6">
          <div>
            <label className="text-[10px] font-black opacity-30 uppercase tracking-widest block mb-2 text-white">
              Daily Calories
            </label>
            <input
              type="number"
              value={goals.calorieGoal}
              onChange={(e) => onSaveGoals({ ...goals, calorieGoal: parseInt(e.target.value, 10) || 0 })}
              className="w-full p-4 bg-white/5 rounded-2xl font-black text-xl text-white focus:ring-2 ring-emerald-500 outline-none border border-white/10"
            />
          </div>
          <div>
            <label className="text-[10px] font-black opacity-30 uppercase tracking-widest block mb-2 text-white">
              Protein Goal %
            </label>
            <input
              type="number"
              value={goals.proteinPctGoal}
              onChange={(e) => onSaveGoals({ ...goals, proteinPctGoal: parseInt(e.target.value, 10) || 0 })}
              className="w-full p-4 bg-white/5 rounded-2xl font-black text-xl text-white focus:ring-2 ring-emerald-500 outline-none border border-white/10"
            />
          </div>
        </div>
      )}
    </div>
  )
}
