import { isValidUsername, normalizeUsername } from './username'

/**
 * Optional aliases: known Google emails → existing profile slugs.
 * This is NOT an allowlist — any Google account can sign in.
 * Unmapped emails get a slug from the address local-part.
 */
const EMAIL_TO_PROFILE: Record<string, string> = {
  'alexander@makexnow.com': 'alexander',
  'carissa.lords@hotmail.com': 'carissa',
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase()
}

/** Stable profile slug for a signed-in Google email. Always returns a slug. */
export function profileForEmail(email: string): string {
  const normalized = normalizeEmail(email)
  const mapped = EMAIL_TO_PROFILE[normalized]
  if (mapped) return mapped

  const local = normalized.split('@')[0] || 'user'
  const slug = normalizeUsername(local.replace(/\./g, '-'))
  if (slug && isValidUsername(slug)) return slug
  return 'user'
}
