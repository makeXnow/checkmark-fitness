import { getBasename } from '../lib/getBasename'
import { withProfileApiPath } from './apiProfile'

/** Deployed Cloudflare Worker (must match wrangler.toml `name` + account workers.dev subdomain). */
const DEPLOYED_WORKER_ORIGIN = 'https://mxn-checkmark-fitness.alexander-c3a.workers.dev'

/** Cloudflare Worker that serves /api/* (must match wrangler.toml `name` + account workers.dev subdomain). */
const WORKER_ORIGIN =
  (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/$/, '') || DEPLOYED_WORKER_ORIGIN

function isLocalDevHost(): boolean {
  if (typeof window === 'undefined') return false
  const host = window.location.hostname
  return host === 'localhost' || host === '127.0.0.1'
}

/** Opt in via VITE_USE_LOCAL_API=1 to hit wrangler dev on :8787 (Worker code changes only). */
function useLocalWorkerApi(): boolean {
  const flag = import.meta.env.VITE_USE_LOCAL_API as string | undefined
  return flag === '1' || flag === 'true'
}

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
 * Resolve API URL. Local Vite dev defaults to the deployed Worker (live D1).
 * Vite: `VITE_API_URL` in `.env.development` / `.env.production`; `VITE_USE_LOCAL_API=1` for local wrangler.
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

  if (isLocalDevHost()) {
    // Vite proxies /api → local wrangler (8787) or use VITE_API_URL / deployed origin.
    if (useLocalWorkerApi()) {
      const base = getBasename()
      if (base === '/') return apiPath
      return `${base.replace(/\/$/, '')}${apiPath}`
    }
    const explicit = (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/$/, '')
    if (explicit) return `${explicit}${apiPath}`
    return `${WORKER_ORIGIN}${apiPath}`
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

function remoteWorkerOrigin(): string {
  return (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/$/, '') || WORKER_ORIGIN
}

async function fetchApi(path: string, init?: RequestInit): Promise<Response> {
  if (typeof window !== 'undefined' && isLocalDevHost()) {
    const remote = remoteWorkerOrigin()

    // Prefer local wrangler via Vite proxy when it is running (even without VITE_USE_LOCAL_API).
    try {
      const base = getBasename()
      const localPath = base === '/' ? path : `${base.replace(/\/$/, '')}${path}`
      const local = await fetch(localPath, init)
      if (local.ok) return local
    } catch {
      /* local wrangler unavailable */
    }

    if (useLocalWorkerApi()) {
      try {
        const local = await fetch(apiUrl(path), init)
        if (local.ok) return local
      } catch {
        /* local wrangler unavailable or errored */
      }
      return fetch(`${remote}${path}`, init)
    }

    return fetch(`${remote}${path}`, init)
  }

  return fetch(apiUrl(path), init)
}

export function apiFetch(path: string, init?: RequestInit): Promise<Response> {
  return fetchApi(withProfileApiPath(path), init)
}

/** Profile-scoped API call without binding activeProfile (entry page). */
export async function apiFetchForProfile(
  profile: string,
  suffix: string,
  init?: RequestInit,
): Promise<Response> {
  const path = `/api/u/${encodeURIComponent(profile)}${suffix.startsWith('/') ? suffix : `/${suffix}`}`

  return fetchApi(path, init)
}
