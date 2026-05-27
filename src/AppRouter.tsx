import { Route, Routes } from 'react-router-dom'
import { ProfileRoute } from './ProfileRoute'
import { UsernameEntryPage } from './pages/UsernameEntryPage'

export function AppRouter() {
  return (
    <Routes>
      <Route path="/" element={<UsernameEntryPage />} />
      <Route path="/u/:username/*" element={<ProfileRoute />} />
    </Routes>
  )
}
