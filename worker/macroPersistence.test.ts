import { readMacroLogs } from './macroLogs'
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
    const migration = readFileSync('migrations/0009_macro_log_days.sql', 'utf8')
    const dayTriggers = migration.match(/CREATE TRIGGER[\s\S]*?END;/g) ?? []
    const statements = migration.replace(/CREATE TRIGGER[\s\S]*?END;/g, '').split(';').filter(s => s.trim())
    for (const statement of statements) await db.prepare(statement).run()
    for (const trigger of dayTriggers) await db.prepare(trigger).run()

    const entryMigration=readFileSync('migrations/0010_macro_entries.sql','utf8')
    const entryTriggers=entryMigration.match(/CREATE TRIGGER[\s\S]*?END;/g) ?? []
    for(const statement of entryMigration.replace(/CREATE TRIGGER[\s\S]*?END;/g,'').split(';').filter(s=>s.trim())) await db.prepare(statement).run()
    for(const trigger of entryTriggers) await db.prepare(trigger).run()

  })
  afterAll(async () => { await mf?.dispose() })
  async function seed(profile: string) {
    await db.prepare('INSERT INTO app_state(device_id, selected_date, updated_at) VALUES (?, ?, ?)').bind(profile, '2026-10-16', 100).run()
    await db.prepare('INSERT INTO macro_bundle(device_id, goals_json, custom_foods_json, logs_json, updated_at) VALUES (?, ?, ?, ?, ?)').bind(profile, '{}', '[]', '{}', 100).run()
    await db.prepare('INSERT INTO macro_diary_days VALUES (?,?)').bind(profile,'2026-10-16').run()
    await db.prepare('INSERT INTO macro_entries(device_id,date_key,entry_id,ordinal,payload_json,revision,updated_at) VALUES(?,?,?,?,?,1,?)').bind(profile,'2026-10-16',food.id,0,JSON.stringify(food),100).run()
  }
  async function save(profile: string, body: Record<string, unknown>) {
    return mf.dispatchFetch(`https://example.test/api/u/${profile}/macro`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ goals: {}, customFoods: [], ...body }) })
  }
  async function row(profile: string) {
    const metadata = await db.prepare('SELECT * FROM macro_bundle WHERE device_id = ?').bind(profile).first<{ updated_at: number }>()
    return metadata ? { ...metadata, logs_json: JSON.stringify(await readMacroLogs(db, profile)) } : null
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
  it('normalizes and combines library portions at the save boundary without changing diary totals', async () => {
    await seed('library-portions')
    const customFoods = [
      { id: 'five', name: 'Carrots', baseAmount: '5 oz', calories: 58, protein: 1, fat: 0, carbs: 10 },
      { id: 'three', name: 'Carrots', baseAmount: '3 oz', calories: 30, protein: 1, fat: 0, carbs: 6 },
    ]
    const response = await save('library-portions', { baseUpdatedAt: 100, customFoods, logs: {} })
    expect(response.status).toBe(200)
    const stored = await db.prepare('SELECT custom_foods_json, logs_json FROM macro_bundle WHERE device_id = ?')
      .bind('library-portions').first<{ custom_foods_json: string; logs_json: string }>()
    const foods = JSON.parse(stored!.custom_foods_json)
    expect(foods).toHaveLength(1)
    expect(foods[0]).toMatchObject({ baseAmount: '1 oz', calories: 11.6, protein: 0.2, mergedFoodIds: ['three'] })
    expect((await readMacroLogs(db, 'library-portions'))['2026-10-16']).toEqual([food])
  })
  it('saves a changed day in a large diary without binding unchanged history', async () => {
    await seed('large-diary')
    const history = Object.fromEntries(Array.from({ length: 30 }, (_, i) =>
      [`2026-09-${String(i + 1).padStart(2, '0')}`, [{ ...food, audit: 'x'.repeat(280_000) }]],
    ))
    for (const [day, items] of Object.entries(history)) {
      await db.prepare('INSERT INTO macro_diary_days VALUES (?,?)').bind('large-diary',day).run()
      await db.prepare('INSERT INTO macro_entries(device_id,date_key,entry_id,ordinal,payload_json,revision,updated_at) VALUES(?,?,?,?,?,1,?)')
        .bind('large-diary',day,food.id,0,JSON.stringify(items[0]),100).run()
    }
    const response = await save('large-diary', { baseUpdatedAt: 100, logs: { ...history, '2026-11-11': [] } })
    expect(response.status).toBe(200)
    const logs = JSON.parse((await row('large-diary'))!.logs_json)
    expect(logs['2026-11-11']).toEqual([])
    expect(logs['2026-09-01']).toEqual(history['2026-09-01'])
    expect(Object.keys(logs)).toHaveLength(32)
  }, 20_000)
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
    const backup = await db.prepare("SELECT '[' || payload_json || ']' AS logs_json FROM macro_entry_history WHERE device_id = ?").bind('two-writers').first<{ logs_json: string }>()
    expect(JSON.parse(backup!.logs_json)).toEqual([food])
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
    for (let i = 0; i < 25; i++) await db.prepare('UPDATE macro_entries SET payload_json = ?, revision=revision+1, updated_at=updated_at+1 WHERE device_id=?').bind(JSON.stringify({ ...food, calories: i }), 'retention').run()
    const recent = await db.prepare("SELECT count(*) AS n FROM macro_entry_history WHERE device_id=?").bind('retention').first<{ n: number }>()
    const daily = await db.prepare("SELECT '[' || payload_json || ']' AS logs_json FROM macro_entry_history WHERE device_id=? ORDER BY revision ASC LIMIT 1").bind('retention').first<{ logs_json: string }>()
    expect(recent?.n).toBe(20)
    expect(JSON.parse(daily!.logs_json)).toHaveLength(1)
    expect((await row('old-app'))?.updated_at).toBe(100)
  })
  it('backs up a direct database deletion too', async () => {
    await seed('deleted-profile')
    await db.prepare('UPDATE macro_entries SET deleted_at=123,revision=revision+1 WHERE device_id=?').bind('deleted-profile').run()
    const backup = await db.prepare("SELECT '[' || payload_json || ']' AS logs_json FROM macro_entry_history WHERE device_id = ?").bind('deleted-profile').first<{ logs_json: string }>()
    expect(JSON.parse(backup!.logs_json)).toEqual([food])
  })
})
