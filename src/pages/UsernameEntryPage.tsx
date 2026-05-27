import { useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { AppLoadingAnimation } from '../core/AppLoadingAnimation'
import { normalizeUsername } from '../lib/username'

/** Username → profile URL. Not auth — same as navigating to a bookmarked path. */
export function UsernameEntryPage() {
  const navigate = useNavigate()
  const [raw, setRaw] = useState('')
  const [error, setError] = useState<string | null>(null)

  function handleSubmit(e: FormEvent) {
    e.preventDefault()
    const slug = normalizeUsername(raw)
    if (!slug) {
      setError('Enter a username.')
      return
    }
    setError(null)
    navigate(`/u/${slug}`)
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
          <div className="space-y-2">
            <h1 className="text-lg font-black uppercase tracking-widest text-white">Checkmark Fitness</h1>
            <p className="text-sm text-neutral-400">Enter a username to open that tracker.</p>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <label className="block space-y-2">
            <span className="text-xs font-bold uppercase tracking-widest text-neutral-500">Username</span>
            <input
              type="text"
              value={raw}
              onChange={(e) => {
                setRaw(e.target.value)
                if (error) setError(null)
              }}
              autoComplete="off"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              placeholder="username"
              className="w-full rounded-2xl border border-neutral-700 bg-neutral-900 px-4 py-3.5 text-base text-white outline-none ring-emerald-400/0 transition focus:border-emerald-500/60 focus:ring-2 focus:ring-emerald-400/30"
            />
          </label>
          {error ? <p className="text-center text-sm text-red-400">{error}</p> : null}
          <button
            type="submit"
            className="w-full rounded-2xl bg-emerald-400 py-3.5 text-base font-black text-black transition active:scale-[0.98]"
          >
            Open
          </button>
        </form>
      </div>
    </div>
  )
}
