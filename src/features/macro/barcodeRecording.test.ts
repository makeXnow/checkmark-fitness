import 'fake-indexeddb/auto'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { startBarcodeRecording, uploadPendingBarcodeFrames } from './barcodeRecording'

const upload = vi.hoisted(() => vi.fn())
vi.mock('../../core/apiPaths', () => ({ apiFetchForProfile: upload }))
vi.mock('../../core/apiProfile', () => ({ getApiProfile: () => 'scanner-test' }))

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('barcode diagnostic recording', () => {
  it('saves immediately, every second, and on confirmation, then stops capturing', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] })
    vi.stubGlobal('window', globalThis)
    vi.stubGlobal('document', {
      createElement: () => ({
        getContext: () => ({ drawImage: vi.fn() }),
        toBlob: (callback: BlobCallback) => callback(new Blob(['frame'], { type: 'image/jpeg' })),
      }),
    })
    upload.mockResolvedValue({ ok: true })
    const video = {
      videoWidth: 1920, videoHeight: 1080, clientWidth: 400, clientHeight: 225,
      readyState: 2, srcObject: { getVideoTracks: () => [{ getSettings: () => ({ width: 1920 }) }] },
    } as unknown as HTMLVideoElement
    const before = upload.mock.calls.length
    const recording = startBarcodeRecording(video, () => ({ decoder: 'zxing' }), vi.fn())
    await vi.waitFor(() => expect(upload.mock.calls.length).toBe(before + 1))
    vi.advanceTimersByTime(1000)
    await vi.waitFor(() => expect(upload.mock.calls.length).toBe(before + 2))
    recording.stop('788434106757')
    await vi.waitFor(() => expect(upload.mock.calls.length).toBe(before + 3))
    const [, path, init] = upload.mock.calls.at(-1)!
    expect(path).toMatch(/barcode-recordings\/[^/]+\/2$/)
    const metadata = JSON.parse(init.body.get('metadata'))
    expect(metadata.confirmed).toBe('788434106757')
    expect(metadata.width).toBe(1920)
    expect(metadata.camera.width).toBe(1920)
    vi.advanceTimersByTime(4000)
    expect(upload.mock.calls.length).toBe(before + 3)
    await uploadPendingBarcodeFrames()
  })

  it('retains a failed frame and retries it with the original profile and sequence', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] })
    vi.stubGlobal('window', globalThis)
    vi.stubGlobal('document', {
      createElement: () => ({
        getContext: () => ({ drawImage: vi.fn() }),
        toBlob: (callback: BlobCallback) => callback(new Blob(['retry'], { type: 'image/jpeg' })),
      }),
    })
    upload.mockResolvedValue({ ok: false })
    const status = vi.fn()
    const video = { videoWidth: 640, videoHeight: 480, readyState: 2 } as HTMLVideoElement
    const recording = startBarcodeRecording(video, () => ({}), status)
    await vi.waitFor(() => expect(status).toHaveBeenCalledWith('Recording · upload pending on this device'))
    recording.stop()
    const failed = upload.mock.calls.at(-1)!
    upload.mockResolvedValue({ ok: true })
    await uploadPendingBarcodeFrames()
    const retried = upload.mock.calls.at(-1)!
    expect(retried[0]).toBe('scanner-test')
    expect(retried[1]).toBe(failed[1])
    const count = upload.mock.calls.length
    await uploadPendingBarcodeFrames()
    expect(upload.mock.calls.length).toBe(count)
  })
})
