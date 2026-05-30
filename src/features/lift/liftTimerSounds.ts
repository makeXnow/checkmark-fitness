let audioCtx: AudioContext | null = null

function getAudioContext(): AudioContext | null {
  if (typeof window === 'undefined') return null
  if (!audioCtx) {
    const Ctx = window.AudioContext || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!Ctx) return null
    audioCtx = new Ctx()
  }
  if (audioCtx.state === 'suspended') {
    void audioCtx.resume()
  }
  return audioCtx
}

function playTone(
  frequency: number,
  durationSec: number,
  options?: { type?: OscillatorType; gain?: number; when?: number },
) {
  const ctx = getAudioContext()
  if (!ctx) return

  const when = options?.when ?? ctx.currentTime
  const osc = ctx.createOscillator()
  const gain = ctx.createGain()
  osc.type = options?.type ?? 'sine'
  osc.frequency.setValueAtTime(frequency, when)
  gain.gain.setValueAtTime(0.0001, when)
  gain.gain.exponentialRampToValueAtTime(options?.gain ?? 0.22, when + 0.02)
  gain.gain.exponentialRampToValueAtTime(0.0001, when + durationSec)
  osc.connect(gain)
  gain.connect(ctx.destination)
  osc.start(when)
  osc.stop(when + durationSec + 0.05)
}

/** Soft double chirp — ~15 seconds left on this segment. */
export function playLiftTimerWarningSound() {
  const ctx = getAudioContext()
  if (!ctx) return
  const t = ctx.currentTime
  playTone(880, 0.12, { when: t, gain: 0.18 })
  playTone(880, 0.12, { when: t + 0.18, gain: 0.18 })
}

/** Firm single tone — segment complete, move on. */
export function playLiftTimerSegmentCompleteSound() {
  playTone(440, 0.28, { type: 'triangle', gain: 0.26 })
}

/** Ascending finish — entire workout timer done. */
export function playLiftTimerWorkoutCompleteSound() {
  const ctx = getAudioContext()
  if (!ctx) return
  const t = ctx.currentTime
  playTone(523.25, 0.18, { when: t, gain: 0.2 })
  playTone(659.25, 0.18, { when: t + 0.16, gain: 0.22 })
  playTone(783.99, 0.32, { when: t + 0.32, gain: 0.24, type: 'triangle' })
}
