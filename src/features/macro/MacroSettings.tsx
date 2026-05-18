import { useCallback, useEffect, useState } from 'react'
import {
  DEFAULT_MACRO_INPUTS,
  getMacrosForGoal,
  inputsValid,
  MACRO_GOAL_LABELS,
  MACRO_GOAL_MODES,
  matchGoalMode,
} from './macroCalculator'
import type { MacroGoalMode, MacroGoals } from '../../types/domain'

const numberInputClass =
  'w-full p-3 bg-black border border-neutral-700 rounded-xl text-white text-center font-bold outline-none focus:border-emerald-400 focus:ring-2 focus:ring-emerald-400/20 transition-all [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none'

const resultInputClass =
  'w-full text-center text-4xl font-black text-white bg-black border-2 border-neutral-700 rounded-xl p-4 outline-none focus:border-emerald-400 focus:ring-4 focus:ring-emerald-400/20 transition-all [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none'

const fieldLabelClass = 'block text-[10px] font-black text-neutral-500 uppercase tracking-widest mb-2'

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
  const [goalMode, setGoalMode] = useState<MacroGoalMode | null>(goals.goalMode ?? DEFAULT_MACRO_INPUTS.goalMode)
  const [isCustomMode, setIsCustomMode] = useState(() => goals.goalMode == null)

  useEffect(() => {
    setWeightLbs(String(goals.weightLbs ?? DEFAULT_MACRO_INPUTS.weightLbs))
    setBodyFatPct(String(goals.bodyFatPct ?? DEFAULT_MACRO_INPUTS.bodyFatPct))
    setActiveHours(String(goals.activeHours ?? DEFAULT_MACRO_INPUTS.activeHours))
    setCalories(String(goals.calorieGoal))
    setProteinPct(String(goals.proteinPctGoal))
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
      setCalories(String(macros.calories))
      setProteinPct(String(macros.proteinPercent))
      setIsCustomMode(false)
      setGoalMode(mode)
      onSaveGoals({
        ...inputs,
        calorieGoal: macros.calories,
        proteinPctGoal: macros.proteinPercent,
        goalMode: mode,
      })
    },
    [onSaveGoals, parseInputs],
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

      if (!inputsValid(w, bf)) {
        onSaveGoals({
          weightLbs: w,
          bodyFatPct: bf,
          activeHours: hrs,
          calorieGoal: parseInt(calories, 10) || 0,
          proteinPctGoal: parseInt(proteinPct, 10) || 0,
          goalMode: isCustomMode ? null : mode,
        })
        return
      }

      const macros = getMacrosForGoal(mode, { weightLbs: w, bodyFatPct: bf, activeHours: hrs })
      setCalories(String(macros.calories))
      setProteinPct(String(macros.proteinPercent))
      setIsCustomMode(false)
      setGoalMode(mode)
      onSaveGoals({
        weightLbs: w,
        bodyFatPct: bf,
        activeHours: hrs,
        calorieGoal: macros.calories,
        proteinPctGoal: macros.proteinPercent,
        goalMode: mode,
      })
    },
    [activeHours, bodyFatPct, calories, goalMode, isCustomMode, onSaveGoals, proteinPct, weightLbs],
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
      else setProteinPct(value)

      const inputCal = parseInt(field === 'calories' ? value : calories, 10)
      const inputProt = parseInt(field === 'protein' ? value : proteinPct, 10)
      const inputs = parseInputs()

      if (
        !inputsValid(inputs.weightLbs, inputs.bodyFatPct) ||
        !Number.isFinite(inputCal) ||
        !Number.isFinite(inputProt)
      ) {
        return
      }

      const matched = matchGoalMode(inputs, inputCal, inputProt)
      const custom = matched === null
      setIsCustomMode(custom)
      setGoalMode(matched)
      onSaveGoals({
        ...inputs,
        calorieGoal: inputCal,
        proteinPctGoal: inputProt,
        goalMode: matched,
      })
    },
    [calories, onSaveGoals, parseInputs, proteinPct],
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

      <div
        className={`flex flex-col sm:flex-row gap-4 ${showError ? 'opacity-50 pointer-events-none' : ''}`}
      >
        <div className="flex-1 w-full">
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
        <div className="flex-1 w-full">
          <label htmlFor="macro-result-protein" className={fieldLabelClass}>
            Protein (%)
          </label>
          <input
            id="macro-result-protein"
            type="number"
            inputMode="numeric"
            value={proteinPct}
            onChange={(e) => handleResultChange('protein', e.target.value)}
            className={resultInputClass}
          />
        </div>
      </div>
    </section>
  )
}
