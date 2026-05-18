import type { MacroCustomFood, MacroDayItem, MacroGoals } from '../../types/domain'
import { MacroSettings } from './MacroSettings'
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
  goals: MacroGoals
  logs: Record<string, MacroDayItem[]>
  customFoods: MacroCustomFood[]
  onSaveGoals: (g: MacroGoals) => void
  onSaveLogs?: (logs: Record<string, MacroDayItem[]>) => void
  onSaveFoods?: (foods: MacroCustomFood[]) => void
  view: 'tracker' | 'settings'
}) {
  const dateKey = currentDate.toISOString().split('T')[0]

  return (
    <div className="flex-1 flex flex-col gap-4">
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

      {view === 'settings' && <MacroSettings goals={goals} onSaveGoals={onSaveGoals} />}
    </div>
  )
}
