/** Lazy-loaded ZXing fallback when native BarcodeDetector is unavailable. */
export async function startZxingVideoScan(
  video: HTMLVideoElement,
  onBarcode: (text: string) => void,
  scanDelayMs = 80,
  onAttempt?: (attempt: Record<string, unknown>) => void,
): Promise<{ stop: () => void }> {
  const [{ BrowserMultiFormatReader }, { BarcodeFormat, DecodeHintType }] = await Promise.all([
    import('@zxing/browser'),
    import('@zxing/library'),
  ])
  const hints = new Map()
  hints.set(DecodeHintType.POSSIBLE_FORMATS, [
    BarcodeFormat.EAN_13, BarcodeFormat.EAN_8, BarcodeFormat.UPC_A, BarcodeFormat.UPC_E,
  ])
  // Search more scan lines so a curved or off-center code can still be read.
  hints.set(DecodeHintType.TRY_HARDER, true)
  const reader = new BrowserMultiFormatReader(hints)
  const canvas = document.createElement('canvas')
  const context = canvas.getContext('2d', { willReadFrequently: true })
  if (!context) throw new Error('Scanner canvas unavailable')
  let stopped = false
  let timeout: ReturnType<typeof setTimeout> | undefined

  const scan = () => {
    if (stopped) return
    const started = performance.now()
    let value: string | undefined
    if (video.readyState >= 2 && video.videoWidth > 0 && video.videoHeight > 0) {
      // Decode the visible preview first, avoiding off-screen pixels on portrait cameras.
      const previewAspect = video.clientWidth && video.clientHeight
        ? video.clientWidth / video.clientHeight
        : video.videoWidth / video.videoHeight
      const width = Math.min(video.videoWidth, video.videoHeight * previewAspect)
      const height = Math.min(video.videoHeight, video.videoWidth / previewAspect)
      const scale = Math.min(1280 / Math.max(width, height), 1)
      canvas.width = Math.round(width * scale)
      canvas.height = Math.round(height * scale)
      context.drawImage(video, (video.videoWidth - width) / 2, (video.videoHeight - height) / 2,
        width, height, 0, 0, canvas.width, canvas.height)
      try { value = reader.decodeFromCanvas(canvas).getText() } catch { /* Try the next frame. */ }
      onAttempt?.({ at: Date.now(), durationMs: Math.round(performance.now() - started), values: value ? [value] : [] })
      if (value) onBarcode(value)
    }
    if (!stopped) timeout = setTimeout(scan, scanDelayMs)
  }
  // Let the caller install the stop handle before the first callback.
  timeout = setTimeout(scan, 0)
  return { stop: () => { stopped = true; clearTimeout(timeout) } }
}
