import { Check, Copy, ListChecks, Trash2, X } from 'lucide-react'
import { useEffect, useRef, useState, type ReactNode } from 'react'

/** Keep native scrolling and ordinary card clicks; consume the click after a hold. */
export function SelectableFoodCard({
  name, selected, selectionMode, editing, onSelect, onStartSelection, children,
}: {
  name: string
  selected: boolean
  selectionMode: boolean
  editing: boolean
  onSelect: () => void
  onStartSelection: () => void
  children: ReactNode
}) {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const origin = useRef<{ x: number; y: number; id: number } | null>(null)
  const suppressClick = useRef(false)
  const contentRef = useRef<HTMLDivElement>(null)

  const cancelHold = () => {
    if (timer.current !== null) clearTimeout(timer.current)
    timer.current = null
    origin.current = null
  }

  useEffect(() => cancelHold, [])
  useEffect(() => {
    contentRef.current?.toggleAttribute('inert', selectionMode)
    cancelHold()
  }, [selectionMode, editing])

  return (
    <div
      data-food-selection-card
      data-selected={selected}
      className={`relative rounded-[var(--radius-card)] ${selected ? 'ring-2 ring-emerald-400 bg-emerald-400/10' : ''} ${editing ? '' : 'select-none touch-pan-y'}`}
      style={editing ? undefined : { WebkitTouchCallout: 'none' }}
      onPointerDownCapture={(e) => {
        suppressClick.current = false
        cancelHold()
        if (editing || selectionMode || !e.isPrimary || e.button !== 0) return
        if ((e.target as HTMLElement).closest('input, textarea, select, a')) return
        origin.current = { x: e.clientX, y: e.clientY, id: e.pointerId }
        timer.current = setTimeout(() => {
          timer.current = null
          suppressClick.current = true
          onStartSelection()
        }, 500)
      }}
      onPointerMoveCapture={(e) => {
        const start = origin.current
        if (start && (start.id !== e.pointerId || Math.hypot(e.clientX - start.x, e.clientY - start.y) > 10)) {
          suppressClick.current = true
          cancelHold()
        }
      }}
      onPointerUpCapture={cancelHold}
      onPointerCancelCapture={cancelHold}
      onPointerLeave={cancelHold}
      onClickCapture={(e) => {
        if (suppressClick.current) {
          e.preventDefault()
          e.stopPropagation()
          suppressClick.current = false
        }
      }}
      onContextMenu={(e) => {
        if (!editing) e.preventDefault()
      }}
      onKeyDownCapture={(e) => {
        if (!editing && (e.key === 'ContextMenu' || (e.shiftKey && e.key === 'F10'))) {
          e.preventDefault()
          if (!selectionMode) onStartSelection()
        }
      }}
    >
      <div ref={contentRef} aria-hidden={selectionMode || undefined}>{children}</div>
      {selectionMode && (
        <button
          type="button"
          aria-label={`${selected ? 'Deselect' : 'Select'} ${name}`}
          aria-pressed={selected}
          onClick={onSelect}
          className="absolute inset-0 rounded-[var(--radius-card)] focus-visible:outline-2 focus-visible:outline-emerald-300"
        >
          <span className={`absolute top-1.5 right-1.5 flex size-5 items-center justify-center rounded-full border shadow ${selected ? 'bg-emerald-400 border-emerald-300 text-black' : 'bg-neutral-900 border-white/40'}`}>
            {selected && <Check size={14} strokeWidth={3} aria-hidden />}
          </span>
        </button>
      )}
    </div>
  )
}

export function FoodSelectionFab({ count, canCopy, onDeselect, onCopy, onDelete }: {
  count: number
  canCopy: boolean
  onDeselect: () => void
  onCopy: () => void
  onDelete: () => void
}) {
  const [expanded, setExpanded] = useState(true)
  const actionClass = 'flex w-full items-center gap-3 rounded-xl px-4 py-3 text-sm font-bold transition-colors hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-emerald-300'
  return (
    <div className="absolute bottom-3 right-3 z-30 flex flex-col items-end gap-2" aria-label="Food selection actions">
      {expanded && (
        <div className="w-52 rounded-2xl border border-white/15 bg-neutral-900 p-1 shadow-2xl">
          <button type="button" onClick={onDeselect} className={actionClass}><X size={18} aria-hidden /> Deselect</button>
          <button type="button" onClick={onCopy} disabled={!canCopy} className={`${actionClass} text-emerald-300 disabled:opacity-40`}>
            <Copy size={18} aria-hidden /> Copy to today
          </button>
          {!canCopy && <p className="px-4 pb-2 text-xs text-white/60">Finish estimating selected foods to copy them.</p>}
          <button type="button" onClick={onDelete} className={`${actionClass} text-red-400`}><Trash2 size={18} aria-hidden /> Delete</button>
        </div>
      )}
      <button
        type="button"
        aria-label={`${count} selected, ${expanded ? 'hide' : 'show'} actions`}
        aria-expanded={expanded}
        onClick={() => setExpanded((value) => !value)}
        className="flex min-h-14 items-center gap-2 rounded-full bg-emerald-400 px-5 font-black text-black shadow-xl hover:bg-emerald-300 focus-visible:outline-2 focus-visible:outline-white"
      >
        <ListChecks size={22} aria-hidden />
        <span aria-live="polite">{count} selected</span>
      </button>
    </div>
  )
}
