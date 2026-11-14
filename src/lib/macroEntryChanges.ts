import type { MacroDayItem } from '../types/domain'
export type EntryVersions = Record<string, Record<string, number>>
export type EntryMutation = {
  mutationId: string
  date: string
  id: string
  item: MacroDayItem | null
  baseRevision: number
  ordinal: number
  supersedes: string[]
}
export function stableJson(value: unknown): string {
  return JSON.stringify(value, (_, v) => v && typeof v === 'object' && !Array.isArray(v)
    ? Object.fromEntries(Object.keys(v).sort().map(k => [k, v[k]])) : v)
}
/** Membership and fields change independently per entry, including explicit tombstones. */
export function entryChanges(
  previous: Record<string, MacroDayItem[]>, next: Record<string, MacroDayItem[]>,
  versions: EntryVersions, queued: EntryMutation[] = [],
): EntryMutation[] {
  const changes = new Map(queued.map(op => [`${op.date}/${op.id}`, op]))
  for (const [date, items] of Object.entries(next)) {
    const before = new Map((previous[date] ?? []).map(item => [item.id, item]))
    const after = new Map(items.map(item => [item.id, item]))
    for (const id of new Set([...before.keys(), ...after.keys()])) {
      const old = before.get(id), item = after.get(id)
      if (stableJson(old) === stableJson(item)) continue
      const key = `${date}/${id}`, prior = changes.get(key)
      changes.set(key, {
        mutationId: crypto.randomUUID(), date, id, item: item ?? null,
        baseRevision: prior?.baseRevision ?? versions[date]?.[id] ?? 0,
        ordinal: item ? items.findIndex(i => i.id === id) : 0,
        supersedes: prior ? [...prior.supersedes, prior.mutationId].slice(-30) : [],
      })
    }
  }
  return [...changes.values()]
}
