import { ChevronDown, ChevronRight } from 'lucide-react'
import { fatSecretFoodLabel } from './servingAuditLib'
import type { FatSecretFoodRef } from '../../types/domain'

export function ServingCell({
  fields,
  baseLabel,
}: {
  fields: { display: string; servingMultiplier: number; servingSize: number; servingUnit: string } | null
  baseLabel?: string
}) {
  if (!fields) {
    return <span className="text-white/35 italic">—</span>
  }

  return (
    <div className="space-y-0.5">
      <p className="font-semibold text-white/90">{fields.display}</p>
      <p className="text-[11px] text-white/45">
        {baseLabel ?? 'Base'}: {fields.servingMultiplier} × {fields.servingSize} {fields.servingUnit}
      </p>
    </div>
  )
}

export function FatSecretMatchPicker({
  selectedFood,
  selectedFoodIndex,
  selectedServing,
  selectedServingIndex,
  fatSecretResults,
  expanded,
  onToggle,
}: {
  selectedFood: FatSecretFoodRef | null
  selectedFoodIndex: number | null
  selectedServing: { description: string; calories: number } | null
  selectedServingIndex: number | null
  fatSecretResults: FatSecretFoodRef[]
  expanded: boolean
  onToggle: () => void
}) {
  if (!selectedFood) {
    return <span className="text-white/35 italic text-xs">No FatSecret match</span>
  }

  const title = fatSecretFoodLabel(selectedFood)
  const servingLine = selectedServing
    ? `${selectedServing.description} · ${selectedServing.calories} cal`
    : 'No serving info'

  return (
    <div>
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-start gap-1.5 text-left rounded-lg px-1 py-0.5 -mx-1 hover:bg-white/5"
      >
        {expanded ? (
          <ChevronDown className="size-4 shrink-0 text-emerald-400/80 mt-0.5" />
        ) : (
          <ChevronRight className="size-4 shrink-0 text-white/40 mt-0.5" />
        )}
        <span className="min-w-0">
          <span className="block text-sm font-semibold text-white/90 leading-snug">{title}</span>
          <span className="block text-[11px] text-white/45 mt-0.5">{servingLine}</span>
        </span>
      </button>

      {expanded && fatSecretResults.length > 0 ? (
        <ul className="mt-2 ml-5 space-y-2 border-l border-white/10 pl-3 max-h-56 overflow-y-auto">
          {fatSecretResults.map((food, foodIdx) => {
            const foodIndex = foodIdx + 1
            const selected = foodIndex === selectedFoodIndex
            return (
              <li
                key={food.foodId || foodIdx}
                className={`rounded-lg border p-2 ${
                  selected
                    ? 'border-emerald-400/40 bg-emerald-400/10'
                    : 'border-white/10 bg-white/[0.03]'
                }`}
              >
                <p className="text-xs font-bold text-white/85">
                  {foodIndex}. {fatSecretFoodLabel(food)}
                  {selected ? <span className="text-emerald-400/90"> · selected</span> : null}
                </p>
                <ul className="mt-1 space-y-0.5">
                  {food.servings.map((serving, servingIdx) => {
                    const servingIndex = servingIdx + 1
                    const servingSelected = selected && servingIndex === selectedServingIndex
                    return (
                      <li
                        key={serving.servingId || servingIdx}
                        className={`text-[11px] ${servingSelected ? 'text-emerald-300/90' : 'text-white/50'}`}
                      >
                        {servingIndex}. {serving.description}: {serving.calories} cal, {serving.protein}g protein
                      </li>
                    )
                  })}
                </ul>
              </li>
            )
          })}
        </ul>
      ) : null}
    </div>
  )
}
