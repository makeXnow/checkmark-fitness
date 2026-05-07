/**
 * Optional absolute API origin (e.g. Worker URL) when the SPA and API are not same-origin.
 * Vite: set `VITE_API_URL=https://your-worker.example.com` in `.env.local`
 */
export function apiUrl(path: string): string {
  const root = (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/$/, '') ?? ''
  if (!path.startsWith('/')) path = `/${path}`
  return `${root}${path}`
}

export function apiFetch(path: string, init?: RequestInit): Promise<Response> {
  return fetch(apiUrl(path), init)
}
