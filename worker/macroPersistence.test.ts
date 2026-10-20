import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { Miniflare } from 'miniflare'
import { readFileSync } from 'node:fs'
import { build } from 'esbuild'

// Exercise the actual isolated production route, backed by local D1/SQLite.
const scriptPath = process.env.MACRO_PERSISTENCE_WORKER
describe('food diary persistence', () => {
  let mf: Miniflare
  let db: D1Database
  const food = { id: 'dinner', name: 'Dinner', calories: 650 }
  beforeAll(async () => {
    const script = scriptPath ? readFileSync(scriptPath, 'utf8') : (await build({ entryPoints: ['worker/index.ts'], bundle: true, write: false, format: 'esm', platform: 'browser', external: ['node:async_hooks'], target: 'es2022' })).outputFiles[0].text
    mf = new Miniflare({ modules: true, script, compatibilityDate: '2025-12-01', compatibilityFlags: ['nodejs_als'], d1Databases: { DB: 'macro-persistence-tests' } })
    db = await mf.getD1Database('DB') as unknown as D1Database
    const schema = readFileSync('migrations/0001_init.sql', 'utf8')
    for (const statement of schema.match(/CREATE TABLE[\s\S]*?;/g) ?? []) await db.prepare(statement).run()
    const backups = readFileSync('migrations/0007_macro_bundle_backups.sql', 'utf8')
    const triggers = backups.match(/CREATE TRIGGER[\s\S]*?END;/g) ?? []
    const definitions = backups.slice(0, backups.indexOf('CREATE TRIGGER'))
    for (const statement of definitions.match(/CREATE (?:TABLE|INDEX)[\s\S]*?;/g) ?? []) await db.prepare(statement).run()
    for (const trigger of triggers) await db.prepare(trigger).run()
  })
  afterAll(async () => { await mf?.dispose() })
  async function seed(profile: string) {
    await db.prepare('INSERT INTO app_state(device_id, selected_date, updated_at) VALUES (?, ?, ?)').bind(profile, '2026-10-16', 100).run()
    await db.prepare('INSERT INTO macro_bundle VALUES (?, ?, ?, ?, ?)').bind(profile, '{}', '[]', JSON.stringify({ '2026-10-16': [food] }), 100).run()
  }
  async function save(profile: string, body: Record<string, unknown>) {
    return mf.dispatchFetch(`https://example.test/api/u/${profile}/macro`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ goals: {}, customFoods: [], ...body }) })
  }
  async function row(profile: string) {
    return db.prepare('SELECT * FROM macro_bundle WHERE device_id = ?').bind(profile).first<{ logs_json: string; updated_at: number }>()
  }
  it('allows cross-origin attribution headers used by the app', async () => {
    const response = await mf.dispatchFetch('https://example.test/api/ai/json', {
      method: 'OPTIONS', headers: { Origin: 'https://makexnow.com',
        'Access-Control-Request-Method': 'POST',
        'Access-Control-Request-Headers': 'content-type,x-checkmark-profile,x-checkmark-source' },
    })
    expect(response.status).toBe(204)
    expect(response.headers.get('Access-Control-Allow-Headers')).toContain('x-checkmark-profile')
    expect(response.headers.get('Access-Control-Allow-Headers')).toContain('x-checkmark-source')
  })
  it('rejects an old app with no revision and does not touch stored food', async () => {
    await seed('old-app')
    const response = await save('old-app', { logs: {} })
    expect(response.status).toBe(428)
    expect((await row('old-app'))?.updated_at).toBe(100)
  })
  it('rejects an incomplete payload even with a current revision', async () => {
    await seed('incomplete')
    const response = await save('incomplete', { baseUpdatedAt: 100 })
    expect(response.status).toBe(400)
    expect((await row('incomplete'))?.updated_at).toBe(100)
  })
  it('allows only one writer using a given revision, retaining the winning edit and its backup', async () => {
    await seed('two-writers')
    const response = await save('two-writers', { baseUpdatedAt: 100, logs: { '2026-10-16': [{ ...food, calories: 700 }] } })
    expect(response.status).toBe(200)
    const ack = await response.json() as { updatedAt: number }
    expect(ack.updatedAt).toBeGreaterThan(100)
    const stale = await save('two-writers', { baseUpdatedAt: 100, logs: { '2026-10-16': [] } })
    expect(stale.status).toBe(409)
    const saved = await row('two-writers')
    expect(saved?.updated_at).toBe(ack.updatedAt)
    expect(JSON.parse(saved!.logs_json)['2026-10-16'][0].calories).toBe(700)
    const backup = await db.prepare("SELECT logs_json FROM macro_bundle_backups WHERE device_id = ? AND kind = 'recent'").bind('two-writers').first<{ logs_json: string }>()
    expect(JSON.parse(backup!.logs_json)['2026-10-16']).toEqual([food])
  })
  it('keeps omitted days but permits an intentional deletion using the latest revision', async () => {
    await seed('day-deletion')
    const first = await save('day-deletion', { baseUpdatedAt: 100, logs: { '2026-10-15': [food] } })
    const ack = await first.json() as { updatedAt: number }
    expect(Object.keys(JSON.parse((await row('day-deletion'))!.logs_json))).toHaveLength(2)
    const second = await save('day-deletion', { baseUpdatedAt: ack.updatedAt, logs: { '2026-10-16': [] } })
    expect(second.status).toBe(200)
    const logs = JSON.parse((await row('day-deletion'))!.logs_json)
    expect(logs['2026-10-16']).toEqual([])
    expect(logs['2026-10-15']).toEqual([food])
  })
  it('keeps recent backups bounded, a daily baseline, and isolates profiles', async () => {
    await seed('retention')
    for (let i = 0; i < 25; i++) await db.prepare('UPDATE macro_bundle SET logs_json = ?, updated_at = updated_at + 1 WHERE device_id = ?').bind(JSON.stringify({ '2026-10-16': [{ ...food, calories: i }] }), 'retention').run()
    const recent = await db.prepare("SELECT count(*) AS n FROM macro_bundle_backups WHERE device_id = ? AND kind = 'recent'").bind('retention').first<{ n: number }>()
    const daily = await db.prepare("SELECT logs_json FROM macro_bundle_backups WHERE device_id = ? AND kind = 'daily'").bind('retention').first<{ logs_json: string }>()
    expect(recent?.n).toBe(20)
    expect(JSON.parse(daily!.logs_json)['2026-10-16']).toEqual([food])
    expect((await row('old-app'))?.updated_at).toBe(100)
  })
  it('backs up a direct database deletion too', async () => {
    await seed('deleted-profile')
    await db.prepare('DELETE FROM macro_bundle WHERE device_id = ?').bind('deleted-profile').run()
    const backup = await db.prepare("SELECT logs_json FROM macro_bundle_backups WHERE device_id = ? AND kind = 'recent'").bind('deleted-profile').first<{ logs_json: string }>()
    expect(JSON.parse(backup!.logs_json)['2026-10-16']).toEqual([food])
  })
})
