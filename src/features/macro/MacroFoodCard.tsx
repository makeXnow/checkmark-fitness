import { Check, Loader2, RefreshCw, Trash2 } from 'lucide-react'

export type MacroFoodEditFields = {
  emoji: string
  name: string
  amount: string
  calories: number
  protein: number
}

export function MacroMiniCard({
  value,
  label,
  color,
  suffix = '',
}: {
  value: number
  label: string
  color: string
  suffix?: string
}) {
  return (
    <div className="flex flex-col items-center justify-center min-w-[40px]">
      <span className={`text-sm font-black leading-none ${color}`}>
        {value}
        {suffix}
      </span>
      <span className="text-[8px] font-black opacity-40 uppercase tracking-widest mt-1 text-white">{label}</span>
    </div>
  )
}

const numberInputClass =
  'w-full bg-transparent font-bold text-xs py-2.5 text-center outline-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none'

function MacroFieldInput({
  value,
  onChange,
  placeholder,
  label,
  colorClass = 'text-white',
  type = 'text',
  proteinSplit = false,
  inputId,
}: {
  value: string | number
  onChange: (v: string) => void
  placeholder: string
  label: string
  colorClass?: string
  type?: 'text' | 'number'
  proteinSplit?: boolean
  inputId?: string
}) {
  const display = value === 0 && type === 'number' ? '' : String(value)

  if (proteinSplit) {
    return (
      <div
        className="flex-1 flex bg-white/5 rounded-xl overflow-hidden focus-within:bg-white/10 transition-colors cursor-text relative"
        onClick={() => inputId && document.getElementById(inputId)?.focus()}
      >
        <div className="flex-1 flex items-center justify-center">
          <input
            id={inputId}
            value={display}
            onChange={(e) => onChange(e.target.value)}
            className={`w-1/2 bg-transparent ${colorClass} font-bold text-xs py-2.5 text-right outline-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none pr-0.5`}
            type="number"
            placeholder="0"
          />
          <span className={`w-1/2 ${colorClass} font-bold text-xs py-2.5 text-left pointer-events-none`}>g</span>
        </div>
        <span className="text-[9px] font-black opacity-30 uppercase self-center absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none">
          {label}
        </span>
      </div>
    )
  }

  return (
    <div className="flex-1 flex bg-white/5 rounded-xl overflow-hidden focus-within:bg-white/10 transition-colors">
      <input
        id={inputId}
        value={display}
        onChange={(e) => onChange(e.target.value)}
        className={`${numberInputClass} pl-2 ${colorClass}`}
        placeholder={placeholder}
        type={type}
      />
      <span className="text-[9px] font-black opacity-30 uppercase self-center pr-2.5 shrink-0">{label}</span>
    </div>
  )
}

export function MacroFoodEditCard({
  fieldId,
  data,
  onChange,
  onReset,
  onDelete,
  onSave,
  saveDisabled = false,
  autoFocusName = false,
}: {
  fieldId: string
  data: MacroFoodEditFields
  onChange: (data: MacroFoodEditFields) => void
  onReset: () => void
  onDelete: () => void
  onSave: () => void
  saveDisabled?: boolean
  autoFocusName?: boolean
}) {
  const proteinInputId = `macro-protein-${fieldId}`

  return (
    <div className="bg-[var(--color-surface)] rounded-2xl border border-white/10 overflow-hidden shadow-2xl flex flex-col gap-px">
      <div className="p-3 bg-white/[0.02] flex gap-3">
        <input
          value={data.emoji}
          onChange={(e) => onChange({ ...data, emoji: e.target.value })}
          className="w-12 h-12 bg-white/5 rounded-xl text-2xl text-center outline-none focus:ring-1 focus:ring-emerald-500/50 transition-all shrink-0"
          placeholder="🍱"
          aria-label="Emoji"
        />
        <input
          autoFocus={autoFocusName}
          value={data.name}
          onChange={(e) => onChange({ ...data, name: e.target.value })}
          className="flex-1 bg-white/5 rounded-xl px-3 font-bold text-sm text-white outline-none focus:ring-1 focus:ring-emerald-500/50 transition-all min-w-0"
          placeholder="Food name"
        />
      </div>

      <div className="p-3 bg-white/[0.02]">
        <div className="flex gap-2 w-full">
          <MacroFieldInput
            value={data.amount}
            onChange={(v) => onChange({ ...data, amount: v })}
            placeholder="Serv"
            label="Serv"
          />
          <MacroFieldInput
            value={data.calories}
            onChange={(v) => onChange({ ...data, calories: parseFloat(v) || 0 })}
            placeholder="Cal"
            label="Cal"
            colorClass="text-emerald-400"
            type="number"
          />
          <MacroFieldInput
            value={data.protein}
            onChange={(v) => onChange({ ...data, protein: parseFloat(v) || 0 })}
            placeholder="0"
            label="Pro"
            colorClass="text-blue-400"
            type="number"
            proteinSplit
            inputId={proteinInputId}
          />
        </div>
      </div>

      <div className="flex justify-between items-center px-4 py-2 bg-white/[0.04]">
        <div className="flex gap-2">
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation()
              onReset()
            }}
            className="p-2 text-emerald-400 hover:bg-emerald-400/10 rounded-lg transition-colors"
            title="Re-estimate macros"
            aria-label="Re-estimate macros"
          >
            <RefreshCw size={16} strokeWidth={2.5} />
          </button>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation()
              onDelete()
            }}
            className="p-2 text-red-400 hover:bg-red-400/10 rounded-lg transition-colors"
            aria-label="Delete"
          >
            <Trash2 size={16} strokeWidth={2.5} />
          </button>
        </div>
        <button
          type="button"
          disabled={saveDisabled}
          onClick={(e) => {
            e.stopPropagation()
            onSave()
          }}
          className="p-2 bg-emerald-500 hover:bg-emerald-400 disabled:opacity-40 text-white rounded-lg shadow-lg active:scale-95 transition-all"
          aria-label="Save"
        >
          <Check size={18} strokeWidth={3} />
        </button>
      </div>
    </div>
  )
}

export function MacroFoodViewCard({
  emoji,
  name,
  amount,
  calories,
  protein,
  pending = false,
  onClick,
}: {
  emoji?: string
  name: string
  amount: string
  calories: number
  protein: number
  pending?: boolean
  onClick: () => void
}) {
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(e) => e.key === 'Enter' && onClick()}
      className={`relative bg-white/5 hover:bg-white/10 p-4 rounded-[1.75rem] border border-white/5 transition-all cursor-pointer group ${pending ? 'opacity-80' : ''}`}
    >
      {pending && (
        <div className="absolute inset-0 bg-black/20 flex items-center justify-center rounded-[1.75rem] z-10">
          <Loader2 className="animate-spin text-emerald-500 opacity-60" size={20} aria-hidden />
        </div>
      )}
      <div className="relative flex items-center gap-3 w-full">
        <div className="w-10 flex items-center justify-center text-[28px] shrink-0 drop-shadow-md">{emoji || '🍱'}</div>
        <div className="flex flex-1 items-center justify-between min-w-0">
          <div className="flex flex-col min-w-0 flex-grow pr-2">
            <h3 className="font-bold text-white/90 text-[15px] leading-tight truncate group-hover:text-white transition-colors">
              {name}
            </h3>
            <p className="text-[11px] font-black opacity-40 uppercase tracking-tight truncate mt-0.5">{amount}</p>
          </div>
          <div className="flex items-center gap-4 shrink-0 px-1">
            <MacroMiniCard value={Math.round(calories)} label="Calories" color="text-emerald-400" />
            <MacroMiniCard value={Math.round(protein)} label="Protein" color="text-blue-400" suffix="g" />
          </div>
        </div>
      </div>
    </div>
  )
}

function itemToEditFields(item: {
  emoji?: string
  name: string
  amount: string
  calories?: number
  protein?: number
}): MacroFoodEditFields {
  return {
    emoji: item.emoji || '🍱',
    name: item.name,
    amount: item.amount,
    calories: item.calories ?? 0,
    protein: item.protein ?? 0,
  }
}

export { itemToEditFields }
