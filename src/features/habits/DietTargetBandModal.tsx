import { createPortal } from 'react-dom'
import { formatAssumptionWhenLabel } from '../lift/liftAssumptionPrompt'
import type { DietTargetBandPrompt } from './dietTargetBands'

export function dietTargetBandPromptMessage(prompt: DietTargetBandPrompt, today = new Date()): string {
  const when = formatAssumptionWhenLabel(prompt.localDate, today)
  const cal = prompt.calories.toLocaleString('en-US')
  return `You achieved ${cal} calories and ${prompt.proteinPctOfGoal}% protein ${when}. Would you like to count that as a diet day?`
}

export function DietTargetBandModal({
  prompt,
  busy,
  onNo,
  onYes,
}: {
  prompt: DietTargetBandPrompt
  busy?: boolean
  onNo: () => void
  onYes: () => void
}) {
  return createPortal(
    <div className="fixed inset-0 z-[70] flex items-end justify-center bg-black/80 p-4 backdrop-blur-sm sm:items-center">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="diet-target-band-title"
        className="w-full max-w-sm rounded-2xl border border-neutral-800 bg-neutral-900 p-5 shadow-2xl"
      >
        <h2 id="diet-target-band-title" className="mb-6 text-lg font-black leading-snug text-white">
          {dietTargetBandPromptMessage(prompt)}
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
            onClick={onYes}
            className="flex-1 rounded-xl bg-emerald-400 px-4 py-3 text-sm font-black uppercase tracking-wider text-black transition-colors hover:bg-emerald-300 disabled:opacity-40"
          >
            Yes
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
