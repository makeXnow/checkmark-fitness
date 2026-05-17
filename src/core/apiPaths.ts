import { getBasename } from '../lib/getBasename'

/** Cloudflare Worker that serves /api/* (must match wrangler.toml `name` + account workers.dev subdomain). */
const WORKER_ORIGIN =
  (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/$/, '') ||
  'https://mxn-checkmark-fitness.alexander-c3a.workers.dev'

/**
 * On makexnow.com the router often proxies to static Pages; /api/* then returns index.html.
 * Always call the Worker origin directly in that case (CORS is enabled on the Worker).
 */
function useWorkerOriginInBrowser(): boolean {
  if (typeof window === 'undefined') return false
  const host = window.location.hostname
  if (host === 'localhost' || host === '127.0.0.1') return false
  try {
    if (host === new URL(WORKER_ORIGIN).hostname) return false
  } catch {
    /* ignore */
  }
  if (host.endsWith('.workers.dev')) return false
  return true
}

/**
 * Optional absolute API origin (e.g. Worker URL) when the SPA and API are not same-origin.
 * Vite: set `VITE_API_URL` in `.env.production` or `.env.local`
 */
export function apiUrl(path: string): string {
  const apiPath = path.startsWith('/') ? path : `/${path}`

  if (typeof window !== 'undefined') {
    try {
      if (window.location.hostname === new URL(WORKER_ORIGIN).hostname) {
        return apiPath
      }
    } catch {
      /* ignore */
    }
  }

  if (useWorkerOriginInBrowser()) {
    return `${WORKER_ORIGIN}${apiPath}`
  }

  const explicit = (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/$/, '')
  if (explicit) {
    return `${explicit}${apiPath}`
  }

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
