import { Navigate, useParams } from 'react-router-dom'
import App from './App'
import { bindApiProfile } from './core/apiProfile'
import { ProfileManifest } from './core/ProfileManifest'
import { useMxnAuth } from './lib/MxnAuthGate'
import { isValidUsername, normalizeUsername } from './lib/username'

export function ProfileRoute() {
  const { username: raw } = useParams<{ username: string }>()
  const { enabled, profile: authProfile } = useMxnAuth()
  const normalized = raw ? normalizeUsername(raw) : ''

  if (!raw || !normalized || !isValidUsername(normalized)) {
    return <Navigate to="/" replace />
  }

  if (raw !== normalized) {
    return <Navigate to={`/u/${normalized}`} replace />
  }

  // Signed-in users stay on the profile tied to their Google email.
  if (enabled && authProfile && normalized !== authProfile) {
    return <Navigate to={`/u/${authProfile}`} replace />
  }

  bindApiProfile(normalized)

  return (
    <>
      <ProfileManifest username={normalized} />
      <App />
    </>
  )
}
