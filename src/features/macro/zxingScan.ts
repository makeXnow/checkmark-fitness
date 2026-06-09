/** Lazy-loaded ZXing fallback when native BarcodeDetector is unavailable. */

export async function startZxingVideoScan(
  video: HTMLVideoElement,
  onBarcode: (text: string) => void,
  scanDelayMs = 350,
): Promise<{ stop: () => void }> {
  const [{ BrowserMultiFormatReader }, { BarcodeFormat, DecodeHintType }] = await Promise.all([
    import('@zxing/browser'),
    import('@zxing/library'),
  ])

  const hints = new Map()
  hints.set(DecodeHintType.POSSIBLE_FORMATS, [
    BarcodeFormat.EAN_13,
    BarcodeFormat.EAN_8,
    BarcodeFormat.UPC_A,
    BarcodeFormat.UPC_E,
  ])

  const reader = new BrowserMultiFormatReader(hints, { delayBetweenScanAttempts: scanDelayMs })
  const controls = await reader.decodeFromVideoElement(video, (result) => {
    if (result) onBarcode(result.getText())
  })
  return controls
}
