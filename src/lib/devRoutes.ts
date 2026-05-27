import { getBasename } from './getBasename'

/** Pathname with app basename stripped (e.g. `/dev/loading`). */
export function appPathname(): string {
  let path = window.location.pathname
  const basename = getBasename().replace(/\/$/, '')
  if (basename && basename !== '/' && path.startsWith(basename)) {
    path = path.slice(basename.length) || '/'
  }
  return path.replace(/\/$/, '') || '/'
}

export function isDevLoadingRoute(): boolean {
  return appPathname() === '/dev/loading'
}
