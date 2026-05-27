import { Route, Routes } from 'react-router-dom'
import { ProfileRoute } from './ProfileRoute'
import { SignInPage } from './pages/SignInPage'

export function AppRouter() {
  return (
    <Routes>
      <Route path="/" element={<SignInPage />} />
      <Route path="/u/:username/*" element={<ProfileRoute />} />
      <Route path="*" element={<SignInPage />} />
    </Routes>
  )
}
