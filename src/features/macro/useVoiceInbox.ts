import type { MacroDayItem } from '../../types/domain'
import { useCallback, useEffect, useRef, useState } from 'react'
import { del, get, keys, set, update } from 'idb-keyval'
import { deliverVoiceUpload, maxAttempts, voiceUploadKey, voiceUploadStore, type Upload } from './voiceUploads'
import { apiFetchForProfile } from '../../core/apiPaths'
import { getApiProfile } from '../../core/apiProfile'

export type VoiceJob = { timestamp?:number; foods?:MacroDayItem[]; id: string; phase: string; transcript?: string; names?: string; error?: string }

export function useVoiceInbox(date: string, onVersion?: (version: number, date: string) => Promise<void>) {
  const profile = getApiProfile()
  const [jobs, setJobs] = useState<VoiceJob[]>([])
  const [uploads, setUploads] = useState<VoiceJob[]>([])
  const [error, setError] = useState('')
  const wake = useRef<() => void>(() => { })
  useEffect(() => {
    if (!profile) return
    let active = true, running = false, again = false
    let timer: ReturnType<typeof setTimeout>
    const request = (suffix: string, init?: RequestInit) => apiFetchForProfile(profile, '/macro/voice/' + suffix, {
      cache: 'no-store', signal: AbortSignal.timeout(30_000), ...init,
    })
    const sync = async () => {
      if (!active) return
      clearTimeout(timer)
      if (running) { again = true; return }
      if (document.hidden) return
      running = true
      let delay = 45_000
      try {
        const local: VoiceJob[] = []
        for (const key of await keys(voiceUploadStore())) {
          if (!String(key).startsWith(profile + '/')) continue
          const entry = await get<Upload>(key, voiceUploadStore())
          if (!entry) continue
          if (entry.cancelled) {
            const res=await request(entry.id+'/cancel?date='+entry.date,{method:'POST'})
            if(res.ok) await del(key,voiceUploadStore())
            continue
          }
          if (entry.attempts < maxAttempts && Date.now() >= entry.retryAt && navigator.onLine) {
            if (await deliverVoiceUpload(profile, entry, request)) continue
          }
          if (entry.attempts < maxAttempts && navigator.onLine) delay = Math.min(delay, Math.max(500, entry.retryAt - Date.now()))
          if (entry.date === date) local.push({ id: entry.id, timestamp:entry.recordedAt, phase: entry.attempts >= maxAttempts ? 'uploadFailed' : 'uploading' })
        }
        if (active) setUploads(local)
        const response = await request(date)
        if (!response.ok) throw new Error('Could not refresh voice entries.')
        const state = await response.json() as { jobs: VoiceJob[]; version: number }
        if (active) {
          if (state.jobs.some(j => j.phase !== 'failed')) delay = Math.min(delay, 2000)
          if (state.version) await onVersion?.(state.version, date)
          if(active)setJobs(state.jobs)
        }
      } catch { /* Retain the last view and retry after reconnecting. */ }
      finally {
        running = false
        if (active) { timer = setTimeout(sync, again ? 0 : delay); again = false }
      }
    }
    setJobs([]); setUploads([]); setError('')
    wake.current = () => { void sync() }
    void sync()
    window.addEventListener('online', sync)
    document.addEventListener('visibilitychange', sync)
    return () => { active = false; clearTimeout(timer); window.removeEventListener('online', sync); document.removeEventListener('visibilitychange', sync) }
  }, [date, profile, onVersion])

  const enqueue = useCallback(async (profile: string, date: string, id: string, audio: Blob) => {
    await set(voiceUploadKey(profile, id), { id, date, audio, recordedAt: Date.now(), attempts: 0, retryAt: 0 } satisfies Upload, voiceUploadStore())
    setUploads(prev => [...prev, { id, timestamp:Date.now(), phase: 'uploading' }])
    wake.current()
  }, [])
  const act = async (job: VoiceJob, action: 'retry' | 'cancel') => {
    if (!profile) return
    try {
      setError('')
      if ((job.phase==='uploading' || job.phase==='uploadFailed') && action==='cancel') {
        const key=voiceUploadKey(profile,job.id)
        await update<Upload|undefined>(key,entry=>({...entry ?? {id:job.id,date,recordedAt:Date.now(),audio:new Blob(),retryAt:0,attempts:0},cancelled:true}),voiceUploadStore())
        setUploads(prev=>prev.filter(upload=>upload.id!==job.id))
        const res=await apiFetchForProfile(profile,'/macro/voice/'+job.id+'/cancel?date='+date,{method:'POST',signal:AbortSignal.timeout(30_000)})
        if(!res.ok)throw new Error()
        await del(key,voiceUploadStore())
      } else if (job.phase === 'uploadFailed' && action === 'retry') {
        await update<Upload | undefined>(voiceUploadKey(profile, job.id), v => v ? { ...v, attempts: 0, retryAt: 0 } : undefined, voiceUploadStore())
      } else {
        const res = await apiFetchForProfile(profile, '/macro/voice/' + job.id + '/' + action, { method: 'POST', signal: AbortSignal.timeout(30_000) })
        if (!res.ok) throw new Error()
      }
      wake.current()
    } catch { setError('Could not confirm your request. Please try again.') }
  }
  const takeCard=async (job:VoiceJob, cardId:string,action:'edit'|'delete')=>{
    if(!profile)return
    try {
      setError('')
      const res=await apiFetchForProfile(profile,'/macro/voice/'+job.id+'/card',{
        method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({cardId,action}),signal:AbortSignal.timeout(30_000),
      })
      if(!res.ok)throw new Error(res.status===409?'This card has finished processing. Reopen the updated card.':'Could not update the card. Please try again.')
      const ack=await res.json() as {id:string;version:number}
      await onVersion?.(ack.version,date)
      return ack.id
    } catch(e){setError(e instanceof Error?e.message:'Could not update the card.')}
    finally {wake.current()}
  }
  return { takeCard,jobs: [...uploads.filter(u => !jobs.some(j => j.id === u.id)), ...jobs], enqueue, act, error }
}
