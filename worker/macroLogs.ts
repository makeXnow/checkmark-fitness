import type { MacroDayItem } from '../src/types/domain'

/** Keep every individual D1 row small while returning the existing app format. */
export async function readMacroLogs<T = MacroDayItem>(db: D1Database, profile: string): Promise<Record<string, T[]>> {
  try {
    const [days, entries] = await Promise.all([
      db.prepare('SELECT date_key FROM macro_diary_days WHERE device_id=?').bind(profile).all<{ date_key: string }>(),
      db.prepare('SELECT date_key,payload_json FROM macro_entries WHERE device_id=? AND deleted_at IS NULL ORDER BY date_key,ordinal,entry_id')
        .bind(profile).all<{ date_key: string; payload_json: string }>(),
    ])
    const logs: Record<string,T[]> = Object.fromEntries(days.results.map(day => [day.date_key, []]))
    for (const row of entries.results) (logs[row.date_key] ??= []).push(JSON.parse(row.payload_json) as T)
    return logs
  } catch (error) {
    if (!(error instanceof Error) || !/no such table: macro_(entries|diary_days)/.test(error.message)) throw error
    const rows = await db.prepare('SELECT date_key, items_json FROM macro_log_days WHERE device_id = ?')
      .bind(profile).all<{ date_key: string; items_json: string }>()
    return Object.fromEntries(rows.results.map(row => [row.date_key, JSON.parse(row.items_json) as T[]]))
  }
}
