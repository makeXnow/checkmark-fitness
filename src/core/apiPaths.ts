import { getBasename } from '../lib/getBasename'

/**
 * Optional absolute API origin (e.g. Worker URL) when the SPA and API are not same-origin.
 * Vite: set `VITE_API_URL=https://your-worker.example.com` in `.env.local`
 *
 * When unset, API paths are rooted at the app’s runtime base path (e.g. `/apps/your-app`)
 * so requests hit the Worker’s `/api/*` routes instead of resolving incorrectly as `./api/...`.
 */
export function apiUrl(path: string): string {
  const explicit = (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/$/, '')
  if (explicit) {
    const p = path.startsWith('/') ? path : `/${path}`
    return `${explicit}${p}`
  }

  const apiPath = path.startsWith('/') ? path : `/${path}`

  if (typeof window !== 'undefined') {
    const base = getBasename()
    if (base === '/') return apiPath
    return `${base.replace(/\/$/, '')}${apiPath}`
  }

  const viteBase = import.meta.env.BASE_URL || './'
  const normalized = viteBase.endsWith('/') ? viteBase : `${viteBase}/`
  const rel = apiPath.startsWith('/') ? apiPath.slice(1) : apiPath
  return `${normalized}${rel}`
}

export function apiFetch(path: string, init?: RequestInit): Promise<Response> {
  return fetch(apiUrl(path), init)
}
