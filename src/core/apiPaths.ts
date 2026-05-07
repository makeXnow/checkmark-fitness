/**
 * Optional absolute API origin (e.g. Worker URL) when the SPA and API are not same-origin.
 * Vite: set `VITE_API_URL=https://your-worker.example.com` in `.env.local`
 *
 * When unset, URLs are rooted at `import.meta.env.BASE_URL` so the same build works under
 * a subpath (e.g. makexnow.com/apps/your-app/) instead of always hitting `/api` on the domain root.
 */
export function apiUrl(path: string): string {
  const explicit = (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/$/, '')
  if (explicit) {
    const p = path.startsWith('/') ? path : `/${path}`
    return `${explicit}${p}`
  }
  const base = import.meta.env.BASE_URL || '/'
  const normalized = base.endsWith('/') ? base : `${base}/`
  const rel = path.startsWith('/') ? path.slice(1) : path
  return `${normalized}${rel}`
}

export function apiFetch(path: string, init?: RequestInit): Promise<Response> {
  return fetch(apiUrl(path), init)
}
