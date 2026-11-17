import { createStore, del, get, keys, set } from 'idb-keyval'
import { apiFetchForProfile } from '../../core/apiPaths'
import { getApiProfile } from '../../core/apiProfile'

type SavedFrame = {
  profile: string
  session: string
  sequence: number
  image: Blob
  metadata: Record<string, unknown>
}

let frameStore: ReturnType<typeof createStore> | undefined
const storage = () => frameStore ??= createStore('checkmark-barcode-recordings', 'frames')
let uploading: Promise<void> | undefined

/** Keep failed uploads on the device and retry when another frame is saved or scanning reopens. */
export function uploadPendingBarcodeFrames(): Promise<void> {
  if (uploading) return uploading
  uploading = (async () => {
    for (const key of await keys(storage())) {
      const frame = await get<SavedFrame>(key, storage())
      if (!frame) continue
      const form = new FormData()
      form.set('image', frame.image, 'frame.jpg')
      form.set('metadata', JSON.stringify(frame.metadata))
      const response = await apiFetchForProfile(
        frame.profile,
        `/macro/barcode-recordings/${frame.session}/${frame.sequence}`,
        { method: 'PUT', body: form, signal: AbortSignal.timeout(15_000) },
      )
      if (!response.ok) throw new Error('Scanner frame upload failed')
      await del(key, storage())
    }
  })().finally(() => { uploading = undefined })
  return uploading
}

export function startBarcodeRecording(
  video: HTMLVideoElement,
  scanState: () => Record<string, unknown>,
  onStatus: (message: string) => void,
): { stop: (confirmed?: string) => void } {
  const profile = getApiProfile()
  if (!profile) return { stop: () => undefined }
  const session = crypto.randomUUID()
  const startedAt = Date.now()
  const startedClock = performance.now()
  const canvas = document.createElement('canvas')
  let sequence = 0
  let capturing = false
  let stopped = false
  let saved = 0
  let confirmation: { confirmed: string; confirmedAt: number } | undefined

  const capture = (confirmed?: string) => {
    if (capturing || video.videoWidth === 0 || video.readyState < 2) return
    capturing = true
    const frameNumber = sequence++
    const capturedAt = Date.now()
    // Preserve the actual camera frame for decoder replay, including bars outside the preview.
    canvas.width = video.videoWidth
    canvas.height = video.videoHeight
    const ctx = canvas.getContext('2d')
    if (!ctx) { capturing = false; return }
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height)
    const metadata = {
      session, sequence: frameNumber, startedAt, capturedAt,
      elapsedMs: Math.round(performance.now() - startedClock),
      width: canvas.width, height: canvas.height,
      previewWidth: video.clientWidth, previewHeight: video.clientHeight,
      camera: (video.srcObject as MediaStream | null)?.getVideoTracks()[0]?.getSettings(),
      ...scanState(),
      ...(confirmed ? { confirmed, confirmedAt: capturedAt } : {}),
    }
    canvas.toBlob((image) => {
      capturing = false
      if (!image) { onStatus('Could not save scanner frame'); return }
      const frame: SavedFrame = { profile, session, sequence: frameNumber, image, metadata: { ...metadata, ...confirmation } }
      void set(`${profile}/${session}/${frameNumber}`, frame, storage()).then(async () => {
        saved += 1
        if (!stopped) onStatus(`Recording · ${saved} frames saved`)
        try {
          await uploadPendingBarcodeFrames()
        } catch {
          if (!stopped) onStatus('Recording · upload pending on this device')
        }
      }).catch(() => {
        if (!stopped) onStatus('Could not save scanner frame on this device')
      })
    }, 'image/jpeg', 0.9)
  }

  void uploadPendingBarcodeFrames().catch(() => undefined)
  capture()
  const timer = window.setInterval(() => capture(), 1000)
  return {
    stop(confirmed) {
      if (stopped) return
      stopped = true
      if (confirmed) confirmation = { confirmed, confirmedAt: Date.now() }
      clearInterval(timer)
      if (confirmed) capture(confirmed)
    },
  }
}
