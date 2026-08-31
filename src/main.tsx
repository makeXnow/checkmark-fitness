import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { AppRouter } from './AppRouter'
import { DevLoadingPage } from './dev/DevLoadingPage'
import { ServingAuditPage } from './dev/servingAudit/ServingAuditPage'
import './index.css'
import { isDevLoadingRoute, isDevServingAuditRoute } from './lib/devRoutes'
import { getBasename } from './lib/getBasename'
import { MxnAuthGate } from './lib/MxnAuthGate'
import { initPortraitOrientationLock } from './lib/lockOrientation'
import { registerServiceWorker } from './lib/registerServiceWorker'

initPortraitOrientationLock()

if (import.meta.env.PROD) {
  registerServiceWorker()
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    {isDevServingAuditRoute() ? (
      <ServingAuditPage />
    ) : isDevLoadingRoute() ? (
      <DevLoadingPage />
    ) : (
      <MxnAuthGate>
        <BrowserRouter basename={getBasename()}>
          <AppRouter />
        </BrowserRouter>
      </MxnAuthGate>
    )}
  </React.StrictMode>,
)
