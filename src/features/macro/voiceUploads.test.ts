import 'fake-indexeddb/auto'
import { get, set } from 'idb-keyval'
import { expect, it, vi } from 'vitest'
import { deliverVoiceUpload, voiceUploadKey, voiceUploadStore, type Upload } from './voiceUploads'

it('retains the original audio through a lost or mismatched acknowledgement and retries the same ID', async () => {
  const entry: Upload = {id:crypto.randomUUID(),date:'2026-11-18',audio:new Blob(['recording']),recordedAt:123,attempts:0,retryAt:0}
  const key = voiceUploadKey('test',entry.id)
  await set(key,entry,voiceUploadStore())
  const request = vi.fn().mockRejectedValueOnce(new Error('Connection lost'))
    .mockResolvedValueOnce(Response.json({id:'another-recording'})).mockResolvedValueOnce(Response.json({id:entry.id}))
  for (let attempt=1;attempt<=2;attempt++) {
    expect(await deliverVoiceUpload('test',entry,request)).toBe(false)
    const retained=await get<Upload>(key,voiceUploadStore())
    expect(await retained?.audio.text()).toBe('recording')
    expect(retained?.attempts).toBe(attempt)
    expect(retained?.retryAt).toBeGreaterThan(Date.now())
  }
  expect(await deliverVoiceUpload('test',entry,request)).toBe(true)
  expect(await get(key,voiceUploadStore())).toBeUndefined()
  expect(new Set(request.mock.calls.map(([url])=>url)).size).toBe(1)
})
