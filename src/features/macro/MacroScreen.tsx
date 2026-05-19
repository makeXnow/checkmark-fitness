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
  showDock = false,
}: {
  currentDate: Date
  goals: MacroGoals
  logs: Record<string, MacroDayItem[]>
  customFoods: MacroCustomFood[]
  onSaveGoals: (g: MacroGoals) => void
  onSaveLogs?: (logs: Record<string, MacroDayItem[]>) => void
  onSaveFoods?: (foods: MacroCustomFood[]) => void
  view: 'tracker' | 'settings'
  /** When false, the food input dock is hidden (e.g. another bottom tab is active). */
  showDock?: boolean
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
          showDock={showDock}
          onSaveLogs={onSaveLogs}
          onSaveFoods={onSaveFoods}
        />
      )}

      {view === 'settings' && <MacroSettings goals={goals} onSaveGoals={onSaveGoals} />}
    </div>
  )
}
