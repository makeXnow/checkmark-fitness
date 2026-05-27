import { useLayoutEffect } from 'react'
import { Navigate, useParams } from 'react-router-dom'
import App from './App'
import { setApiProfile } from './core/apiProfile'
import { ProfileManifest } from './core/ProfileManifest'
import { isValidUsername, normalizeUsername } from './lib/username'

export function ProfileRoute() {
  const { username: raw } = useParams<{ username: string }>()
  const normalized = raw ? normalizeUsername(raw) : ''

  useLayoutEffect(() => {
    if (isValidUsername(normalized)) setApiProfile(normalized)
    return () => setApiProfile(null)
  }, [normalized])

  if (!raw || !normalized || !isValidUsername(normalized)) {
    return <Navigate to="/" replace />
  }

  if (raw !== normalized) {
    return <Navigate to={`/u/${normalized}`} replace />
  }

  return (
    <>
      <ProfileManifest username={normalized} />
      <App />
    </>
  )
}
