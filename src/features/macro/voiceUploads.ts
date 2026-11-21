import { createStore, promisifyRequest, update } from 'idb-keyval'
export type Upload = { cancelled?:boolean; id: string; date: string; audio: Blob; recordedAt: number; attempts: number; retryAt: number }
let inbox: ReturnType<typeof createStore> | undefined
export const voiceUploadStore = () => inbox ??= createStore('checkmark-voice-uploads', 'recordings')
export const voiceUploadKey = (profile: string, id: string) => profile + '/' + id
export const maxAttempts = 5

export async function deliverVoiceUpload(profile: string, entry: Upload,
  request: (path: string, init: RequestInit) => Promise<Response>) {
  const key = voiceUploadKey(profile, entry.id)
  try {
    const res = await request(entry.date + '/' + entry.id + '?recordedAt=' + entry.recordedAt, { method: 'PUT', body: entry.audio })
    if (!res.ok || (await res.json()).id !== entry.id) throw new Error('Upload was not confirmed.')
    await voiceUploadStore()('readwrite', store => {
      const read=store.get(key)
      read.onsuccess=()=>{if(!read.result?.cancelled)store.delete(key)}
      return promisifyRequest(store.transaction)
    })
    return true
  } catch {
    const attempts = entry.attempts + 1
    entry.attempts = attempts
    entry.retryAt = Date.now() + Math.min(60_000, 1000 * 2 ** attempts)
    // Another tab may already have acknowledged and removed the upload.
    await update<Upload | undefined>(key, current => current ? { ...current, attempts, retryAt: entry.retryAt } : undefined, voiceUploadStore())
    return false
  }
}
