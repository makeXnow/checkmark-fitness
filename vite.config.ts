import type { IncomingMessage, ServerResponse } from 'node:http'
import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

const PROFILE_MANIFEST_RE = /\/manifest\/u\/([a-z0-9][a-z0-9_-]*[a-z0-9]|[a-z0-9])\.webmanifest$/

function profileManifestDevPlugin(): Plugin {
  return {
    name: 'profile-manifest-dev',
    configureServer(server) {
      server.middlewares.use((req: IncomingMessage, res: ServerResponse, next: () => void) => {
        const url = req.url?.split('?')[0] ?? ''
        const m = url.match(PROFILE_MANIFEST_RE)
        if (!m) {
          next()
          return
        }
        const username = m[1]
        const baseEnd = url.indexOf('/manifest/')
        const basePath = baseEnd > 0 ? url.slice(0, baseEnd) : ''
        const startUrl = `${basePath}/u/${username}`
        const scope = basePath ? `${basePath}/` : '/'
        const body = {
          name: `Checkmark · ${username}`,
          short_name: username,
          start_url: startUrl,
          scope,
          display: 'standalone',
          orientation: 'portrait-primary',
          background_color: '#0a0a0a',
          theme_color: '#0a0a0a',
          icons: [
            { src: `${basePath}/icons/pwa-192.png`, sizes: '192x192', type: 'image/png', purpose: 'any' },
            { src: `${basePath}/icons/pwa-512.png`, sizes: '512x512', type: 'image/png', purpose: 'any' },
            {
              src: `${basePath}/icons/pwa-512.png`,
              sizes: '512x512',
              type: 'image/png',
              purpose: 'maskable',
            },
          ],
        }
        res.setHeader('Content-Type', 'application/manifest+json')
        res.setHeader('Cache-Control', 'no-cache')
        res.end(JSON.stringify(body))
      })
    },
  }
}

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    profileManifestDevPlugin(),
  ],
  // Use relative paths so the app works when hosted at /apps/your-app/
  base: './',
  server: {
    port: 9024,
    strictPort: true,
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:8787',
        changeOrigin: true,
      },
      '/manifest': {
        target: 'http://127.0.0.1:8787',
        changeOrigin: true,
      },
    },
  },
})
