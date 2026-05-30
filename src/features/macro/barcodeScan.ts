/** Supported retail barcode lengths (digits only, before GTIN-13 padding). */
const PRODUCT_BARCODE_LENGTHS = new Set([8, 12, 13])

/** Validate GS1 check digit (EAN-8, UPC-A, EAN-13). */
export function isValidGs1CheckDigit(digits: string): boolean {
  if (!/^\d+$/.test(digits) || digits.length < 2) return false
  const body = digits.slice(0, -1)
  const check = parseInt(digits.slice(-1), 10)
  let sum = 0
  for (let i = 0; i < body.length; i++) {
    const d = parseInt(body[body.length - 1 - i]!, 10)
    sum += d * (i % 2 === 0 ? 3 : 1)
  }
  return (10 - (sum % 10)) % 10 === check
}

/** Normalize and validate a product barcode; returns digits or null if invalid. */
export function normalizeProductBarcode(raw: string): string | null {
  const digits = String(raw).replace(/\D/g, '')
  if (!PRODUCT_BARCODE_LENGTHS.has(digits.length)) return null
  if (!isValidGs1CheckDigit(digits)) return null
  return digits
}

export type BarcodeStableTracker = {
  value: string
  count: number
  lastAt: number
}

/** Require repeated identical reads before accepting a scan (reduces false positives). */
export function trackStableBarcodeRead(
  prev: BarcodeStableTracker | null,
  raw: string,
  requiredReads = 3,
  maxGapMs = 1200,
): { next: BarcodeStableTracker | null; confirmed: string | null } {
  const digits = normalizeProductBarcode(raw)
  if (!digits) return { next: null, confirmed: null }

  const now = Date.now()
  if (prev?.value === digits && now - prev.lastAt <= maxGapMs) {
    const next: BarcodeStableTracker = { value: digits, count: prev.count + 1, lastAt: now }
    if (next.count >= requiredReads) return { next: null, confirmed: digits }
    return { next, confirmed: null }
  }

  return { next: { value: digits, count: 1, lastAt: now }, confirmed: null }
}
