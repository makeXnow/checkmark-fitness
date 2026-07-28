import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import { AppLoadingAnimation } from '../core/AppLoadingAnimation'
import { profileForEmail } from './accountProfiles'
import {
  bootstrapMxnSession,
  clearStoredSession,
  fetchMxnMe,
  getStoredSession,
  isMxnAuthEnabled,
  type MxnSession,
} from './mxn-auth'
import { MxnGoogleSignInButton } from './MxnGoogleSignInButton'

const APP_ID = import.meta.env.VITE_MXN_APP_ID || 'checkmark-fitness'

type MxnAuthValue = {
  enabled: boolean
  session: MxnSession | null
  profile: string | null
  signOut: () => void
}

const MxnAuthContext = createContext<MxnAuthValue>({
  enabled: false,
  session: null,
  profile: null,
  signOut: () => {},
})

export function useMxnAuth(): MxnAuthValue {
  return useContext(MxnAuthContext)
}

export function MxnAuthGate({ children }: { children: ReactNode }) {
  const enabled = isMxnAuthEnabled()
  const [ready, setReady] = useState(!enabled)
  const [session, setSession] = useState<MxnSession | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!enabled) return
    let cancelled = false
    ;(async () => {
      try {
        // Shared across Strict Mode remounts so the one-time OAuth code is only exchanged once.
        const current = await bootstrapMxnSession(APP_ID)
        if (!current) {
          if (!cancelled) {
            setSession(null)
            setReady(true)
          }
          return
        }
        const me = await fetchMxnMe(current.token)
        if (!cancelled) {
          setSession({ token: current.token, user: me.user, app: me.app || APP_ID })
          setReady(true)
        }
      } catch (err) {
        const existing = getStoredSession()
        if (existing) {
          try {
            const me = await fetchMxnMe(existing.token)
            if (!cancelled) {
              setSession({ token: existing.token, user: me.user, app: me.app || APP_ID })
              setReady(true)
              return
            }
          } catch {
            clearStoredSession()
          }
        }
        if (!cancelled) {
          setSession(null)
          setError(err instanceof Error ? err.message : 'Sign-in failed')
          setReady(true)
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [enabled])

  const value = useMemo<MxnAuthValue>(() => {
    const profile = session ? profileForEmail(session.user.email) : null
    return {
      enabled,
      session,
      profile,
      signOut: () => {
        clearStoredSession()
        setSession(null)
        setError('')
      },
    }
  }, [enabled, session])

  if (!enabled) {
    return <MxnAuthContext.Provider value={value}>{children}</MxnAuthContext.Provider>
  }

  if (!ready) {
    return (
      <div className="flex min-h-dvh flex-col items-center justify-center bg-black px-[var(--app-pad-x)] text-white">
        <div className="flex flex-col items-center text-center">
          <div
            className="mb-6 flex h-24 w-full items-center justify-center overflow-hidden"
            aria-hidden
          >
            <AppLoadingAnimation className="scale-[0.72]" />
          </div>
          <h1 className="text-lg font-black uppercase tracking-widest text-white">Checkmark Fitness</h1>
          <p className="mt-3 text-sm text-neutral-500">Checking sign-in…</p>
        </div>
      </div>
    )
  }

  if (!session) {
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

          <div className="space-y-3">
            <MxnGoogleSignInButton
              appId={APP_ID}
              className="inline-flex h-14 w-full items-center justify-center gap-3 rounded-2xl border border-neutral-700 bg-white px-4 text-base font-bold text-black transition active:scale-[0.99]"
            />
            {error ? <p className="text-center text-sm text-red-400">{error}</p> : null}
          </div>
        </div>
      </div>
    )
  }

  return <MxnAuthContext.Provider value={value}>{children}</MxnAuthContext.Provider>
}
