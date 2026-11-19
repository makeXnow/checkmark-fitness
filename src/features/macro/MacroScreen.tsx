import { localDateISO } from '../../lib/localDate'
import { getApiProfile } from '../../core/apiProfile'
import type { MacroCustomFood, MacroDayItem, MacroGoals } from '../../types/domain'
import { MacroPromptSettings } from './MacroPromptSettings'
import { MACRO_PROMPTS_OWNER } from './prompts'
import { MacroSettings } from './MacroSettings'
import { MacroVoiceTracker } from './MacroVoiceTracker'

export function MacroScreen({
  currentDate,
  onVoiceVersion,
  goals,
  logs,
  customFoods,
  onSaveGoals,
  onSaveLogs,
  onSaveFoods,
  view,
}: {
  onVoiceVersion?: (version:number,date:string)=>Promise<void>
  currentDate: Date
  goals: MacroGoals
  logs: Record<string, MacroDayItem[]>
  customFoods: MacroCustomFood[]
  onSaveGoals: (g: MacroGoals) => void
  onSaveLogs?: (logs: Record<string, MacroDayItem[]>) => void
  onSaveFoods?: (foods: MacroCustomFood[]) => void
  view: 'tracker' | 'settings'
}) {
  const dateKey = localDateISO(currentDate)

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col">
      {view === 'tracker' && onSaveLogs && onSaveFoods && (
        <MacroVoiceTracker
          onVoiceVersion={onVoiceVersion}
          dateKey={dateKey}
          goals={goals}
          logs={logs}
          customFoods={customFoods}
          onSaveLogs={onSaveLogs}
          onSaveFoods={onSaveFoods}
        />
      )}

      {view === 'settings' && (
        <div className="flex flex-col gap-4 pb-[var(--app-main-pad-bottom)]">
          <MacroSettings goals={goals} onSaveGoals={onSaveGoals} />
          {getApiProfile() === MACRO_PROMPTS_OWNER ? <MacroPromptSettings /> : null}
        </div>
      )}
    </div>
  )
}
