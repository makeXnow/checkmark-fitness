import type { MacroDayItem } from '../src/types/domain'
import type { Hono } from 'hono'
import type { Env } from './index'

export type VoiceRequest = { profile: string; id: string; attempt: number }
export const voiceKey = (profile: string, id: string) => `${profile}/voice/${id}`

type Ticket = { date: string; attempt: number; phase: string }
export async function dispatch(env: Env, params: VoiceRequest) {
  // createBatch skips existing instance IDs, including after a lost HTTP response.
  await env.VOICE_JOBS!.createBatch([{ id: `${params.profile}-${params.id}-${params.attempt}`, params }])
}

export function registerVoiceRoutes(app: Hono<{ Bindings: Env; Variables: { profileId: string } }>,
  ensureDevice: (db: D1Database, profile: string) => Promise<void>) {
  app.put('/macro/voice/:date/:id', async c => {
    const profile = c.get('profileId')
    const { date, id } = c.req.param()
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(id))
      return c.json({ error: 'Invalid recording ID or date.' }, 400)
    const { DB: db, SCAN_IMAGES: bucket, VOICE_JOBS: workflow } = c.env
    if (!bucket || !workflow) return c.json({ error: 'Recording storage unavailable.' }, 503)
    const lookup = db.prepare('SELECT date, attempt, phase FROM voice_jobs WHERE profile=? AND id=?').bind(profile, id)
    let job = await lookup.first<Ticket>()
    if (!job) {
      const mime = c.req.header('content-type') || ''
      if (!mime.startsWith('audio/')) return c.json({ error: 'Expected an audio recording.' }, 415)
      if (Number(c.req.header('content-length')) > 25_000_000) return c.json({ error: 'Recording is too large.' }, 413)
      const audio = await c.req.arrayBuffer()
      if (!audio.byteLength || audio.byteLength > 25_000_000) return c.json({ error: 'Recording is empty or too large.' }, 413)
      await ensureDevice(db, profile)
      await bucket.put(voiceKey(profile, id), audio, { onlyIf: { etagDoesNotMatch: '*' }, httpMetadata: { contentType: mime } })
      const recordedAt = Number(c.req.query('recordedAt'))
      await db.prepare('INSERT OR IGNORE INTO voice_jobs(profile,id,date,recorded_at) VALUES(?,?,?,?)')
        .bind(profile, id, date, Number.isSafeInteger(recordedAt) && recordedAt > 0 ? recordedAt : Date.now()).run()
      job = (await lookup.first<Ticket>())!
    }
    if (job.date !== date) return c.json({ error: 'Recording already belongs to another day.' }, 409)
    if (job.phase === 'queued') await dispatch(c.env, { profile, id, attempt: job.attempt })
    return c.json({ id }, 202)
  })

  app.get('/macro/voice/:date', async c => {
    const profile = c.get('profileId'), date = c.req.param('date')
    const result = await c.env.DB.prepare(`SELECT id, phase, error, transcript, recorded_at AS timestamp,
      (SELECT group_concat(json_extract(value,'$.name'), ', ') FROM json_each(foods)
        WHERE NOT EXISTS(SELECT 1 FROM macro_entries e WHERE e.device_id=voice_jobs.profile
          AND e.date_key=voice_jobs.date AND e.entry_id=json_extract(value,'$.id'))) AS names,
      (SELECT json_group_array(json(value)) FROM json_each(foods)
        WHERE NOT EXISTS(SELECT 1 FROM macro_entries e WHERE e.device_id=voice_jobs.profile
          AND e.date_key=voice_jobs.date AND e.entry_id=json_extract(value,'$.id'))) AS remaining FROM voice_jobs
      WHERE profile=? AND date=? AND phase NOT IN ('complete','cancelled') ORDER BY recorded_at`).bind(profile, date).all()
    const version = await c.env.DB.prepare('SELECT MAX(published_version) AS version FROM voice_jobs WHERE profile=? AND date=?').bind(profile, date).first<number>('version')
    return c.json({ jobs: result.results.map(({remaining,...job})=>({...job,foods:JSON.parse(String(remaining))})), version }, 200, { 'Cache-Control': 'no-store' })
  })

  // Transfer only the selected card to the ordinary diary editor. The workflow's
  // insert-if-absent publication respects both this row and an explicit deletion.
  app.post('/macro/voice/:id/card', async c => {
    const profile=c.get('profileId'), id=c.req.param('id'), db=c.env.DB
    const {cardId,action}=await c.req.json<{cardId:string;action:'edit'|'delete'}>()
    if(action!=='edit' && action!=='delete') return c.json({error:'Invalid card action.'},400)
    const job=await db.prepare('SELECT date,phase,attempt,recorded_at,transcript,foods FROM voice_jobs WHERE profile=? AND id=?')
      .bind(profile,id).first<{date:string;phase:string;attempt:number;recorded_at:number;transcript:string;foods:string|null}>()
    if(!job) return c.json({error:'Recording unavailable.'},404)
    const raw=cardId===id && action==='edit'
    const food:MacroDayItem|undefined=raw
      ? {id:id+'-edit',name:'',amount:'',status:'editing_raw',rawText:job.transcript,timestamp:job.recorded_at}
      : (JSON.parse(job.foods || '[]') as MacroDayItem[]).find(item=>item.id===cardId)
    if(!food) return c.json({error:'Food unavailable.'},404)
    const now=Date.now(), phase=raw?'splitting':'estimating'
    const stored=raw?food:{...food,status:'error',estimateError:'Estimate cancelled — edit this entry or tap Retry.'}
    const args=[profile,job.date,food.id]
    const token='voice-card:'+action+':'+food.id
    const changed="EXISTS(SELECT 1 FROM macro_entries WHERE device_id=? AND date_key=? AND entry_id=? AND last_mutation_id=?)"
    const guard=[...args,token]
    const result=await db.batch([
      db.prepare(`INSERT OR IGNORE INTO macro_entries(device_id,date_key,entry_id,ordinal,payload_json,revision,deleted_at,last_mutation_id,updated_at)
        SELECT ?,?,?,?,?,1,?,?,? WHERE EXISTS(SELECT 1 FROM voice_jobs WHERE profile=? AND id=? AND attempt=? AND phase=?)`)
        .bind(...args,job.recorded_at,JSON.stringify(stored),action==='delete'?now:null,token,now,profile,id,job.attempt,phase),
      db.prepare(`INSERT OR IGNORE INTO macro_diary_days(device_id,date_key) SELECT ?,? WHERE ${changed}`).bind(profile,job.date,...guard),
      db.prepare(`UPDATE macro_bundle SET updated_at=MAX(updated_at+1,?) WHERE device_id=? AND ${changed}`).bind(now,profile,...guard),
      db.prepare(`UPDATE voice_jobs SET phase=CASE WHEN ? THEN 'cancelled' ELSE phase END,
        attempt=attempt+?,published_version=(SELECT updated_at FROM macro_bundle WHERE device_id=?)
        WHERE profile=? AND id=? AND attempt=? AND ${changed} RETURNING published_version`)
        .bind(Number(raw),Number(raw),profile,profile,id,job.attempt,...guard),
    ])
    const ack=result[3].results[0]
    if(!ack) return c.json({error:'This card has finished processing. Reopen the updated card.'},409)
    return c.json({id:food.id,version:ack.published_version})
  })

  app.post('/macro/voice/:id/cancel', async c => {
    const date=c.req.query('date'), id=c.req.param('id')
    if(date && /^\d{4}-\d{2}-\d{2}$/.test(date) && /^[a-f0-9-]{36}$/i.test(id)) {
      // Cancellation can arrive before an in-flight audio upload.
      await c.env.DB.prepare("INSERT OR IGNORE INTO voice_jobs(profile,id,date,recorded_at,phase) VALUES(?,?,?,?,'cancelled')")
        .bind(c.get('profileId'),id,date,Date.now()).run()
    }
    await c.env.DB.prepare("UPDATE voice_jobs SET attempt=attempt+1,phase='cancelled' WHERE profile=? AND id=? AND phase NOT IN ('complete','cancelled')")
      .bind(c.get('profileId'), c.req.param('id')).run()
    return c.json({ ok: true })
  })

  app.post('/macro/voice/:id/retry', async c => {
    const profile = c.get('profileId'), id = c.req.param('id'), db = c.env.DB
    await db.prepare("UPDATE voice_jobs SET attempt=attempt+1,phase='queued',error=NULL WHERE profile=? AND id=? AND phase='failed'")
      .bind(profile, id).run()
    const job = await db.prepare('SELECT phase,attempt FROM voice_jobs WHERE profile=? AND id=?').bind(profile, id).first<Ticket>()
    if (!job) return c.json({ error: 'Recording unavailable.' }, 404)
    if (job.phase === 'queued') await dispatch(c.env, { profile, id, attempt: job.attempt })
    return c.json({ id }, 202)
  })
}
