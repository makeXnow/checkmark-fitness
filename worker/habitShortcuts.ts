export const SHORTCUT_HABITS = ['cardio', 'lift', 'diet', 'water'] as const
export type ShortcutHabit = (typeof SHORTCUT_HABITS)[number]

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789'
const CODE_LENGTH = 8

let schemaReady = false

async function ensureSchema(db: D1Database): Promise<void> {
  if (schemaReady) return
  await db
    .prepare(
      `CREATE TABLE IF NOT EXISTS habit_shortcut_codes (
        device_id TEXT PRIMARY KEY,
        code TEXT NOT NULL UNIQUE,
        time_zone TEXT NOT NULL,
        created_at INTEGER NOT NULL
      )`,
    )
    .run()
  schemaReady = true
}

function randomCode(): string {
  const bytes = new Uint8Array(CODE_LENGTH)
  crypto.getRandomValues(bytes)
  let out = ''
  for (const b of bytes) out += CODE_ALPHABET[b % CODE_ALPHABET.length]
  return out
}

export function isValidTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz })
    return true
  } catch {
    return false
  }
}

/** YYYY-MM-DD in the given IANA time zone. */
export function localDateInTimeZone(tz: string, now = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now)
}

/** Returns the profile's code, creating one (or replacing it when `regenerate`) as needed. */
export async function getOrCreateShortcutCode(
  db: D1Database,
  deviceId: string,
  timeZone: string,
  regenerate: boolean,
): Promise<string> {
  await ensureSchema(db)
  const existing = await db
    .prepare('SELECT code FROM habit_shortcut_codes WHERE device_id = ?')
    .bind(deviceId)
    .first<{ code: string }>()

  if (existing && !regenerate) {
    await db
      .prepare('UPDATE habit_shortcut_codes SET time_zone = ? WHERE device_id = ?')
      .bind(timeZone, deviceId)
      .run()
    return existing.code
  }

  for (let attempt = 0; attempt < 5; attempt++) {
    const code = randomCode()
    try {
      await db
        .prepare(
          `INSERT INTO habit_shortcut_codes (device_id, code, time_zone, created_at)
           VALUES (?, ?, ?, ?)
           ON CONFLICT(device_id) DO UPDATE SET
             code = excluded.code,
             time_zone = excluded.time_zone,
             created_at = excluded.created_at`,
        )
        .bind(deviceId, code, timeZone, Date.now())
        .run()
      return code
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      if (!msg.includes('UNIQUE')) throw e
    }
  }
  throw new Error('Could not generate a unique shortcut code')
}

export async function findProfileByShortcutCode(
  db: D1Database,
  code: string,
): Promise<{ deviceId: string; timeZone: string } | null> {
  await ensureSchema(db)
  const row = await db
    .prepare('SELECT device_id, time_zone FROM habit_shortcut_codes WHERE code = ?')
    .bind(code)
    .first<{ device_id: string; time_zone: string }>()
  return row ? { deviceId: row.device_id, timeZone: row.time_zone } : null
}
