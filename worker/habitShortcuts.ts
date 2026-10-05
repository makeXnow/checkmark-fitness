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

/** The 7 YYYY-MM-DD dates of the week containing `date`; `firstDayOfWeek` 0 = Sunday, 1 = Monday. */
export function weekDatesFor(date: string, firstDayOfWeek: number): string[] {
  const d = new Date(`${date}T00:00:00Z`)
  const offset = (d.getUTCDay() - firstDayOfWeek + 7) % 7
  d.setUTCDate(d.getUTCDate() - offset)
  const out: string[] = []
  for (let i = 0; i < 7; i++) {
    out.push(d.toISOString().slice(0, 10))
    d.setUTCDate(d.getUTCDate() + 1)
  }
  return out
}

type DayLogLike = Record<string, unknown>

/**
 * Applies a shortcut run to today's log and returns the text Shortcuts shows / Siri speaks.
 * `changed` is false when the run was a no-op (already tracked / water already at target).
 */
export function applyHabitShortcut(opts: {
  habit: ShortcutHabit
  label: string
  goal: Record<string, unknown>
  today: string
  logs: Record<string, DayLogLike>
  firstDayOfWeek: number
}): { day: DayLogLike; changed: boolean; message: string } {
  const { habit, label, goal, today, logs, firstDayOfWeek } = opts
  const day = { ...(logs[today] || {}) }

  if (habit === 'water') {
    const target = Number(goal.dailyTarget) || 1
    const current = Number(day.water) || 0
    if (current >= target) {
      return { day, changed: false, message: `${label} already at ${target} of ${target}.` }
    }
    const next = current + 1
    day.water = next
    const message = next >= target ? `${label} goal hit, ${next} of ${target}!` : `${label} ${next} of ${target}.`
    return { day, changed: true, message }
  }

  if (day[habit]) {
    return { day, changed: false, message: `${label} already tracked today.` }
  }
  day[habit] = true

  const weekMin = Number(goal.min) || 0
  const weekCount = weekDatesFor(today, firstDayOfWeek).filter((d) =>
    d === today ? true : Boolean(logs[d]?.[habit]),
  ).length

  let message: string
  if (weekMin > 0 && weekCount === weekMin) message = `${label} tracked. Weekly goal hit!`
  else if (weekMin > 0 && weekCount < weekMin) message = `${label} tracked. ${weekCount} of ${weekMin} this week.`
  else message = `${label} tracked. ${weekCount} this week.`
  return { day, changed: true, message }
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
