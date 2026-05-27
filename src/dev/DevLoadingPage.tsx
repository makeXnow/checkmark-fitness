import { AppLoadingAnimation } from '../core/AppLoadingAnimation'

/** Dev-only: DNA loader centered on black, no chrome or data fetch. */
export function DevLoadingPage() {
  return (
    <div className="flex min-h-dvh items-center justify-center bg-black">
      <AppLoadingAnimation />
    </div>
  )
}
