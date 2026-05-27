let activeProfile: string | null = null

/** Bind API calls to a profile for the current page (not sign-in — just routing). */
export function bindApiProfile(username: string): void {
  activeProfile = username
}

export function getApiProfile(): string | null {
  return activeProfile
}

/** Prefix user-scoped API paths with `/api/u/{profile}`. Global routes (AI, health) pass through unchanged. */
export function withProfileApiPath(path: string): string {
  if (!path.startsWith('/api/')) return path
  const globalPrefixes = ['/api/health', '/api/ai/', '/api/fatsecret/', '/api/macro/estimate', '/api/internal/']
  if (globalPrefixes.some((p) => path === p || path.startsWith(p))) return path

  const profile = activeProfile
  if (!profile) {
    throw new Error('No profile in URL')
  }
  const suffix = path.slice('/api'.length)
  return `/api/u/${encodeURIComponent(profile)}${suffix}`
}
