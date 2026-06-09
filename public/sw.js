/* eslint-disable no-undef */
/** Static asset cache — version replaced at build time. */
const CACHE_ID = '__CHECKMARK_SW_CACHE__'

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_ID).then((cache) =>
      cache.addAll(['./index.html']).catch(() => undefined),
    ),
  )
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys.filter((k) => k.startsWith('checkmark-static-') && k !== CACHE_ID).map((k) => caches.delete(k)),
      ),
    ),
  )
  self.clients.claim()
})

self.addEventListener('fetch', (event) => {
  const { request } = event
  const url = new URL(request.url)

  if (url.pathname.includes('/api')) return

  if (request.method !== 'GET') return

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request).catch(() => caches.open(CACHE_ID).then((c) => c.match('./index.html'))),
    )
    return
  }

  const dest = request.destination
  if (dest !== 'script' && dest !== 'style' && dest !== 'font' && dest !== 'image') return

  event.respondWith(
    caches.open(CACHE_ID).then(async (cache) => {
      const cached = await cache.match(request)
      if (cached) return cached
      const res = await fetch(request)
      if (res.ok) void cache.put(request, res.clone())
      return res
    }),
  )
})
