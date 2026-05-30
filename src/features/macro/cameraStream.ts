const CACHE_TTL_MS = 20_000
const RELEASE_DELAY_MS = 12_000

let cachedStream: MediaStream | null = null
let cachedAt = 0
let releaseTimer: ReturnType<typeof setTimeout> | null = null

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
  void openCameraStream()
    .then((stream) => {
      cacheCameraStream(stream)
    })
    .catch(() => {
      /* panel will retry and surface errors */
    })
}

/** Keep cache warm briefly after closing the panel so reopen feels instant. */
export function scheduleReleaseCachedCameraStream(): void {
  if (releaseTimer) clearTimeout(releaseTimer)
  releaseTimer = setTimeout(() => {
    releaseTimer = null
    clearCachedCameraStream()
  }, RELEASE_DELAY_MS)
}

export async function bindStreamToVideo(video: HTMLVideoElement, stream: MediaStream): Promise<void> {
  video.srcObject = stream
  video.muted = true
  video.playsInline = true

  if (video.readyState >= 2) {
    await video.play().catch(() => undefined)
    return
  }

  await new Promise<void>((resolve, reject) => {
    const onPlaying = () => {
      cleanup()
      resolve()
    }
    const onError = () => {
      cleanup()
      reject(new Error('Camera preview failed to load'))
    }
    const cleanup = () => {
      video.removeEventListener('playing', onPlaying)
      video.removeEventListener('error', onError)
    }
    video.addEventListener('playing', onPlaying, { once: true })
    video.addEventListener('error', onError, { once: true })
    void video.play().catch(() => undefined)
  })
}
