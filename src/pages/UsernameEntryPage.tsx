import { Check } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate } from 'react-router-dom'
import { checkProfileExists } from '../core/api'
import { AppLoadingAnimation } from '../core/AppLoadingAnimation'
import { normalizeUsername } from '../lib/username'

function CreateProfileDialog({
  username,
  busy,
  onNo,
  onYes,
}: {
  username: string
  busy?: boolean
  onNo: () => void
  onYes: () => void
}) {
  return createPortal(
    <div className="fixed inset-0 z-[70] flex items-end justify-center bg-black/80 p-4 backdrop-blur-sm sm:items-center">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="create-profile-title"
        className="w-full max-w-sm rounded-2xl border border-neutral-800 bg-neutral-900 p-5 shadow-2xl"
      >
        <h2 id="create-profile-title" className="mb-6 text-lg font-black leading-snug text-white">
          No account for {username}. Would you like to create one?
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

/** Username → profile URL. Not auth — same as navigating to a bookmarked path. */
export function UsernameEntryPage() {
  const navigate = useNavigate()
  const [raw, setRaw] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [pendingSlug, setPendingSlug] = useState<string | null>(null)

  async function goToProfile(slug: string) {
    setBusy(true)
    setError(null)
    try {
      const exists = await checkProfileExists(slug)
      if (exists) {
        navigate(`/u/${slug}`)
        return
      }
      setPendingSlug(slug)
    } catch {
      setError('Could not check username. Try again.')
    } finally {
      setBusy(false)
    }
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault()
    const slug = normalizeUsername(raw)
    if (!slug) {
      setError('Enter a username.')
      return
    }
    void goToProfile(slug)
  }

  function confirmCreate() {
    if (!pendingSlug) return
    navigate(`/u/${pendingSlug}`)
    setPendingSlug(null)
  }

  return (
    <div className="flex min-h-dvh flex-col items-center justify-center bg-black px-[var(--app-pad-x)] text-white">
      <div className="w-full max-w-sm space-y-8">
        <div className="flex flex-col items-center text-center">
          <div
            className="mb-6 flex h-24 w-full items-center justify-center overflow-hidden"
            aria-hidden
          >
            <AppLoadingAnimation className="scale-[0.72]" />
          </div>
          <h1 className="text-lg font-black uppercase tracking-widest text-white">Checkmark Fitness</h1>
        </div>

        <form onSubmit={handleSubmit} className="space-y-3">
          <div className="flex h-14 gap-2">
            <input
              type="text"
              value={raw}
              onChange={(e) => {
                setRaw(e.target.value)
                if (error) setError(null)
              }}
              disabled={busy}
              aria-label="Username"
              autoComplete="off"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              placeholder="username"
              className="h-full min-w-0 flex-1 rounded-2xl border border-neutral-700 bg-neutral-900 px-4 text-base text-white outline-none ring-emerald-400/0 transition focus:border-emerald-500/60 focus:ring-2 focus:ring-emerald-400/30 disabled:opacity-50"
            />
            <button
              type="submit"
              disabled={busy}
              aria-label="Open tracker"
              className="flex h-full w-14 shrink-0 items-center justify-center rounded-2xl bg-emerald-400 text-black transition active:scale-95 disabled:opacity-50"
            >
              <Check className="h-6 w-6" strokeWidth={3} />
            </button>
          </div>
          {error ? <p className="text-center text-sm text-red-400">{error}</p> : null}
        </form>
      </div>

      {pendingSlug ? (
        <CreateProfileDialog
          username={pendingSlug}
          busy={busy}
          onNo={() => setPendingSlug(null)}
          onYes={confirmCreate}
        />
      ) : null}
    </div>
  )
}
