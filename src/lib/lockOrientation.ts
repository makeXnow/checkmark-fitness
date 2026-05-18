type OrientationLockType = 'portrait' | 'portrait-primary'

async function tryLock(lock: (mode: OrientationLockType) => Promise<void>): Promise<boolean> {
  for (const mode of ['portrait-primary', 'portrait'] as const) {
    try {
      await lock(mode)
      return true
    } catch {
      // mode unsupported or lock not allowed in this context
    }
  }
  return false
}

/** Lock display to portrait when the platform allows (PWA / fullscreen). */
export async function lockPortraitOrientation(): Promise<void> {
  const orientation = screen.orientation as ScreenOrientation & {
    lock?: (mode: OrientationLockType) => Promise<void>
  }
  if (orientation?.lock) {
    await tryLock((mode) => orientation.lock!(mode))
    return
  }

  const legacy = screen as Screen & {
    lockOrientation?: (mode: OrientationLockType) => boolean
    mozLockOrientation?: (mode: OrientationLockType) => boolean
    msLockOrientation?: (mode: OrientationLockType) => boolean
  }
  const lock =
    legacy.lockOrientation ?? legacy.mozLockOrientation ?? legacy.msLockOrientation
  if (!lock) return

  for (const mode of ['portrait-primary', 'portrait'] as const) {
    if (lock.call(screen, mode)) return
  }
}

export function initPortraitOrientationLock(): void {
  const relock = () => {
    void lockPortraitOrientation()
  }

  relock()
  screen.orientation?.addEventListener('change', relock)
}
