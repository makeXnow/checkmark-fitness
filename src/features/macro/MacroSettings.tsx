import { useCallback, useEffect, useState } from 'react'
import {
  DEFAULT_MACRO_INPUTS,
  getMacrosForGoal,
  inputsValid,
  MACRO_GOAL_LABELS,
  MACRO_GOAL_MODES,
  matchGoalMode,
  proteinGramsFromPct,
  proteinPctFromGrams,
} from './macroCalculator'
import { SettingSwitch } from '../../core/SettingSwitch'
import type { MacroGoalMode, MacroGoals, ProteinTrackMode } from '../../types/domain'

const numberInputClass =
  'w-full p-3 bg-black border border-neutral-700 rounded-xl text-white text-center font-bold outline-none focus:border-emerald-400 focus:ring-2 focus:ring-emerald-400/20 transition-all [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none'

const resultInputClass =
  'w-full text-center text-4xl font-black text-white bg-black border-2 border-neutral-700 rounded-xl p-4 outline-none focus:border-emerald-400 focus:ring-4 focus:ring-emerald-400/20 transition-all [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none'

const fieldLabelClass = 'block text-[10px] font-black text-neutral-500 uppercase tracking-widest mb-2'

function syncProteinGoals(
  calorieGoal: number,
  trackMode: ProteinTrackMode,
  proteinPct: number,
  proteinGrams: number,
): { proteinPctGoal: number; proteinGramsGoal: number } {
  if (trackMode === 'grams') {
    const proteinGramsGoal = Math.round(proteinGrams) || 0
    return {
      proteinGramsGoal,
      proteinPctGoal: proteinPctFromGrams(calorieGoal, proteinGramsGoal),
    }
  }
  const proteinPctGoal = Math.round(proteinPct) || 0
  return {
    proteinPctGoal,
    proteinGramsGoal: proteinGramsFromPct(calorieGoal, proteinPctGoal),
  }
}

export function MacroSettings({
  goals,
  onSaveGoals,
}: {
  goals: MacroGoals
  onSaveGoals: (g: MacroGoals) => void
}) {
  const [weightLbs, setWeightLbs] = useState(String(goals.weightLbs ?? DEFAULT_MACRO_INPUTS.weightLbs))
  const [bodyFatPct, setBodyFatPct] = useState(String(goals.bodyFatPct ?? DEFAULT_MACRO_INPUTS.bodyFatPct))
  const [activeHours, setActiveHours] = useState(String(goals.activeHours ?? DEFAULT_MACRO_INPUTS.activeHours))
  const [calories, setCalories] = useState(String(goals.calorieGoal))
  const [proteinPct, setProteinPct] = useState(String(goals.proteinPctGoal))
  const [proteinGrams, setProteinGrams] = useState(
    String(goals.proteinGramsGoal ?? proteinGramsFromPct(goals.calorieGoal, goals.proteinPctGoal)),
  )
  const [proteinTrackMode, setProteinTrackMode] = useState<ProteinTrackMode>(goals.proteinTrackMode ?? 'percent')
  const [goalMode, setGoalMode] = useState<MacroGoalMode | null>(goals.goalMode ?? DEFAULT_MACRO_INPUTS.goalMode)
  const [isCustomMode, setIsCustomMode] = useState(() => goals.goalMode == null)

  useEffect(() => {
    setWeightLbs(String(goals.weightLbs ?? DEFAULT_MACRO_INPUTS.weightLbs))
    setBodyFatPct(String(goals.bodyFatPct ?? DEFAULT_MACRO_INPUTS.bodyFatPct))
    setActiveHours(String(goals.activeHours ?? DEFAULT_MACRO_INPUTS.activeHours))
    setCalories(String(goals.calorieGoal))
    setProteinPct(String(goals.proteinPctGoal))
    setProteinGrams(
      String(goals.proteinGramsGoal ?? proteinGramsFromPct(goals.calorieGoal, goals.proteinPctGoal)),
    )
    setProteinTrackMode(goals.proteinTrackMode ?? 'percent')
    setGoalMode(goals.goalMode ?? null)
    setIsCustomMode(goals.goalMode == null)
  }, [goals])

  const parseInputs = useCallback(() => {
    const w = parseFloat(weightLbs)
    const bf = parseFloat(bodyFatPct)
    const hrs = parseFloat(activeHours) || 0
    return { weightLbs: w, bodyFatPct: bf, activeHours: hrs }
  }, [weightLbs, bodyFatPct, activeHours])

  const updateFromPrimaryInputs = useCallback(
    (mode: MacroGoalMode) => {
      const inputs = parseInputs()
      if (!inputsValid(inputs.weightLbs, inputs.bodyFatPct)) return
      const macros = getMacrosForGoal(mode, inputs)
      const protein = syncProteinGoals(
        macros.calories,
        proteinTrackMode,
        macros.proteinPercent,
        proteinGramsFromPct(macros.calories, macros.proteinPercent),
      )
      setCalories(String(macros.calories))
      setProteinPct(String(protein.proteinPctGoal))
      setProteinGrams(String(protein.proteinGramsGoal))
      setIsCustomMode(false)
      setGoalMode(mode)
      onSaveGoals({
        ...inputs,
        calorieGoal: macros.calories,
        ...protein,
        proteinTrackMode,
        goalMode: mode,
      })
    },
    [onSaveGoals, parseInputs, proteinTrackMode],
  )

  const handlePrimaryChange = useCallback(
    (field: 'weight' | 'bf' | 'activity', value: string) => {
      if (field === 'weight') setWeightLbs(value)
      else if (field === 'bf') setBodyFatPct(value)
      else setActiveHours(value)

      const w = parseFloat(field === 'weight' ? value : weightLbs)
      const bf = parseFloat(field === 'bf' ? value : bodyFatPct)
      const hrs = parseFloat(field === 'activity' ? value : activeHours) || 0
      const mode = goalMode ?? DEFAULT_MACRO_INPUTS.goalMode

      const calorieGoal = parseInt(calories, 10) || 0
      if (!inputsValid(w, bf)) {
        const protein = syncProteinGoals(
          calorieGoal,
          proteinTrackMode,
          parseInt(proteinPct, 10) || 0,
          parseInt(proteinGrams, 10) || 0,
        )
        onSaveGoals({
          weightLbs: w,
          bodyFatPct: bf,
          activeHours: hrs,
          calorieGoal,
          ...protein,
          proteinTrackMode,
          goalMode: isCustomMode ? null : mode,
        })
        return
      }

      const macros = getMacrosForGoal(mode, { weightLbs: w, bodyFatPct: bf, activeHours: hrs })
      const protein = syncProteinGoals(
        macros.calories,
        proteinTrackMode,
        macros.proteinPercent,
        proteinGramsFromPct(macros.calories, macros.proteinPercent),
      )
      setCalories(String(macros.calories))
      setProteinPct(String(protein.proteinPctGoal))
      setProteinGrams(String(protein.proteinGramsGoal))
      setIsCustomMode(false)
      setGoalMode(mode)
      onSaveGoals({
        weightLbs: w,
        bodyFatPct: bf,
        activeHours: hrs,
        calorieGoal: macros.calories,
        ...protein,
        proteinTrackMode,
        goalMode: mode,
      })
    },
    [
      activeHours,
      bodyFatPct,
      calories,
      goalMode,
      isCustomMode,
      onSaveGoals,
      proteinGrams,
      proteinPct,
      proteinTrackMode,
      weightLbs,
    ],
  )

  const handleGoalClick = useCallback(
    (mode: MacroGoalMode) => {
      setGoalMode(mode)
      updateFromPrimaryInputs(mode)
    },
    [updateFromPrimaryInputs],
  )

  const handleResultChange = useCallback(
    (field: 'calories' | 'protein', value: string) => {
      if (field === 'calories') setCalories(value)
      else if (proteinTrackMode === 'grams') setProteinGrams(value)
      else setProteinPct(value)

      const inputCal = parseInt(field === 'calories' ? value : calories, 10)
      const inputProtPct = parseInt(proteinTrackMode === 'percent' && field === 'protein' ? value : proteinPct, 10)
      const inputProtGrams = parseInt(proteinTrackMode === 'grams' && field === 'protein' ? value : proteinGrams, 10)
      const inputs = parseInputs()

      if (
        !inputsValid(inputs.weightLbs, inputs.bodyFatPct) ||
        !Number.isFinite(inputCal) ||
        (proteinTrackMode === 'percent' ? !Number.isFinite(inputProtPct) : !Number.isFinite(inputProtGrams))
      ) {
        return
      }

      const protein = syncProteinGoals(
        inputCal,
        proteinTrackMode,
        inputProtPct,
        inputProtGrams,
      )
      const matched = matchGoalMode(inputs, inputCal, protein.proteinPctGoal)
      const custom = matched === null
      setIsCustomMode(custom)
      setGoalMode(matched)
      setProteinPct(String(protein.proteinPctGoal))
      setProteinGrams(String(protein.proteinGramsGoal))
      onSaveGoals({
        ...inputs,
        calorieGoal: inputCal,
        ...protein,
        proteinTrackMode,
        goalMode: matched,
      })
    },
    [calories, onSaveGoals, parseInputs, proteinGrams, proteinPct, proteinTrackMode],
  )

  const handleProteinTrackModeChange = useCallback(
    (mode: ProteinTrackMode) => {
      setProteinTrackMode(mode)
      const inputCal = parseInt(calories, 10) || 0
      const protein = syncProteinGoals(
        inputCal,
        mode,
        parseInt(proteinPct, 10) || 0,
        parseInt(proteinGrams, 10) || 0,
      )
      setProteinPct(String(protein.proteinPctGoal))
      setProteinGrams(String(protein.proteinGramsGoal))
      const inputs = parseInputs()
      onSaveGoals({
        ...inputs,
        calorieGoal: inputCal,
        ...protein,
        proteinTrackMode: mode,
        goalMode: isCustomMode ? null : goalMode,
      })
    },
    [calories, goalMode, isCustomMode, onSaveGoals, parseInputs, proteinGrams, proteinPct],
  )

  const inputs = parseInputs()
  const showError = !inputsValid(inputs.weightLbs, inputs.bodyFatPct)
  const activeGoal = isCustomMode ? null : goalMode

  return (
    <section className="space-y-6">
      <div className="bg-neutral-900 border border-neutral-800 p-4 rounded-[var(--radius-card)] space-y-6">
        <div className="grid grid-cols-3 gap-3">
          <div>
            <label htmlFor="macro-weight" className={fieldLabelClass}>
              Weight (lbs)
            </label>
            <input
              id="macro-weight"
              type="number"
              inputMode="decimal"
              value={weightLbs}
              onChange={(e) => handlePrimaryChange('weight', e.target.value)}
              className={numberInputClass}
              placeholder="175"
            />
          </div>
          <div>
            <label htmlFor="macro-bf" className={fieldLabelClass}>
              BF %
            </label>
            <input
              id="macro-bf"
              type="number"
              inputMode="decimal"
              value={bodyFatPct}
              onChange={(e) => handlePrimaryChange('bf', e.target.value)}
              className={numberInputClass}
              placeholder="17"
            />
          </div>
          <div>
            <label htmlFor="macro-activity" className={fieldLabelClass}>
              Active Hrs
            </label>
            <input
              id="macro-activity"
              type="number"
              inputMode="decimal"
              value={activeHours}
              onChange={(e) => handlePrimaryChange('activity', e.target.value)}
              className={numberInputClass}
              placeholder="6"
            />
          </div>
        </div>

        <div>
          <p className={`${fieldLabelClass} mb-3`}>Goal Mode</p>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {MACRO_GOAL_MODES.map((mode) => {
              const selected = activeGoal === mode
              return (
                <button
                  key={mode}
                  type="button"
                  onClick={() => handleGoalClick(mode)}
                  className={`p-2.5 rounded-lg font-black uppercase tracking-wide text-[10px] transition-all ${
                    selected
                      ? 'bg-emerald-400 text-black shadow-lg shadow-emerald-400/20'
                      : 'bg-black text-neutral-400 border border-neutral-800 hover:border-neutral-600 hover:text-neutral-200'
                  }`}
                >
                  {MACRO_GOAL_LABELS[mode]}
                </button>
              )
            })}
          </div>
        </div>
      </div>

      {showError && (
        <div className="p-4 bg-red-950/50 border border-red-900/60 text-red-300 rounded-xl text-sm text-center">
          Enter valid positive numbers for weight and body fat %.
        </div>
      )}

      <div className={`space-y-4 ${showError ? 'opacity-50 pointer-events-none' : ''}`}>
        <div className="flex flex-row flex-wrap gap-4">
          <div className="w-32 shrink-0">
            <label htmlFor="macro-result-calories" className={fieldLabelClass}>
              Calories
            </label>
            <input
              id="macro-result-calories"
              type="number"
              inputMode="numeric"
              value={calories}
              onChange={(e) => handleResultChange('calories', e.target.value)}
              className={resultInputClass}
            />
          </div>
          <div className="min-w-32 flex-1">
            <label htmlFor="macro-result-protein" className={fieldLabelClass}>
              {proteinTrackMode === 'grams' ? 'Protein (g)' : 'Protein (%)'}
            </label>
            <input
              id="macro-result-protein"
              type="number"
              inputMode="numeric"
              value={proteinTrackMode === 'grams' ? proteinGrams : proteinPct}
              onChange={(e) => handleResultChange('protein', e.target.value)}
              className={resultInputClass}
            />
          </div>
        </div>
        <SettingSwitch
          label="Track protein as grams"
          checked={proteinTrackMode === 'grams'}
          ariaLabel="Track protein as grams"
          onCheckedChange={(grams) => handleProteinTrackModeChange(grams ? 'grams' : 'percent')}
        />
      </div>
    </section>
  )
}
