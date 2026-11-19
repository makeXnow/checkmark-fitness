import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from 'cloudflare:workers'
import worker, { parseFoodDescription, transcribeStoredVoice, type Env } from './index'
import { dispatch, voiceKey, type VoiceRequest } from './voiceJobs'
import { readEntry } from './macroEntries'
import { runMacroEstimate } from './macroEstimate'
import { applyEstimateResult } from '../src/features/macro/applyEstimateResult'
import type { MacroDayItem, MacroCustomFood } from '../src/types/domain'
import { withAiUsage } from './aiUsage'
export default {
  ...worker,
  async scheduled(_event: ScheduledController, env: Env) {
    // Repair the gap between the durable receipt and workflow dispatch after a crash.
    const waiting = await env.DB.prepare("SELECT profile,id,attempt FROM voice_jobs WHERE phase='queued' ORDER BY recorded_at LIMIT 50").all<VoiceRequest>()
    for (const job of waiting.results) await dispatch(env, job)
  },
}

type Job = { date: string; recorded_at: number; transcript: string | null; foods: string | null }
export class VoiceDiaryWorkflow extends WorkflowEntrypoint<Env, VoiceRequest> {
  async run(event: WorkflowEvent<VoiceRequest>, step: WorkflowStep) {
    const { profile, id, attempt } = event.payload
    const db = this.env.DB
    const key = [profile, id, attempt]
    const read = () => db.prepare('SELECT * FROM voice_jobs WHERE profile=? AND id=? AND attempt=?')
      .bind(...key).first<Job>()
    const usage = <T>(stage: string, action: () => Promise<T>) => withAiUsage(new Request(
      'https://worker.internal/voice/' + stage, { headers: { 'x-checkmark-profile': profile, 'x-checkmark-source': 'app' } }
    ), db, action)
    try {
      await step.do('Transcribe recording', async () => {
        const job = await read()
        if (!job || job.transcript) return
        await db.prepare("UPDATE voice_jobs SET phase='transcribing' WHERE profile=? AND id=? AND attempt=?").bind(...key).run()
        const audio = await this.env.SCAN_IMAGES!.get(voiceKey(profile, id))
        if (!audio) throw new Error('The saved recording could not be read.')
        const transcript = await usage('transcribe', () => transcribeStoredVoice(this.env, profile, audio))
        await db.prepare('UPDATE voice_jobs SET transcript=? WHERE profile=? AND id=? AND attempt=?').bind(transcript, ...key).run()
      })
      const count = await step.do('Split foods', async () => {
        const job = await read()
        if (!job) return 0
        if (job.foods) {
          await db.prepare("UPDATE voice_jobs SET phase='estimating' WHERE profile=? AND id=? AND attempt=?").bind(...key).run()
          return (JSON.parse(job.foods) as MacroDayItem[]).length
        }
        await db.prepare("UPDATE voice_jobs SET phase='splitting' WHERE profile=? AND id=? AND attempt=?").bind(...key).run()
        const foods = await usage('parse', () => parseFoodDescription(this.env, profile, id, job.transcript!, job.recorded_at))
        await db.prepare("UPDATE voice_jobs SET foods=?,phase='estimating' WHERE profile=? AND id=? AND attempt=?")
          .bind(JSON.stringify(foods), ...key).run()
        return foods.length
      })
      for (let index = 0; index < count; index++) {
        await step.do('Estimate food ' + index, async () => {
          const job = await read()
          if (!job) return
          const food = (JSON.parse(job.foods!) as MacroDayItem[])[index]
          // A committed result, subsequent user edit, or tombstone wins on replay.
          if (await readEntry(db, profile, job.date, food.id)) return
          const library = await db.prepare('SELECT custom_foods_json FROM macro_bundle WHERE device_id=?').bind(profile).first<string>('custom_foods_json')
          const customFoods = JSON.parse(library || '[]') as MacroCustomFood[]
          const estimate = await usage('estimate', () => runMacroEstimate(this.env, { ...food, customFoods }, { profileId: profile }))
          const item = applyEstimateResult(food, estimate, customFoods)
          const now = Date.now()
          // The job generation guards cancellation while the estimate is in flight.
          // INSERT OR IGNORE also preserves a later edit or deletion on replay.
          await db.batch([
            db.prepare(`INSERT OR IGNORE INTO macro_entries(device_id,date_key,entry_id,ordinal,payload_json,revision,updated_at)
              SELECT ?,?,?,?,?,1,? WHERE EXISTS (SELECT 1 FROM voice_jobs WHERE profile=? AND id=? AND attempt=?)`)
              .bind(profile, job.date, item.id, job.recorded_at + index, JSON.stringify(item), now, ...key),
            db.prepare(`INSERT OR IGNORE INTO macro_diary_days(device_id,date_key)
              SELECT ?,? WHERE EXISTS(SELECT 1 FROM macro_entries WHERE device_id=? AND date_key=? AND entry_id=?)`)
              .bind(profile, job.date, profile, job.date, item.id),
            db.prepare(`UPDATE macro_bundle SET updated_at=MAX(updated_at+1,?) WHERE device_id=?
              AND EXISTS (SELECT 1 FROM voice_jobs WHERE profile=? AND id=? AND attempt=?)`).bind(now, profile, ...key),
            db.prepare(`UPDATE voice_jobs SET published_version=(SELECT updated_at FROM macro_bundle WHERE device_id=?)
              WHERE profile=? AND id=? AND attempt=?`).bind(profile, ...key),
          ])
        })
      }
      await step.do('Finish recording', async () => {
        await db.prepare("UPDATE voice_jobs SET phase='complete',error=NULL WHERE profile=? AND id=? AND attempt=?").bind(...key).run()
      })
    } catch (error) {
      await step.do('Save failure', async () => {
        await db.prepare("UPDATE voice_jobs SET phase='failed',error=? WHERE profile=? AND id=? AND attempt=?")
          .bind(error instanceof Error ? error.message : 'Processing failed.', ...key).run()
      })
      throw error
    }
  }
}
