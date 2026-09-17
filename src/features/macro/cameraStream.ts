const CACHE_TTL_MS = 20_000
const RELEASE_DELAY_MS = 12_000
const BIND_TIMEOUT_MS = 8_000

let cachedStream: MediaStream | null = null
let cachedAt = 0
let releaseTimer: ReturnType<typeof setTimeout> | null = null
let prewarmPromise: Promise<MediaStream | null> | null = null

function isLikelyMobile(): boolean {
  if (typeof navigator === 'undefined') return false
  if (/Android|iPhone|iPad|iPod/i.test(navigator.userAgent)) return true
  return navigator.maxTouchPoints > 1 && window.innerWidth < 900
}

function isLiveStream(stream: MediaStream): boolean {
  return stream.getVideoTracks().some((t) => t.readyState === 'live')
}

export async function openCameraStream(): Promise<MediaStream> {
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error('Camera requires a secure connection (HTTPS or localhost).')
  }

  const attempts: MediaStreamConstraints[] = isLikelyMobile()
    ? [
        { video: { facingMode: { ideal: 'environment' } }, audio: false },
        { video: { facingMode: 'user' }, audio: false },
        { video: true, audio: false },
      ]
    : [
        { video: { facingMode: 'user' }, audio: false },
        { video: true, audio: false },
      ]

  let lastErr: unknown
  for (const constraints of attempts) {
    try {
      return await navigator.mediaDevices.getUserMedia(constraints)
    } catch (e) {
      lastErr = e
    }
  }
  throw lastErr ?? new Error('Could not open camera')
}

export function takeLiveCachedCameraStream(): MediaStream | null {
  if (!cachedStream || !isLiveStream(cachedStream)) {
    clearCachedCameraStream()
    return null
  }
  if (Date.now() - cachedAt > CACHE_TTL_MS) {
    clearCachedCameraStream()
    return null
  }
  if (releaseTimer) {
    clearTimeout(releaseTimer)
    releaseTimer = null
  }
  return cachedStream
}

export function cacheCameraStream(stream: MediaStream): void {
  if (releaseTimer) {
    clearTimeout(releaseTimer)
    releaseTimer = null
  }
  if (cachedStream && cachedStream !== stream) {
    cachedStream.getTracks().forEach((t) => t.stop())
  }
  cachedStream = stream
  cachedAt = Date.now()
}

export function clearCachedCameraStream(): void {
  if (releaseTimer) {
    clearTimeout(releaseTimer)
    releaseTimer = null
  }
  cachedStream?.getTracks().forEach((t) => t.stop())
  cachedStream = null
  cachedAt = 0
}

/** Start opening the camera before the scan panel mounts (e.g. on scan button press). */
export function prewarmCameraStream(): void {
  if (takeLiveCachedCameraStream()) return
  if (prewarmPromise) return
  prewarmPromise = openCameraStream()
    .then((stream) => {
      cacheCameraStream(stream)
      return stream
    })
    .catch(() => null)
    .finally(() => {
      prewarmPromise = null
    })
}

/** Await an in-flight prewarm or open a new stream. Avoids double getUserMedia on open. */
export async function acquireCameraStream(): Promise<MediaStream> {
  const cached = takeLiveCachedCameraStream()
  if (cached) return cached
  if (prewarmPromise) {
    const warmed = await prewarmPromise
    if (warmed && isLiveStream(warmed)) return warmed
  }
  const stream = await openCameraStream()
  cacheCameraStream(stream)
  return stream
}

/** Keep cache warm briefly after closing the panel so reopen feels instant. */
export function scheduleReleaseCachedCameraStream(): void {
  if (releaseTimer) clearTimeout(releaseTimer)
  releaseTimer = setTimeout(() => {
    releaseTimer = null
    clearCachedCameraStream()
  }, RELEASE_DELAY_MS)
}

function videoHasUsableFrames(video: HTMLVideoElement): boolean {
  return video.readyState >= 2 && video.videoWidth > 0
}

/**
 * Attach a MediaStream to a video element and wait until preview is usable.
 * Must not hang: iOS/Safari often skip re-firing `playing` when reusing a stream,
 * and autoplay `play()` rejection must not leave us waiting forever.
 */
export async function bindStreamToVideo(video: HTMLVideoElement, stream: MediaStream): Promise<void> {
  video.srcObject = stream
  video.muted = true
  video.playsInline = true
  video.setAttribute('playsinline', '')
  video.setAttribute('webkit-playsinline', '')

  if (videoHasUsableFrames(video)) {
    await video.play().catch(() => undefined)
    return
  }

  await new Promise<void>((resolve, reject) => {
    let settled = false

    const finish = (ok: boolean, err?: Error) => {
      if (settled) return
      settled = true
      cleanup()
      if (ok) resolve()
      else reject(err ?? new Error('Camera preview failed to load'))
    }

    const tryReady = () => {
      if (videoHasUsableFrames(video) || (!video.paused && video.videoWidth > 0)) {
        finish(true)
      }
    }

    const onError = () => finish(false, new Error('Camera preview failed to load'))

    const cleanup = () => {
      clearTimeout(timer)
      video.removeEventListener('playing', tryReady)
      video.removeEventListener('loadeddata', tryReady)
      video.removeEventListener('canplay', tryReady)
      video.removeEventListener('error', onError)
    }

    const timer = setTimeout(() => {
      // Frames visible without a playing event still count as ready (common on iOS).
      if (video.videoWidth > 0 || video.readyState >= 2) {
        finish(true)
        return
      }
      finish(false, new Error('Camera preview timed out. Tap Retry.'))
    }, BIND_TIMEOUT_MS)

    video.addEventListener('playing', tryReady)
    video.addEventListener('loadeddata', tryReady)
    video.addEventListener('canplay', tryReady)
    video.addEventListener('error', onError)

    void video
      .play()
      .then(() => {
        tryReady()
      })
      .catch(() => {
        // Autoplay blocked — still succeed if frames are already available.
        tryReady()
      })
  })
}
