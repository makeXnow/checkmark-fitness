import type { ReactNode } from 'react'
import { Check, Info, Loader2, RefreshCw, Trash2 } from 'lucide-react'
import type { FatSecretFoodRef, MacroCustomFood, MacroEstimateSnapshot, MacroParseSnapshot } from '../../types/domain'
import { describeMacroEstimate, macroItemDisplayEmoji, macroItemDisplayName } from './macroLib'

export type MacroFoodAuditTrail = {
  userInput?: string
  classification?: MacroParseSnapshot
  fatSecretResults?: FatSecretFoodRef[]
  macroEstimate?: MacroEstimateSnapshot
}

export function macroItemAuditTrail(item: {
  userInput?: string
  rawText?: string
  parseSnapshot?: MacroParseSnapshot
  emoji?: string
  name?: string
  amount?: string
  notes?: string
  fatSecretSearch?: string
  fatSecretResults?: FatSecretFoodRef[]
  macroEstimateSnapshot?: MacroEstimateSnapshot
}): MacroFoodAuditTrail {
  const classification =
    item.parseSnapshot ??
    (item.name?.trim()
      ? {
          emoji: item.emoji,
          name: item.name || '',
          amount: item.amount || '',
          notes: item.notes,
          fatSecretSearch: item.fatSecretSearch,
        }
      : undefined)

  return {
    userInput: item.userInput ?? item.rawText,
    classification,
    fatSecretResults: item.fatSecretResults,
    macroEstimate: item.macroEstimateSnapshot,
  }
}

function AuditStepCard({
  label,
  children,
  emptyMessage = 'Not available',
}: {
  label: string
  children?: ReactNode
  emptyMessage?: string
}) {
  return (
    <div className="bg-black/30 rounded-xl border border-white/10 p-3">
      <p className="text-[9px] font-black uppercase tracking-widest text-emerald-400/80 mb-2">{label}</p>
      {children ?? <p className="text-xs text-white/40 italic">{emptyMessage}</p>}
    </div>
  )
}

function ClassificationBody({ snap }: { snap: MacroParseSnapshot }) {
  const rows: { label: string; value: string }[] = [
    { label: 'Emoji', value: snap.emoji || '—' },
    { label: 'Name', value: snap.name || '—' },
    { label: 'Serving', value: snap.amount || '—' },
  ]
  if (snap.notes?.trim()) rows.push({ label: 'Notes', value: snap.notes.trim() })
  if (snap.fatSecretSearch?.trim()) rows.push({ label: 'FatSecret search', value: snap.fatSecretSearch.trim() })

  return (
    <dl className="space-y-1.5">
      {rows.map((row) => (
        <div key={row.label} className="flex gap-2 text-xs">
          <dt className="text-white/40 font-bold uppercase tracking-wide shrink-0 w-[7.5rem]">{row.label}</dt>
          <dd className="text-white/90 font-medium break-words min-w-0">{row.value}</dd>
        </div>
      ))}
    </dl>
  )
}

function FatSecretResultsBody({ foods }: { foods: FatSecretFoodRef[] }) {
  return (
    <ul className="space-y-2 max-h-48 overflow-y-auto pr-1">
      {foods.map((f, i) => (
        <li key={f.foodId || i} className="text-xs border-b border-white/5 pb-2 last:border-0 last:pb-0">
          <p className="font-bold text-white/90">
            {i + 1}. {f.brandName ? `${f.brandName} ` : ''}
            {f.name}
          </p>
          <ul className="mt-1 space-y-0.5 text-white/60">
            {f.servings.map((s) => (
              <li key={s.servingId}>
                {s.description}: {s.calories} cal, {s.protein}g protein
              </li>
            ))}
          </ul>
        </li>
      ))}
    </ul>
  )
}

function MacroEstimateBody({
  snap,
  fatSecretResults,
  customFoods,
}: {
  snap: MacroEstimateSnapshot
  fatSecretResults?: FatSecretFoodRef[]
  customFoods?: MacroCustomFood[]
}) {
  const described = describeMacroEstimate(snap, { fatSecretResults, customFoods })

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <span className="text-[10px] font-black uppercase tracking-widest text-emerald-400/90">{described.method}</span>
        <span className="text-xs font-bold text-white/90">{described.summary}</span>
      </div>
      <dl className="space-y-1.5">
        {described.details.map((row) => (
          <div key={row.label} className="flex gap-2 text-xs">
            <dt className="text-white/40 font-bold uppercase tracking-wide shrink-0 w-[7.5rem]">{row.label}</dt>
            <dd className="text-white/80 font-medium break-words min-w-0">{row.value}</dd>
          </div>
        ))}
      </dl>
    </div>
  )
}

export function MacroFoodAuditPanel({
  audit,
  customFoods,
}: {
  audit: MacroFoodAuditTrail
  customFoods?: MacroCustomFood[]
}) {
  return (
    <div className="px-3 pb-3 pt-1 space-y-2 border-t border-white/10 bg-black/20">
      <AuditStepCard label="User-inputted information">
        {audit.userInput?.trim() ? (
          <p className="text-xs text-white/90 font-medium whitespace-pre-wrap break-words leading-relaxed">
            {audit.userInput.trim()}
          </p>
        ) : undefined}
      </AuditStepCard>
      <AuditStepCard label="Classification">
        {audit.classification ? <ClassificationBody snap={audit.classification} /> : undefined}
      </AuditStepCard>
      <AuditStepCard label="FatSecret results">
        {audit.fatSecretResults?.length ? <FatSecretResultsBody foods={audit.fatSecretResults} /> : undefined}
      </AuditStepCard>
      <AuditStepCard label="Macro estimate">
        {audit.macroEstimate ? (
          <MacroEstimateBody
            snap={audit.macroEstimate}
            fatSecretResults={audit.fatSecretResults}
            customFoods={customFoods}
          />
        ) : undefined}
      </AuditStepCard>
    </div>
  )
}

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
  onLog,
  saveDisabled = false,
  showAudit = false,
  infoExpanded = false,
  onInfoToggle,
  audit,
  auditCustomFoods,
  toolbar = 'day',
}: {
  fieldId: string
  data: MacroFoodEditFields
  onChange: (data: MacroFoodEditFields) => void
  onReset: () => void
  onDelete: () => void
  onSave: () => void
  onLog?: () => void
  saveDisabled?: boolean
  showAudit?: boolean
  infoExpanded?: boolean
  onInfoToggle?: () => void
  audit?: MacroFoodAuditTrail
  auditCustomFoods?: MacroCustomFood[]
  /** `library`: trash + log + save. `library-add`: full-width Save + Save & Log. `day`: re-estimate, trash, info, save. */
  toolbar?: 'day' | 'library' | 'library-add'
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

      {toolbar === 'library-add' ? (
        <div className="flex gap-2 px-4 py-3 bg-white/[0.04]">
          <button
            type="button"
            disabled={saveDisabled}
            onClick={(e) => {
              e.stopPropagation()
              onSave()
            }}
            className="flex-1 py-2.5 rounded-xl text-[10px] font-black uppercase tracking-widest bg-white/10 text-white/80 hover:bg-white/15 disabled:opacity-40 transition-colors"
          >
            Save
          </button>
          <button
            type="button"
            disabled={saveDisabled || !onLog}
            onClick={(e) => {
              e.stopPropagation()
              onLog?.()
            }}
            className="flex-1 py-2.5 rounded-xl text-[10px] font-black uppercase tracking-widest bg-emerald-500 hover:bg-emerald-400 text-white disabled:opacity-40 shadow-lg active:scale-95 transition-all"
          >
            Save & Log
          </button>
        </div>
      ) : (
      <div className="flex justify-between items-center px-4 py-2 bg-white/[0.04]">
        <div className="flex gap-2">
          {toolbar === 'day' && (
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
          )}
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
          {toolbar === 'day' && showAudit && onInfoToggle && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation()
                onInfoToggle()
              }}
              className={`p-2 rounded-lg transition-colors ${
                infoExpanded
                  ? 'text-emerald-300 bg-emerald-400/15 ring-1 ring-emerald-400/40'
                  : 'text-white/50 hover:text-white/80 hover:bg-white/10'
              }`}
              aria-label={infoExpanded ? 'Hide details' : 'Show details'}
              aria-pressed={infoExpanded}
            >
              <Info size={16} strokeWidth={2.5} />
            </button>
          )}
        </div>
        <div className="flex items-center gap-2">
          {toolbar === 'library' && onLog && (
            <button
              type="button"
              disabled={saveDisabled}
              onClick={(e) => {
                e.stopPropagation()
                onLog()
              }}
              className="px-3 py-1.5 text-[10px] font-black uppercase tracking-widest text-emerald-400 hover:bg-emerald-400/10 disabled:opacity-40 rounded-lg transition-colors"
            >
              Log
            </button>
          )}
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
      )}
      {showAudit && infoExpanded && audit && (
        <MacroFoodAuditPanel audit={audit} customFoods={auditCustomFoods} />
      )}
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
  parseSnapshot?: MacroParseSnapshot
}): MacroFoodEditFields {
  return {
    emoji: macroItemDisplayEmoji(item),
    name: macroItemDisplayName(item),
    amount: item.amount,
    calories: item.calories ?? 0,
    protein: item.protein ?? 0,
  }
}

export function libraryFoodToEditFields(food: MacroCustomFood): MacroFoodEditFields {
  return {
    emoji: food.emoji || '🍱',
    name: food.name,
    amount: food.baseAmount || '',
    calories: food.calories,
    protein: food.protein,
  }
}

export { itemToEditFields }
