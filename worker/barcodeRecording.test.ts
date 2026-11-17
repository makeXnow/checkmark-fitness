import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { Miniflare } from 'miniflare'
import { build } from 'esbuild'

describe('scanner frame storage', () => {
  let worker: Miniflare
  const session = '00000000-0000-4000-8000-000000000001'
  beforeAll(async () => {
    const script = (await build({
      entryPoints: ['worker/index.ts'], bundle: true, write: false,
      format: 'esm', platform: 'browser', external: ['node:async_hooks'], target: 'es2022',
    })).outputFiles[0].text
    worker = new Miniflare({
      modules: true, script, compatibilityDate: '2025-12-01', compatibilityFlags: ['nodejs_als'],
      r2Buckets: ['SCAN_IMAGES'],
    })
  })
  afterAll(async () => { await worker?.dispose() })

  it('stores and lists replay metadata, supports retries, and scopes image reads by profile', async () => {
    const body = new FormData()
    body.set('image', new Blob(['jpeg-frame'], { type: 'image/jpeg' }), 'frame.jpg')
    body.set('metadata', JSON.stringify({ capturedAt: 1234, elapsedMs: 1000 }))
    const url = `https://example.test/api/u/scan-test/macro/barcode-recordings/${session}/1`
    for (let attempt = 0; attempt < 2; attempt++) {
      const request = new Request(url, { method: 'PUT', body })
      const response = await worker.dispatchFetch(url, { method: 'PUT', headers: Object.fromEntries(request.headers), body: await request.arrayBuffer() })
      expect(response.status).toBe(200)
    }
    const listing = await worker.dispatchFetch('https://example.test/api/u/scan-test/macro/barcode-recordings')
    const data = await listing.json() as { frames: { key: string; metadata: { elapsedMs: number } }[] }
    expect(data.frames).toHaveLength(1)
    expect(data.frames[0].metadata.elapsedMs).toBe(1000)
    const key = data.frames[0].key
    const image = await worker.dispatchFetch(`https://example.test/api/u/scan-test/macro/scan-images/${key}`)
    expect(await image.text()).toBe('jpeg-frame')
    const denied = await worker.dispatchFetch(`https://example.test/api/u/other-user/macro/scan-images/${key}`)
    expect(denied.status).toBe(404)
    const other = await worker.dispatchFetch('https://example.test/api/u/other-user/macro/barcode-recordings')
    expect((await other.json() as { frames: unknown[] }).frames).toEqual([])
  })

  it('rejects oversized diagnostic metadata without storing a frame', async () => {
    const body = new FormData()
    body.set('image', new Blob(['jpeg'], { type: 'image/jpeg' }), 'frame.jpg')
    body.set('metadata', JSON.stringify({ oversized: 'x'.repeat(1800) }))
    const url = `https://example.test/api/u/scan-test/macro/barcode-recordings/${session}/2`
    const request = new Request(url, { method: 'PUT', body })
    const response = await worker.dispatchFetch(url, {
      method: 'PUT', headers: Object.fromEntries(request.headers), body: await request.arrayBuffer(),
    })
    expect(response.status).toBe(400)
  })
})
