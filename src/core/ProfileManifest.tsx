import { useEffect } from 'react'
import { getBasename } from '../lib/getBasename'

const DEFAULT_MANIFEST = './manifest.webmanifest'

/** Per-profile PWA manifest so Add to Home Screen opens this user's URL. */
export function ProfileManifest({ username }: { username: string }) {
  useEffect(() => {
    const base = getBasename().replace(/\/$/, '')
    const manifestHref = `${base}/manifest/u/${encodeURIComponent(username)}.webmanifest`
    let link = document.querySelector<HTMLLinkElement>('link[rel="manifest"]')
    const created = !link
    if (!link) {
      link = document.createElement('link')
      link.rel = 'manifest'
      document.head.appendChild(link)
    }
    const prevHref = link.getAttribute('href') ?? DEFAULT_MANIFEST
    link.href = manifestHref

    const prevTitle = document.title
    const display = username.charAt(0).toUpperCase() + username.slice(1)
    document.title = `Checkmark · ${display}`

    const appleTitle = document.querySelector<HTMLMetaElement>('meta[name="apple-mobile-web-app-title"]')
    const prevApple = appleTitle?.getAttribute('content')
    if (appleTitle) appleTitle.content = display

    return () => {
      if (link) link.href = prevHref ?? DEFAULT_MANIFEST
      document.title = prevTitle
      if (appleTitle && prevApple != null) appleTitle.content = prevApple
      if (created && link?.parentNode) link.parentNode.removeChild(link)
    }
  }, [username])

  return null
}
