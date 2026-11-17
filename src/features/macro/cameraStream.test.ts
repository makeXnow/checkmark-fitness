import { afterEach, describe, expect, it, vi } from 'vitest'
import { openCameraStream } from './cameraStream'

afterEach(() => vi.unstubAllGlobals())

describe('scanner camera focus', () => {
  it('requests a detailed rear-camera image and continuous focus when supported', async () => {
    const applyConstraints = vi.fn().mockResolvedValue(undefined)
    const stream = { getVideoTracks: () => [{
      getCapabilities: () => ({ focusMode: ['manual', 'continuous'] }), applyConstraints,
    }] }
    const getUserMedia = vi.fn().mockResolvedValue(stream)
    vi.stubGlobal('navigator', {
      userAgent: 'iPhone', mediaDevices: { getUserMedia },
    })
    expect(await openCameraStream()).toBe(stream)
    expect(getUserMedia).toHaveBeenCalledWith({
      video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } },
      audio: false,
    })
    expect(applyConstraints).toHaveBeenCalledWith({ advanced: [{ focusMode: 'continuous' }] })
  })

  it('keeps the working rear camera if the browser rejects focus control', async () => {
    const stream = { getVideoTracks: () => [{
      getCapabilities: () => ({ focusMode: ['continuous'] }),
      applyConstraints: vi.fn().mockRejectedValue(new Error('Unsupported focus control')),
    }] }
    const getUserMedia = vi.fn().mockResolvedValue(stream)
    vi.stubGlobal('navigator', { userAgent: 'iPhone', mediaDevices: { getUserMedia } })
    expect(await openCameraStream()).toBe(stream)
    expect(getUserMedia).toHaveBeenCalledTimes(1)
  })
})
