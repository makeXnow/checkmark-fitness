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

function isLocalMachine(): boolean {
  if (typeof window === 'undefined') return false
  const host = window.location.hostname
  return host === 'localhost' || host === '127.0.0.1'
}

/** Local dev tool for reviewing FatSecret serving-size conversions (not deployed). */
export function isDevServingAuditRoute(): boolean {
  return import.meta.env.DEV && isLocalMachine() && appPathname().startsWith('/dev/serving-audit')
}

export type ServingAuditVersion = 'v1' | 'v2' | 'v3' | 'v4' | 'v5' | 'v6' | 'v7' | 'v8' | 'v9'

export function devServingAuditVersion(): ServingAuditVersion {
  const path = appPathname()
  if (path === '/dev/serving-audit/v9' || path.endsWith('/v9')) return 'v9'
  if (path === '/dev/serving-audit/v8' || path.endsWith('/v8')) return 'v8'
  if (path === '/dev/serving-audit/v7' || path.endsWith('/v7')) return 'v7'
  if (path === '/dev/serving-audit/v6' || path.endsWith('/v6')) return 'v6'
  if (path === '/dev/serving-audit/v5' || path.endsWith('/v5')) return 'v5'
  if (path === '/dev/serving-audit/v4' || path.endsWith('/v4')) return 'v4'
  if (path === '/dev/serving-audit/v3' || path.endsWith('/v3')) return 'v3'
  if (path === '/dev/serving-audit/v2' || path.endsWith('/v2')) return 'v2'
  return 'v1'
}

export function devServingAuditHref(version: ServingAuditVersion): string {
  const basename = getBasename().replace(/\/$/, '')
  const suffix =
    version === 'v9'
      ? '/dev/serving-audit/v9'
      : version === 'v8'
      ? '/dev/serving-audit/v8'
      : version === 'v7'
      ? '/dev/serving-audit/v7'
      : version === 'v6'
      ? '/dev/serving-audit/v6'
      : version === 'v5'
        ? '/dev/serving-audit/v5'
      : version === 'v4'
        ? '/dev/serving-audit/v4'
        : version === 'v3'
          ? '/dev/serving-audit/v3'
          : version === 'v2'
            ? '/dev/serving-audit/v2'
            : '/dev/serving-audit/v1'
  if (!basename || basename === '/') return suffix
  return `${basename}${suffix}`
}
