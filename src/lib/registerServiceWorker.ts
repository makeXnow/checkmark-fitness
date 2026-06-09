import { getBasename } from './getBasename'

/** Register asset-caching service worker (production only). */
export function registerServiceWorker(): void {
  if (!('serviceWorker' in navigator)) return

  const base = getBasename()
  const prefix = !base || base === '/' ? '' : base.replace(/\/$/, '')
  const swUrl = `${prefix}/sw.js`
  const scope = prefix ? `${prefix}/` : '/'

  void navigator.serviceWorker
    .register(swUrl, { scope })
    .catch(() => {
      /* unsupported scope or blocked */
    })
}
