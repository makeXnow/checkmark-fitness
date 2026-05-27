let activeProfile: string | null = null

export function setApiProfile(username: string | null): void {
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
    throw new Error('No profile selected')
  }
  const suffix = path.slice('/api'.length)
  return `/api/u/${encodeURIComponent(profile)}${suffix}`
}
