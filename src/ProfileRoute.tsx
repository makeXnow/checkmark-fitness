import { Navigate, useParams } from 'react-router-dom'
import App from './App'
import { bindApiProfile } from './core/apiProfile'
import { ProfileManifest } from './core/ProfileManifest'
import { isValidUsername, normalizeUsername } from './lib/username'

export function ProfileRoute() {
  const { username: raw } = useParams<{ username: string }>()
  const normalized = raw ? normalizeUsername(raw) : ''

  if (!raw || !normalized || !isValidUsername(normalized)) {
    return <Navigate to="/" replace />
  }

  if (raw !== normalized) {
    return <Navigate to={`/u/${normalized}`} replace />
  }

  bindApiProfile(normalized)

  return (
    <>
      <ProfileManifest username={normalized} />
      <App />
    </>
  )
}
