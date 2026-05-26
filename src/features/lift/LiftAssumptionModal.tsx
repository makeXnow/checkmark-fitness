import { createPortal } from 'react-dom'
import { assumptionPromptMessage } from './liftAssumptionPrompt'

export function LiftAssumptionModal({
  dayName,
  localDate,
  busy,
  onNo,
  onSubmit,
}: {
  dayName: string
  localDate: string
  busy?: boolean
  onNo: () => void
  onSubmit: () => void
}) {
  return createPortal(
    <div className="fixed inset-0 z-[70] flex items-end justify-center bg-black/80 p-4 backdrop-blur-sm sm:items-center">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="lift-assumption-title"
        className="w-full max-w-sm rounded-2xl border border-neutral-800 bg-neutral-900 p-5 shadow-2xl"
      >
        <h2 id="lift-assumption-title" className="mb-6 text-lg font-black leading-snug text-white">
          {assumptionPromptMessage(dayName, localDate)}
        </h2>
        <div className="flex gap-3">
          <button
            type="button"
            disabled={busy}
            onClick={onNo}
            className="flex-1 rounded-xl border border-neutral-700 px-4 py-3 text-sm font-bold text-neutral-300 transition-colors hover:bg-neutral-800 disabled:opacity-40"
          >
            No
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={onSubmit}
            className="flex-1 rounded-xl bg-emerald-400 px-4 py-3 text-sm font-black uppercase tracking-wider text-black transition-colors hover:bg-emerald-300 disabled:opacity-40"
          >
            Submit
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
