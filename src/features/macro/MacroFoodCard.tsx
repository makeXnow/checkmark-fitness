import { useCallback, useEffect, useLayoutEffect, useRef, useState, type RefObject, type ReactNode } from 'react'
import {
  macroDietBandMaxHeight,
  scheduleScrollCenterInMacroDietBand,
} from '../../lib/scrollIntoViewWithin'
import { ChevronUp, Info, Loader2, RefreshCw, Trash2, X } from 'lucide-react'
import type {
  FatSecretFoodRef,
  MacroCustomFood,
  MacroDayItem,
  MacroEstimateSnapshot,
  MacroParseSnapshot,
} from '../../types/domain'
import {
  describeMacroEstimate,
  macroItemDisplayEmoji,
  macroItemDisplayName,
  macroItemServingFields,
  macrosForServingCount,
  normalizeDiaryLabel,
  resolveCanonicalBaseMacros,
} from './macroLib'

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

function fatSecretFoodLabel(f: FatSecretFoodRef): string {
  return f.brandName ? `${f.brandName} ${f.name}`.trim() : f.name
}

const databaseMatchCardSelectedClass =
  'border-emerald-400/50 bg-emerald-400/10 ring-1 ring-emerald-400/30'
const databaseMatchCardIdleClass = 'border-white/10 bg-white/[0.03] hover:bg-white/[0.06] active:bg-white/[0.08]'

function databaseMatchCardClass(selected: boolean, disabled: boolean) {
  return `w-full text-left rounded-2xl border transition-colors p-5 ${
    selected ? databaseMatchCardSelectedClass : databaseMatchCardIdleClass
  } ${disabled ? 'opacity-60 pointer-events-none' : ''}`
}

function primaryServingLine(servings?: FatSecretFoodRef['servings']): string | undefined {
  const s = servings?.[0]
  if (!s) return undefined
  return `${s.description}: ${s.calories} cal, ${s.protein}g protein`
}

function DatabaseMatchOptionContent({
  title,
  subtitle,
  servings,
}: {
  title: string
  subtitle?: string
  servings?: FatSecretFoodRef['servings']
}) {
  return (
    <>
      <span className="block text-sm font-bold text-white/90 leading-snug">{title}</span>
      {subtitle ? <span className="block text-xs text-white/50 mt-1">{subtitle}</span> : null}
      {servings?.length ? (
        <ul className="mt-2.5 space-y-1 text-xs text-white/55">
          {servings.map((s) => (
            <li key={s.servingId}>
              {s.description}: {s.calories} cal, {s.protein}g protein
            </li>
          ))}
        </ul>
      ) : null}
    </>
  )
}

function DatabaseMatchCollapsedCard({
  title,
  detail,
  disabled,
  onOpen,
}: {
  title: string
  detail?: string
  disabled?: boolean
  onOpen: () => void
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onOpen}
      className={databaseMatchCardClass(true, Boolean(disabled))}
    >
      <span className="block text-sm font-bold text-white/90 leading-snug">{title}</span>
      <div className="flex items-center justify-between gap-3 mt-2.5 min-w-0">
        {detail ? (
          <span className="text-xs text-white/55 truncate min-w-0">{detail}</span>
        ) : (
          <span className="text-xs text-white/40 italic">No serving info</span>
        )}
        <span className="text-[10px] font-black uppercase tracking-widest text-emerald-400/90 shrink-0">
          Change
        </span>
      </div>
    </button>
  )
}

function MacroDatabaseMatchPicker({
  foods,
  selectedIndex,
  disabled = false,
  onSelect,
  onExpandedChange,
}: {
  foods: FatSecretFoodRef[]
  /** 1-based food index, or null for None. */
  selectedIndex: number | null
  disabled?: boolean
  onSelect: (foodIndex: number | null) => void
  onExpandedChange?: (expanded: boolean) => void
}) {
  const [expanded, setExpanded] = useState(false)
  const selectedFood = selectedIndex != null ? foods[selectedIndex - 1] : undefined

  const setExpandedState = (next: boolean) => {
    setExpanded(next)
    onExpandedChange?.(next)
  }

  const pick = (index: number | null) => {
    if (index === selectedIndex) {
      setExpandedState(false)
      return
    }
    onSelect(index)
    setExpandedState(false)
  }

  const renderOption = (index: number | null, key: string) => {
    const selected = selectedIndex === index
    const className = databaseMatchCardClass(selected, disabled)
    const body =
      index === null ? (
        <DatabaseMatchOptionContent title="None" subtitle="Estimate without a database match" />
      ) : (
        (() => {
          const food = foods[index - 1]
          if (!food) return null
          return <DatabaseMatchOptionContent title={fatSecretFoodLabel(food)} servings={food.servings} />
        })()
      )
    if (!body) return null

    return (
      <button key={key} type="button" disabled={disabled} onClick={() => pick(index)} className={className}>
        {body}
      </button>
    )
  }

  const collapsedTitle =
    selectedIndex === null
      ? 'None'
      : selectedFood
        ? fatSecretFoodLabel(selectedFood)
        : 'None'
  const collapsedDetail =
    selectedIndex === null
      ? 'Estimate without a database match'
      : selectedFood
        ? primaryServingLine(selectedFood.servings)
        : undefined

  return (
    <div className="px-4 py-4 border-t border-white/10 bg-black/15">
      {disabled ? (
        <div className="flex items-center justify-center gap-2 py-3 text-[11px] font-bold uppercase tracking-widest text-emerald-400 opacity-70">
          <Loader2 size={14} className="animate-spin" aria-hidden />
          Updating macros…
        </div>
      ) : null}

      {expanded ? (
        <div className="space-y-3">
          {renderOption(null, 'none')}
          {foods.map((f, i) => renderOption(i + 1, f.foodId || String(i)))}
          <button
            type="button"
            disabled={disabled}
            onClick={() => setExpandedState(false)}
            className="w-full flex items-center justify-center gap-1.5 py-2.5 rounded-xl text-[11px] font-black uppercase tracking-widest text-white opacity-45 hover:opacity-70 hover:bg-white/[0.04] transition-opacity shrink-0"
          >
            <ChevronUp size={14} strokeWidth={2.5} />
            Show less
          </button>
        </div>
      ) : (
        <DatabaseMatchCollapsedCard
          title={collapsedTitle}
          detail={collapsedDetail}
          disabled={disabled}
          onOpen={() => setExpandedState(true)}
        />
      )}
    </div>
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
        {audit.fatSecretResults?.length ? (
          <FatSecretResultsBody foods={audit.fatSecretResults} />
        ) : undefined}
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
  /** Library base serving label (e.g. "1 cup"). */
  amount: string
  /** Human-readable base serving label for day-log items (e.g. "1/2 cup prepared"). */
  servingType?: string
  servingSize?: number
  servingUnit?: string
  /** Count of base portions consumed (editable in day log). */
  servingMultiplier?: number
  calories: number
  protein: number
}

export const MACRO_FIELD_AUTOSAVE_MS = 400

export function shouldAutosaveMacroFields(
  prev: MacroFoodEditFields,
  next: MacroFoodEditFields,
  mode: 'day' | 'library',
): boolean {
  if (mode === 'library') {
    return prev.amount !== next.amount || prev.calories !== next.calories || prev.protein !== next.protein
  }
  return (
    (prev.servingMultiplier ?? 1) !== (next.servingMultiplier ?? 1) ||
    prev.calories !== next.calories ||
    prev.protein !== next.protein
  )
}

export function applyDayMacroEditChange(
  item: MacroDayItem,
  prev: MacroFoodEditFields,
  fields: MacroFoodEditFields,
  customFoods: MacroCustomFood[] = [],
): MacroFoodEditFields {
  if (fields.servingMultiplier != null && fields.servingMultiplier !== prev.servingMultiplier) {
    const base = resolveCanonicalBaseMacros(item, customFoods)
    const baseCalories = base?.baseCalories ?? item.baseCalories
    const baseProtein = base?.baseProtein ?? item.baseProtein
    if (baseCalories != null && baseProtein != null) {
      const mult = fields.servingMultiplier > 0 ? fields.servingMultiplier : 1
      const scaled = macrosForServingCount(baseCalories, baseProtein, mult)
      return { ...fields, calories: scaled.calories, protein: scaled.protein }
    }
  }
  return fields
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

const macroEditBoxShellClass =
  'flex items-center bg-white/5 rounded-xl overflow-hidden focus-within:bg-white/10 transition-colors'

const macroEditInputClass =
  'w-full bg-transparent font-bold text-xs py-2.5 outline-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none'

const fieldLabelClass = 'text-[9px] font-black opacity-40 text-center truncate px-0.5'

function MacroEditTextBox({
  value,
  onChange,
  placeholder,
  type = 'text',
  colorClass = 'text-white',
  shellClassName = '',
  inputClassName = '',
  align = 'center',
  inputId,
  ariaLabel,
  step,
  min,
  onFocus,
  onBlur,
}: {
  value: string | number
  onChange: (v: string) => void
  placeholder?: string
  type?: 'text' | 'number'
  colorClass?: string
  shellClassName?: string
  inputClassName?: string
  align?: 'center' | 'left'
  inputId?: string
  ariaLabel?: string
  step?: string | number
  min?: string | number
  onFocus?: () => void
  onBlur?: () => void
}) {
  const display = value === 0 && type === 'number' ? '' : String(value)
  const alignClass = align === 'left' ? 'text-left px-3' : 'text-center'

  return (
    <div className={`${macroEditBoxShellClass} ${shellClassName}`.trim()}>
      <input
        id={inputId}
        value={display}
        onChange={(e) => onChange(e.target.value)}
        onFocus={onFocus}
        onBlur={onBlur}
        className={`${macroEditInputClass} ${alignClass} ${colorClass} ${inputClassName}`.trim()}
        placeholder={placeholder}
        type={type}
        step={step}
        min={min}
        aria-label={ariaLabel}
      />
    </div>
  )
}

function MacroEditFieldColumn({ label, children }: { label: ReactNode; children: ReactNode }) {
  return (
    <div className="flex-1 flex flex-col gap-1 min-w-0">
      {children}
      {typeof label === 'string' ? <span className={fieldLabelClass}>{label}</span> : label}
    </div>
  )
}

function servingUnitLabel(data: MacroFoodEditFields): string {
  if (data.servingType?.trim()) return data.servingType.trim()
  const unit = data.servingUnit?.trim() || 'serving'
  return /^\d/.test(unit) ? unit : `1 ${unit}`
}

function MacroFieldInput({
  value,
  onChange,
  placeholder,
  colorClass = 'text-white',
  type = 'text',
  proteinSplit = false,
  inputId,
  clearOnFocus = true,
}: {
  value: string | number
  onChange: (v: string) => void
  placeholder: string
  colorClass?: string
  type?: 'text' | 'number'
  proteinSplit?: boolean
  inputId?: string
  clearOnFocus?: boolean
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [isEditing, setIsEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const snapshotRef = useRef('')

  const formatDisplay = (v: string | number) => (v === 0 && type === 'number' ? '' : String(v))
  const display = clearOnFocus && isEditing ? draft : formatDisplay(value)

  const handleFocus = () => {
    if (!clearOnFocus) return
    snapshotRef.current = formatDisplay(value)
    setDraft('')
    setIsEditing(true)
  }

  const handleChange = (v: string) => {
    if (clearOnFocus && isEditing) setDraft(v)
    if (!clearOnFocus || isEditing) onChange(v)
  }

  const handleBlur = () => {
    if (!clearOnFocus || !isEditing) return
    setIsEditing(false)
    if (draft.trim() === '') onChange(snapshotRef.current)
    setDraft('')
  }

  if (proteinSplit) {
    return (
      <div
        className={`${macroEditBoxShellClass} cursor-text`}
        onClick={() => inputRef.current?.focus()}
      >
        <div className="flex-1 flex items-center justify-center min-w-0">
          <input
            ref={inputRef}
            id={inputId}
            value={display}
            onChange={(e) => handleChange(e.target.value)}
            onFocus={handleFocus}
            onBlur={handleBlur}
            className={`w-1/2 bg-transparent ${colorClass} font-bold text-xs py-2.5 text-right outline-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none pr-0.5`}
            type="number"
            placeholder="0"
          />
          <span className={`w-1/2 ${colorClass} font-bold text-xs py-2.5 text-left pointer-events-none`}>g</span>
        </div>
      </div>
    )
  }

  return (
    <MacroEditTextBox
      value={display}
      onChange={handleChange}
      onFocus={handleFocus}
      onBlur={handleBlur}
      placeholder={placeholder}
      type={type}
      colorClass={colorClass}
      inputId={inputId}
    />
  )
}

const macroEditToolbarIconClass = 'p-2 rounded-lg transition-colors'

function MacroEditCloseButton({ disabled, onClick }: { disabled?: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={(e) => {
        e.stopPropagation()
        onClick()
      }}
      className="self-center p-1.5 text-white opacity-50 hover:opacity-90 disabled:opacity-40 rounded-lg transition-opacity shrink-0"
      aria-label="Close"
    >
      <X size={18} strokeWidth={2.5} />
    </button>
  )
}

function MacroEditActionsToolbar({
  toolbar,
  saveDisabled,
  onDelete,
  onReset,
  onLog,
  showAudit,
  infoExpanded,
  onInfoToggle,
}: {
  toolbar: 'day' | 'library'
  saveDisabled?: boolean
  onDelete: () => void
  onReset: () => void
  onLog?: () => void
  showAudit?: boolean
  infoExpanded?: boolean
  onInfoToggle?: () => void
}) {
  return (
    <div
      data-macro-edit-toolbar
      className="flex shrink-0 justify-between items-center px-4 py-2 bg-white/[0.04] border-t border-white/10"
    >
      <div className="flex gap-2">
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation()
            onDelete()
          }}
          className={`${macroEditToolbarIconClass} text-red-400 hover:bg-red-400/10`}
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
            className={`${macroEditToolbarIconClass} ${
              infoExpanded
                ? 'text-emerald-300 bg-emerald-400/15 ring-1 ring-emerald-400/40'
                : 'text-white opacity-50 hover:opacity-80 hover:bg-white/10'
            }`}
            aria-label={infoExpanded ? 'Hide details' : 'Show details'}
            aria-pressed={infoExpanded}
          >
            <Info size={16} strokeWidth={2.5} />
          </button>
        )}
      </div>
      <div className="flex items-center gap-2">
        {toolbar === 'library' && onLog ? (
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
        ) : null}
        {toolbar === 'day' ? (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation()
              onReset()
            }}
            className={`${macroEditToolbarIconClass} text-emerald-400 hover:bg-emerald-400/10`}
            title="Re-estimate macros"
            aria-label="Re-estimate macros"
          >
            <RefreshCw size={16} strokeWidth={2.5} />
          </button>
        ) : null}
      </div>
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
  fatSecretResults,
  selectedFatSecretIndex = null,
  fatSecretSelecting = false,
  onSelectFatSecret,
  scrollContainerRef,
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
  fatSecretResults?: FatSecretFoodRef[]
  selectedFatSecretIndex?: number | null
  fatSecretSelecting?: boolean
  onSelectFatSecret?: (foodIndex: number | null) => void
  scrollContainerRef?: RefObject<HTMLElement | null>
  /** `library`: trash + log. `library-add`: full-width Save + Save & Log. `day`: trash + info + refresh. */
  toolbar?: 'day' | 'library' | 'library-add'
}) {
  const proteinInputId = `macro-protein-${fieldId}`
  const servingLabelEditable = toolbar === 'library' || toolbar === 'library-add'
  const showCloseButton = toolbar === 'library' || toolbar === 'day'
  const showDatabaseMatch = toolbar === 'day' && Boolean(fatSecretResults?.length && onSelectFatSecret)
  const constrainToViewportBand = Boolean(scrollContainerRef)
  const cardRef = useRef<HTMLDivElement>(null)
  const [cardMaxHeight, setCardMaxHeight] = useState<number | undefined>()
  const [databasePickerExpanded, setDatabasePickerExpanded] = useState(false)

  const remeasureCardMaxHeight = useCallback(() => {
    if (!constrainToViewportBand) return
    setCardMaxHeight(macroDietBandMaxHeight())
  }, [constrainToViewportBand])

  useLayoutEffect(() => {
    if (!constrainToViewportBand) {
      setCardMaxHeight(undefined)
      return
    }
    remeasureCardMaxHeight()
    window.addEventListener('resize', remeasureCardMaxHeight)
    return () => window.removeEventListener('resize', remeasureCardMaxHeight)
  }, [constrainToViewportBand, remeasureCardMaxHeight])

  useEffect(() => {
    if (!constrainToViewportBand) return
    const target = cardRef.current
    const container = scrollContainerRef?.current
    if (!target || !container) return
    return scheduleScrollCenterInMacroDietBand(target, container)
  }, [constrainToViewportBand, scrollContainerRef, databasePickerExpanded, infoExpanded, cardMaxHeight])

  const bottomBar =
    toolbar === 'library-add' ? (
      <div
        data-macro-edit-toolbar
        className="flex shrink-0 gap-2 px-4 py-3 bg-white/[0.04] border-t border-white/10"
      >
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
      <MacroEditActionsToolbar
        toolbar={toolbar === 'library' ? 'library' : 'day'}
        saveDisabled={saveDisabled}
        onDelete={onDelete}
        onReset={onReset}
        onLog={onLog}
        showAudit={showAudit}
        infoExpanded={infoExpanded}
        onInfoToggle={onInfoToggle}
      />
    )

  return (
    <div
      ref={cardRef}
      className="bg-[var(--color-surface)] rounded-[var(--radius-card)] border border-white/10 shadow-2xl flex flex-col overflow-hidden"
      style={cardMaxHeight != null ? { maxHeight: cardMaxHeight } : undefined}
    >
      <div
        data-macro-edit-scroll
        className={
          constrainToViewportBand
            ? 'flex-1 min-h-0 overflow-y-auto overscroll-y-contain flex flex-col gap-px'
            : 'flex flex-col gap-px overflow-hidden'
        }
      >
        <div className="p-3 bg-white/[0.02] flex flex-col gap-3 shrink-0">
          <div className="flex gap-2 items-center">
            <MacroEditTextBox
              value={data.emoji}
              onChange={(v) => onChange({ ...data, emoji: v })}
              placeholder="🍱"
              shellClassName="w-12 shrink-0"
              inputClassName="text-xl"
              ariaLabel="Emoji"
            />
            <MacroEditTextBox
              value={data.name}
              onChange={(v) => onChange({ ...data, name: v })}
              placeholder="Food name"
              shellClassName="flex-1 min-w-0"
              align="left"
              ariaLabel="Food name"
            />
            {showCloseButton ? <MacroEditCloseButton disabled={saveDisabled} onClick={onSave} /> : null}
          </div>

          <div className="flex gap-2 w-full">
            <MacroEditFieldColumn
              label={
                servingLabelEditable ? (
                  <input
                    value={data.amount}
                    onChange={(e) => onChange({ ...data, amount: e.target.value })}
                    className={`${fieldLabelClass} bg-transparent outline-none focus:opacity-70 w-full`}
                    placeholder="1 serving"
                    aria-label="Serving size"
                  />
                ) : (
                  servingUnitLabel(data)
                )
              }
            >
              <MacroFieldInput
                value={data.servingMultiplier ?? 1}
                onChange={(v) => {
                  const n = v === '' ? 0 : parseFloat(v)
                  onChange({ ...data, servingMultiplier: Number.isFinite(n) ? n : 0 })
                }}
                placeholder="1"
                type="number"
              />
            </MacroEditFieldColumn>
            <MacroEditFieldColumn label="Calories">
              <MacroFieldInput
                value={data.calories}
                onChange={(v) => onChange({ ...data, calories: parseFloat(v) || 0 })}
                placeholder="0"
                colorClass="text-emerald-400"
                type="number"
              />
            </MacroEditFieldColumn>
            <MacroEditFieldColumn label="Protein">
              <MacroFieldInput
                value={data.protein}
                onChange={(v) => onChange({ ...data, protein: parseFloat(v) || 0 })}
                placeholder="0"
                colorClass="text-blue-400"
                type="number"
                proteinSplit
                inputId={proteinInputId}
              />
            </MacroEditFieldColumn>
          </div>
        </div>

        {showDatabaseMatch ? (
          <MacroDatabaseMatchPicker
            foods={fatSecretResults!}
            selectedIndex={selectedFatSecretIndex}
            disabled={fatSecretSelecting}
            onSelect={onSelectFatSecret!}
            onExpandedChange={setDatabasePickerExpanded}
          />
        ) : null}
        {showAudit && infoExpanded && audit ? (
          <MacroFoodAuditPanel audit={audit} customFoods={auditCustomFoods} />
        ) : null}
      </div>
      {bottomBar}
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
      className={`relative bg-white/5 hover:bg-white/10 p-4 rounded-[var(--radius-card)] border border-white/5 transition-all cursor-pointer group ${pending ? 'opacity-80' : ''}`}
    >
      {pending && (
        <div className="absolute inset-0 bg-black/20 flex items-center justify-center rounded-[var(--radius-card)] z-10 opacity-60">
          <Loader2 className="animate-spin text-emerald-500" size={20} aria-hidden />
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

function itemToEditFields(
  item: {
    emoji?: string
    name: string
    amount: string
    servingType?: string
    servingSize?: number
    servingUnit?: string
    servingMultiplier?: number
    calories?: number
    protein?: number
    parseSnapshot?: MacroParseSnapshot
    libraryFoodId?: string
  },
  customFoods: MacroCustomFood[] = [],
): MacroFoodEditFields {
  const serving = macroItemServingFields(item)
  return {
    emoji: macroItemDisplayEmoji(item, customFoods),
    name: macroItemDisplayName(item, customFoods),
    amount: serving.amount,
    servingType: serving.servingType,
    servingSize: serving.servingSize,
    servingUnit: serving.servingUnit,
    servingMultiplier: serving.servingMultiplier,
    calories: item.calories ?? 0,
    protein: item.protein ?? 0,
  }
}

export function libraryFoodToEditFields(food: MacroCustomFood): MacroFoodEditFields {
  const label = normalizeDiaryLabel({
    name: food.name,
    emoji: food.emoji,
    fallbackName: food.name,
    fallbackEmoji: food.emoji,
  })
  return {
    emoji: label.emoji,
    name: label.name,
    amount: food.baseAmount || '',
    servingMultiplier: 1,
    calories: food.calories,
    protein: food.protein,
  }
}

export { itemToEditFields }
