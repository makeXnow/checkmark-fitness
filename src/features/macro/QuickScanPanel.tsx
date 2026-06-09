import { Camera, CameraOff, Loader2, NotebookText, X } from 'lucide-react'
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import {
  bindStreamToVideo,
  cacheCameraStream,
  openCameraStream,
  scheduleReleaseCachedCameraStream,
  takeLiveCachedCameraStream,
} from './cameraStream'
import { trackStableBarcodeRead, type BarcodeStableTracker } from './barcodeScan'
import { startZxingVideoScan } from './zxingScan'

export type QuickScanCaptureState = {
  frontPreview: string | null
  nutritionPreview: string | null
  frontStatus: 'idle' | 'processing' | 'done' | 'error'
  nutritionStatus: 'idle' | 'processing' | 'done' | 'error'
  addToDatabase: boolean
}

type QuickScanPanelProps = {
  addToDatabase: boolean
  frontPreview: string | null
  nutritionPreview: string | null
  frontStatus: QuickScanCaptureState['frontStatus']
  nutritionStatus: QuickScanCaptureState['nutritionStatus']
  onToggleLibrary: () => void
  onCapture: (kind: 'front' | 'nutrition', dataUrl: string) => void
  onClearCapture: (kind: 'front' | 'nutrition') => void
  onBarcodeDetected: (barcode: string) => void
}

declare global {
  interface Window {
    BarcodeDetector?: new (options?: { formats?: string[] }) => {
      detect: (source: ImageBitmapSource) => Promise<Array<{ rawValue: string }>>
    }
  }
}

function captureVideoFrame(video: HTMLVideoElement, canvas: HTMLCanvasElement): string {
  canvas.width = video.videoWidth
  canvas.height = video.videoHeight
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Canvas unavailable')
  ctx.drawImage(video, 0, 0, canvas.width, canvas.height)
  return canvas.toDataURL('image/jpeg', 0.9)
}

function cameraErrorMessage(err: unknown): string {
  if (err instanceof DOMException) {
    if (err.name === 'NotAllowedError') {
      return 'Camera access was blocked. Allow camera for this site in browser settings, then tap Retry.'
    }
    if (err.name === 'NotFoundError') {
      return 'No camera was found on this device.'
    }
    if (err.name === 'NotReadableError') {
      return 'Camera is in use by another app. Close other apps using the camera and try again.'
    }
    if (err.name === 'OverconstrainedError') {
      return 'Could not use the requested camera. Tap Retry to try another camera.'
    }
    if (err.message) return err.message
  }
  if (err instanceof Error && err.message) return err.message
  return 'Could not access the camera. Check permissions and try again.'
}

function CaptureSlot({
  label,
  preview,
  status,
  disabled,
  onCapture,
  onClear,
}: {
  label: string
  preview: string | null
  status: QuickScanCaptureState['frontStatus']
  disabled: boolean
  onCapture: () => void
  onClear: () => void
}) {
  return (
    <div className="relative flex-1 min-w-0 aspect-video rounded-[var(--radius-control)] overflow-hidden bg-black/40 border border-[var(--color-border)]">
      {preview ? (
        <>
          <img src={preview} alt="" className="absolute inset-0 w-full h-full object-cover opacity-70" />
          <span className="absolute bottom-1.5 left-1.5 z-10 text-[9px] font-black uppercase tracking-wider bg-black/70 px-1.5 py-0.5 rounded text-white">
            {label}
          </span>
          {status === 'processing' && (
            <div className="absolute inset-0 z-10 flex items-center justify-center bg-black/40">
              <Loader2 size={22} className="animate-spin text-[var(--color-accent)]" />
            </div>
          )}
          {status === 'done' && (
            <span className="absolute top-1.5 left-1.5 z-10 text-[8px] font-black uppercase tracking-wider text-[var(--color-accent)] bg-black/70 px-1.5 py-0.5 rounded">
              OK
            </span>
          )}
          <button
            type="button"
            onClick={onClear}
            className="absolute top-1.5 right-1.5 z-20 bg-black/70 hover:bg-black/90 text-white rounded-full p-1 transition-colors"
            aria-label={`Clear ${label}`}
          >
            <X size={12} strokeWidth={2.5} />
          </button>
        </>
      ) : (
        <button
          type="button"
          disabled={disabled}
          onClick={onCapture}
          className="absolute inset-0 w-full h-full flex flex-col items-center justify-center gap-1 text-white/40 hover:text-white/80 hover:bg-white/5 transition-colors disabled:opacity-40"
        >
          <Camera size={20} strokeWidth={2} />
          <span className="text-[10px] font-black uppercase tracking-wide">{label}</span>
        </button>
      )}
    </div>
  )
}

export function QuickScanPanel({
  addToDatabase,
  frontPreview,
  nutritionPreview,
  frontStatus,
  nutritionStatus,
  onToggleLibrary,
  onCapture,
  onClearCapture,
  onBarcodeDetected,
}: QuickScanPanelProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const barcodeLockRef = useRef(false)
  const cameraSessionRef = useRef(0)
  const attachInFlightRef = useRef(false)
  const pendingStreamRef = useRef<MediaStream | null>(null)
  const zxingControlsRef = useRef<{ stop: () => void } | null>(null)
  const detectorRef = useRef<InstanceType<NonNullable<typeof window.BarcodeDetector>> | null>(null)
  const barcodeCandidateRef = useRef<BarcodeStableTracker | null>(null)

  const [hasPermission, setHasPermission] = useState<boolean | null>(() =>
    takeLiveCachedCameraStream() ? true : null,
  )
  const [errorMsg, setErrorMsg] = useState('')
  const [cameraReady, setCameraReady] = useState(false)
  const [scanningEnabled, setScanningEnabled] = useState(false)
  const [pendingStream, setPendingStream] = useState<MediaStream | null>(() => takeLiveCachedCameraStream())

  const stopCamera = useCallback(() => {
    cameraSessionRef.current += 1
    attachInFlightRef.current = false
    zxingControlsRef.current?.stop()
    zxingControlsRef.current = null
    streamRef.current = null
    setPendingStream(null)
    pendingStreamRef.current = null
    if (videoRef.current) videoRef.current.srcObject = null
    setCameraReady(false)
    scheduleReleaseCachedCameraStream()
  }, [])

  const attachStreamToVideo = useCallback(async (stream: MediaStream, session: number) => {
    if (attachInFlightRef.current || session !== cameraSessionRef.current) {
      if (stream !== streamRef.current && stream !== takeLiveCachedCameraStream()) {
        stream.getTracks().forEach((t) => t.stop())
      }
      return
    }
    const video = videoRef.current
    if (!video) return

    attachInFlightRef.current = true
    try {
      await bindStreamToVideo(video, stream)
      if (session !== cameraSessionRef.current) return
      streamRef.current = stream
      cacheCameraStream(stream)
      setPendingStream(null)
      pendingStreamRef.current = null
      setCameraReady(true)
      setHasPermission(true)
    } catch (err) {
      if (stream !== streamRef.current) stream.getTracks().forEach((t) => t.stop())
      if (session !== cameraSessionRef.current) return
      setHasPermission(false)
      setErrorMsg(cameraErrorMessage(err))
      setCameraReady(false)
      setPendingStream(null)
      pendingStreamRef.current = null
    } finally {
      attachInFlightRef.current = false
    }
  }, [])

  useEffect(() => {
    pendingStreamRef.current = pendingStream
  }, [pendingStream])

  useLayoutEffect(() => {
    if (!pendingStream || !videoRef.current) return
    void attachStreamToVideo(pendingStream, cameraSessionRef.current)
  }, [pendingStream, attachStreamToVideo])

  const setVideoNode = useCallback(
    (node: HTMLVideoElement | null) => {
      videoRef.current = node
      if (node && pendingStreamRef.current) {
        void attachStreamToVideo(pendingStreamRef.current, cameraSessionRef.current)
      }
    },
    [attachStreamToVideo],
  )

  const startCamera = useCallback(async () => {
    const session = ++cameraSessionRef.current
    setErrorMsg('')
    setCameraReady(false)

    const cached = takeLiveCachedCameraStream()
    if (cached) {
      setHasPermission(true)
      setPendingStream(cached)
      pendingStreamRef.current = cached
      return
    }

    setHasPermission(null)
    streamRef.current = null
    setPendingStream(null)
    pendingStreamRef.current = null
    if (videoRef.current) videoRef.current.srcObject = null

    try {
      const stream = await openCameraStream()
      if (session !== cameraSessionRef.current) {
        stream.getTracks().forEach((t) => t.stop())
        return
      }
      cacheCameraStream(stream)
      setPendingStream(stream)
      pendingStreamRef.current = stream
    } catch (err) {
      if (session !== cameraSessionRef.current) return
      setHasPermission(false)
      setErrorMsg(cameraErrorMessage(err))
      setCameraReady(false)
    }
  }, [attachStreamToVideo])

  useEffect(() => {
    if (!cameraReady) {
      setScanningEnabled(false)
      barcodeCandidateRef.current = null
      return
    }
    const t = setTimeout(() => setScanningEnabled(true), 250)
    return () => clearTimeout(t)
  }, [cameraReady])

  useEffect(() => {
    if (typeof window.BarcodeDetector !== 'undefined') {
      try {
        detectorRef.current = new window.BarcodeDetector({
          formats: ['ean_13', 'ean_8', 'upc_a', 'upc_e'],
        })
      } catch {
        detectorRef.current = null
      }
    }
    void startCamera()
    return () => stopCamera()
  }, [startCamera, stopCamera])

  const fireBarcode = useCallback(
    (digits: string) => {
      if (!digits || barcodeLockRef.current) return
      barcodeLockRef.current = true
      barcodeCandidateRef.current = null
      stopCamera()
      onBarcodeDetected(digits)
    },
    [onBarcodeDetected, stopCamera],
  )

  const considerBarcode = useCallback(
    (raw: string) => {
      if (barcodeLockRef.current || !scanningEnabled) return
      const { next, confirmed } = trackStableBarcodeRead(barcodeCandidateRef.current, raw)
      barcodeCandidateRef.current = next
      if (confirmed) fireBarcode(confirmed)
    },
    [fireBarcode, scanningEnabled],
  )

  useEffect(() => {
    if (!cameraReady || !scanningEnabled || barcodeLockRef.current) return
    const video = videoRef.current
    const canvas = canvasRef.current
    if (!video || !canvas) return

    let intervalId: ReturnType<typeof setInterval> | undefined
    let cancelled = false

    const scanWithDetector = async () => {
      if (!detectorRef.current || barcodeLockRef.current || !scanningEnabled) return
      if (video.videoWidth === 0 || video.videoHeight === 0) return
      try {
        const scale = Math.min(640 / video.videoWidth, 1)
        canvas.width = Math.round(video.videoWidth * scale)
        canvas.height = Math.round(video.videoHeight * scale)
        const ctx = canvas.getContext('2d')
        if (!ctx) return
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height)
        const barcodes = await detectorRef.current.detect(canvas)
        if (barcodes.length > 0 && !cancelled) considerBarcode(barcodes[0]!.rawValue)
      } catch {
        /* ignore frame errors */
      }
    }

    if (detectorRef.current) {
      intervalId = setInterval(() => void scanWithDetector(), 350)
    } else if (video) {
      void startZxingVideoScan(video, (text) => {
        if (!cancelled) considerBarcode(text)
      })
        .then((controls) => {
          if (cancelled) {
            controls.stop()
            return
          }
          zxingControlsRef.current = controls
        })
        .catch(() => {
          /* zxing failed to start */
        })
    }

    return () => {
      cancelled = true
      if (intervalId) clearInterval(intervalId)
      zxingControlsRef.current?.stop()
      zxingControlsRef.current = null
    }
  }, [cameraReady, considerBarcode, scanningEnabled])

  const handleManualCapture = useCallback(
    (kind: 'front' | 'nutrition') => {
      const video = videoRef.current
      const canvas = canvasRef.current
      if (!video || !canvas || video.videoWidth === 0) return
      try {
        const dataUrl = captureVideoFrame(video, canvas)
        onCapture(kind, dataUrl)
      } catch {
        /* capture failed */
      }
    },
    [onCapture],
  )

  if (hasPermission === false) {
    return (
      <div className="flex flex-col gap-2 bg-[var(--color-surface)] p-3 rounded-[var(--radius-card)] border border-[var(--color-border)] shadow-2xl">
        <div className="w-full aspect-video rounded-[var(--radius-control)] bg-black/50 border border-[var(--color-border)] flex flex-col items-center justify-center text-center p-4">
          <CameraOff className="w-8 h-8 text-[var(--color-text-muted)] mb-2" />
          <p className="text-xs text-[var(--color-text-muted)] mb-3">{errorMsg}</p>
          <button
            type="button"
            onClick={() => void startCamera()}
            className="px-3 py-1.5 bg-[var(--color-surface-elevated)] hover:bg-white/10 rounded-[var(--radius-control)] text-xs font-semibold text-white transition-colors"
          >
            Retry
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-2 bg-[var(--color-surface)] p-3 rounded-[var(--radius-card)] border border-[var(--color-border)] shadow-2xl">
      <canvas ref={canvasRef} className="hidden" aria-hidden />

      <div className="relative w-full aspect-video rounded-[var(--radius-control)] overflow-hidden bg-black border border-[var(--color-border)]">
        <video
          ref={setVideoNode}
          autoPlay
          playsInline
          muted
          className="absolute inset-0 z-0 w-full h-full object-cover"
        />

        {!cameraReady && (
          <div className="absolute inset-0 z-[5] flex items-center justify-center bg-black/50 pointer-events-none">
            <Loader2 size={24} className="animate-spin text-[var(--color-accent)]" />
          </div>
        )}

        <button
          type="button"
          onClick={onToggleLibrary}
          className={`absolute top-2.5 left-2.5 z-30 p-2.5 rounded-full transition-all border shadow-lg backdrop-blur-md ${
            addToDatabase
              ? 'bg-[var(--color-accent)]/90 border-[var(--color-accent)] text-black'
              : 'bg-black/50 border-[var(--color-border)] text-white/70 hover:bg-black/70'
          }`}
          title={addToDatabase ? 'Save to food library: on' : 'Save to food library: off'}
          aria-pressed={addToDatabase}
        >
          <NotebookText className="w-4 h-4" strokeWidth={2.5} />
        </button>

        {cameraReady && scanningEnabled && (
          <div className="absolute top-2.5 right-2.5 z-20 bg-black/60 backdrop-blur-md px-3 py-1 rounded-full border border-white/10 flex items-center gap-2 pointer-events-none">
            <span className="w-1.5 h-1.5 rounded-full bg-[var(--color-accent)] animate-pulse" />
            <span className="text-[10px] font-black text-white/90 uppercase tracking-wider">Scanning</span>
          </div>
        )}

        {cameraReady && scanningEnabled && (
          <div className="absolute inset-0 z-10 pointer-events-none flex items-center justify-center p-4">
            <div className="relative w-[min(100%,18rem)] aspect-[2.25/1]">
              <div className="absolute top-0 left-0 w-5 h-5 border-t-2 border-l-2 border-white/50 rounded-tl-sm" />
              <div className="absolute top-0 right-0 w-5 h-5 border-t-2 border-r-2 border-white/50 rounded-tr-sm" />
              <div className="absolute bottom-0 left-0 w-5 h-5 border-b-2 border-l-2 border-white/50 rounded-bl-sm" />
              <div className="absolute bottom-0 right-0 w-5 h-5 border-b-2 border-r-2 border-white/50 rounded-br-sm" />
              <div className="absolute left-2 right-2 top-1/2 h-0.5 bg-[var(--color-accent)]/60 shadow-[0_0_8px_rgba(52,211,153,0.5)] macro-scan-line" />
            </div>
          </div>
        )}
      </div>

      <div className="flex gap-2 w-full">
        <CaptureSlot
          label="Front"
          preview={frontPreview}
          status={frontStatus}
          disabled={!cameraReady}
          onCapture={() => handleManualCapture('front')}
          onClear={() => onClearCapture('front')}
        />
        <CaptureSlot
          label="Nutrition"
          preview={nutritionPreview}
          status={nutritionStatus}
          disabled={!cameraReady}
          onCapture={() => handleManualCapture('nutrition')}
          onClear={() => onClearCapture('nutrition')}
        />
      </div>
    </div>
  )
}

export { prewarmCameraStream } from './cameraStream'
