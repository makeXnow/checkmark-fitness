import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './index.css'
import { initPortraitOrientationLock } from './lib/lockOrientation'

initPortraitOrientationLock()

/**
 * If you add React Router to this app, wrap it like this:
 * 
 * import { BrowserRouter } from 'react-router-dom';
 * import { getBasename } from './lib/getBasename';
 * 
 * <BrowserRouter basename={getBasename()}>
 *   <App />
 * </BrowserRouter>
 * 
 * This ensures the app works at any URL path (/, /my-app/, etc.)
 */

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
