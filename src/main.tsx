import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { AppRouter } from './AppRouter'
import { DevLoadingPage } from './dev/DevLoadingPage'
import './index.css'
import { isDevLoadingRoute } from './lib/devRoutes'
import { getBasename } from './lib/getBasename'
import { initPortraitOrientationLock } from './lib/lockOrientation'
import { registerServiceWorker } from './lib/registerServiceWorker'

initPortraitOrientationLock()

if (import.meta.env.PROD) {
  registerServiceWorker()
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    {isDevLoadingRoute() ? (
      <DevLoadingPage />
    ) : (
      <BrowserRouter basename={getBasename()}>
        <AppRouter />
      </BrowserRouter>
    )}
  </React.StrictMode>,
)
