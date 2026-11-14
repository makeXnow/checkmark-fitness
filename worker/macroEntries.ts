import type { MacroDayItem } from '../src/types/domain'
import { stableJson, type EntryMutation, type EntryVersions } from '../src/lib/macroEntryChanges'
export type EntryRow = { payload_json: string; revision: number; deleted_at: number | null; last_mutation_id: string | null; ordinal: number; processing_token: string | null }
export async function readEntry(db: D1Database, profile: string, date: string, id: string): Promise<EntryRow | null> {
  return db.prepare('SELECT * FROM macro_entries WHERE device_id=? AND date_key=? AND entry_id=?')
    .bind(profile, date, id).first<EntryRow>()
}
export async function entryVersions(db: D1Database, profile: string): Promise<EntryVersions> {
  try {
    const rows = await db.prepare('SELECT date_key,entry_id,revision FROM macro_entries WHERE device_id=?').bind(profile)
      .all<{ date_key: string; entry_id: string; revision: number }>()
    const versions: EntryVersions = {}
    for (const r of rows.results) (versions[r.date_key] ??= {})[r.entry_id] = r.revision
    return versions
  } catch (e) {
    if (e instanceof Error && e.message.includes('no such table: macro_entries')) return {}
    throw e
  }
}
export async function mutateEntry(db: D1Database, profile: string, op: EntryMutation) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(op.date) || !op.id || op.id.length > 200 || !op.mutationId ||
      !Number.isSafeInteger(op.baseRevision) || op.baseRevision < 0 ||
      (op.item !== null && (!op.item || op.item.id !== op.id))) {
    return { status: 400, error: 'Invalid food entry.' } as const
  }
  const current = await readEntry(db, profile, op.date, op.id)
  if(current && current.deleted_at==null && op.item && ['pending','processing_cancellable','transcribing'].includes(op.item.status)) {
    const stored=JSON.parse(current.payload_json) as MacroDayItem
    const sameInput=['name','amount','rawText','userInput','notes'].every(key=>String((stored as any)[key] ?? '').trim()===String((op.item as any)[key] ?? '').trim())
    // Progress-only phone writes must not invalidate the server's processing lease.
    const enrichesSource=Boolean((op.item.audioKey && op.item.audioKey!==stored.audioKey) || (op.item.scanImages && stableJson(op.item.scanImages)!==stableJson(stored.scanImages)) || (op.item.barcodeValue && op.item.barcodeValue!==stored.barcodeValue))
    if(!enrichesSource && (sameInput || (op.item.status==='transcribing' && stored.audioKey))) return {status:200,revision:current.revision} as const
  }
  // A delayed placeholder/estimate write must not revive a completed request or
  // turn a server-completed food back into a spinner after a lost acknowledgement.
  if(current && op.item && op.baseRevision < current.revision) {
    const stored=JSON.parse(current.payload_json) as MacroDayItem
    if(current.deleted_at!=null && !op.item.name?.trim()) {
      const receipt=await db.prepare("SELECT 1 FROM macro_input_receipts WHERE device_id=? AND request_id=? AND status='parsed'").bind(profile,op.id).first()
      if(receipt) return {status:200,revision:current.revision} as const
    }
    if(current.deleted_at==null && op.item.status==='pending' && stored.status==='ready') return {status:200,revision:current.revision} as const
  }
  const same = current && (op.item === null ? current.deleted_at != null
    : current.deleted_at == null && stableJson(JSON.parse(current.payload_json)) === stableJson(op.item))
  if (current && (current.last_mutation_id === op.mutationId || same)) {
    return { status: 200, revision: current.revision } as const
  }
  let expected = op.baseRevision
  if (current && op.supersedes?.includes(current.last_mutation_id ?? '')) expected = current.revision
  if ((current?.revision ?? 0) !== expected || (!current && op.item === null)) {
    return { status: 409, error: 'This food was changed on another device.', current } as const
  }
  const payload = JSON.stringify(op.item ?? (current ? JSON.parse(current.payload_json) : {}))
  if (new TextEncoder().encode(payload).byteLength > 1_500_000) return { status: 413, error: 'This food entry is too large to save.' } as const
  const now = Date.now()
  const result = await db.batch([
    db.prepare(`INSERT INTO macro_entries
      (device_id,date_key,entry_id,ordinal,payload_json,revision,deleted_at,last_mutation_id,updated_at)
      SELECT ?,?,?,?,?,1,?,?,? WHERE ?=0
      ON CONFLICT(device_id,date_key,entry_id) DO UPDATE SET
        ordinal=excluded.ordinal,payload_json=excluded.payload_json,revision=macro_entries.revision+1,
        deleted_at=excluded.deleted_at,last_mutation_id=excluded.last_mutation_id,processing_token=NULL,updated_at=excluded.updated_at
      WHERE macro_entries.revision=? RETURNING revision`)
      .bind(profile,op.date,op.id,op.ordinal ?? current?.ordinal ?? 0,payload,op.item === null ? now : null,
        op.mutationId,now,current ? 0 : expected,expected),
    db.prepare(`INSERT OR IGNORE INTO macro_diary_days(device_id,date_key)
      SELECT ?,? WHERE EXISTS(SELECT 1 FROM macro_entries WHERE device_id=? AND date_key=? AND entry_id=? AND last_mutation_id=?)`)
      .bind(profile,op.date,profile,op.date,op.id,op.mutationId),
    db.prepare(`UPDATE macro_bundle SET updated_at=MAX(updated_at+1,?)
      WHERE device_id=? AND EXISTS(SELECT 1 FROM macro_entries WHERE device_id=? AND date_key=? AND entry_id=? AND last_mutation_id=?)`)
      .bind(now,profile,profile,op.date,op.id,op.mutationId),
  ])
  const saved = result[0].results[0] as { revision: number } | undefined
  return saved ? { status: 200, revision: saved.revision } as const
    : { status: 409, error: 'This food changed while saving. Your edit is still on this device.' } as const
}
export async function ensureInputEntry(db: D1Database, profile: string, date: string, item: MacroDayItem) {
  const current = await readEntry(db, profile, date, item.id)
  if (current?.deleted_at != null) throw new Error('This food was deleted.')
  if (current) return current
  const result = await mutateEntry(db, profile, { id:item.id,date,item,baseRevision:0,ordinal:item.timestamp ?? Date.now(),mutationId:`input:${item.id}`,supersedes:[] })
  if (result.status !== 200) throw new Error(result.error)
  return (await readEntry(db,profile,date,item.id))!
}
