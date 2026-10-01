import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { Check, Copy, X } from 'lucide-react'
import { fetchHabitShortcutLinks, type HabitShortcutLinks } from '../../core/api'
import type { HabitsGoals } from '../../types/domain'

export function SiriShortcutsModal({ goals, onClose }: { goals: HabitsGoals; onClose: () => void }) {
  const [data, setData] = useState<HabitShortcutLinks | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [copied, setCopied] = useState<string | null>(null)

  const load = (regenerate: boolean) => {
    setBusy(true)
    setError(null)
    fetchHabitShortcutLinks(regenerate)
      .then(setData)
      .catch((e: unknown) => setError(e instanceof Error ? e.message : 'Failed to load links'))
      .finally(() => setBusy(false))
  }

  useEffect(() => {
    load(false)
  }, [])

  const copy = async (url: string) => {
    try {
      await navigator.clipboard.writeText(url)
      setCopied(url)
      setTimeout(() => setCopied((c) => (c === url ? null : c)), 1500)
    } catch {
      setError('Could not copy — press and hold the link to copy it instead.')
    }
  }

  const resetCode = () => {
    if (!window.confirm('Make a new code? Your existing Siri shortcuts will stop working until you paste the new links.')) return
    load(true)
  }

  return createPortal(
    <div className="fixed inset-0 z-[70] flex items-end justify-center bg-black/80 p-4 backdrop-blur-sm sm:items-center">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="siri-shortcuts-title"
        className="w-full max-w-sm rounded-2xl border border-neutral-800 bg-neutral-900 p-5 shadow-2xl"
      >
        <div className="mb-3 flex items-start justify-between gap-3">
          <h2 id="siri-shortcuts-title" className="text-lg font-black leading-snug text-white">
            Control checkboxes with Siri
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded-lg p-1 text-neutral-400 transition-colors hover:bg-neutral-800 hover:text-white"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
        <p className="mb-4 text-sm leading-relaxed text-neutral-400">
          Copy a link below, then in the Shortcuts app create a shortcut with a single "Get Contents of URL" action and
          paste the link into it. Name the shortcut what you'll say to Siri (like "Log cardio") and running it checks
          that box for today.
        </p>

        {error && <p className="mb-3 text-sm text-rose-400">{error}</p>}

        <div className="space-y-2">
          {data
            ? data.links.map(({ habit, url }) => (
                <div key={habit} className="rounded-xl border border-neutral-800 bg-black p-3">
                  <div className="mb-1 flex items-center justify-between gap-2">
                    <span className="text-xs font-bold uppercase tracking-widest text-white">
                      {goals[habit]?.label ?? habit}
                    </span>
                    <button
                      type="button"
                      onClick={() => void copy(url)}
                      className="flex items-center gap-1 rounded-md bg-neutral-800 px-2 py-1 text-[10px] font-black uppercase tracking-wider text-neutral-200 transition-colors hover:bg-neutral-700"
                    >
                      {copied === url ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
                      {copied === url ? 'Copied' : 'Copy'}
                    </button>
                  </div>
                  <p className="break-all font-mono text-[11px] text-neutral-500 select-all">{url}</p>
                </div>
              ))
            : !error && <p className="text-sm text-neutral-500">Loading…</p>}
        </div>

        {data && (
          <button
            type="button"
            disabled={busy}
            onClick={resetCode}
            className="mt-4 w-full rounded-xl border border-neutral-700 px-4 py-2.5 text-xs font-bold text-neutral-400 transition-colors hover:bg-neutral-800 disabled:opacity-40"
          >
            Reset code
          </button>
        )}
      </div>
    </div>,
    document.body,
  )
}
