/**
 * Detects the base path dynamically for React Router.
 * This allows the app to work at any URL path (/, /my-app/, etc.)
 * making it "spin-off ready" - deployable anywhere without config changes.
 *
 * Usage with React Router:
 * ```tsx
 * import { BrowserRouter } from 'react-router-dom';
 * import { getBasename } from './lib/getBasename';
 *
 * <BrowserRouter basename={getBasename()}>
 *   <App />
 * </BrowserRouter>
 * ```
 */

/** App root when URL is under `/u/:username` (e.g. `/checkmark-fitness/u/alexander` → `/checkmark-fitness`). */
export function getAppBaseFromPathname(pathname: string): string | null {
  const u = pathname.indexOf('/u/')
  if (u < 0) return null
  return u === 0 ? '' : pathname.slice(0, u)
}

/** Keep index.html inline base bootstrap in sync with getAppBaseFromPathname. */

export function getBasename(): string {
  if (typeof window !== 'undefined') {
    const fromProfilePath = getAppBaseFromPathname(window.location.pathname)
    // Profile at site root (/u/name) → ''; subpath deploy (/apps/foo/u/name) → '/apps/foo'
    if (fromProfilePath !== null) return fromProfilePath
  }

  const scripts = document.getElementsByTagName('script')
  for (const script of scripts) {
    const src = script.src
    if (src && src.includes('/assets/')) {
      try {
        const url = new URL(src)
        const assetsIndex = url.pathname.indexOf('/assets/')
        if (assetsIndex > 0) {
          const basePath = url.pathname.substring(0, assetsIndex)
          return basePath || '/'
        }
      } catch {
        /* invalid URL */
      }
    }
  }

  const baseUrl = import.meta.env.BASE_URL
  if (baseUrl && baseUrl !== './' && baseUrl !== '/') {
    return baseUrl.replace(/\/$/, '')
  }

  return '/'
}
