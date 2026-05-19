import type { CSSProperties } from 'react'

const STRAND_COUNT = 10
const DNA_DURATION_S = 2
const DNA_STAGGER_S = 0.2
/** Negative delay jumps into the cycle so the wave is already moving on mount. */
const DNA_PHASE_OFFSET_S = -DNA_DURATION_S / 2

type AppLoadingAnimationProps = {
  className?: string
}

function dnaDotStyle(delayS: number): CSSProperties {
  return {
    animation: `dna-wave ${DNA_DURATION_S}s ease-in-out infinite`,
    animationDelay: `${delayS}s`,
    animationFillMode: 'backwards',
  }
}

/** DNA double-strand loader — same motion as DNAHelix, app emerald palette. */
export function AppLoadingAnimation({ className = '' }: AppLoadingAnimationProps) {
  return (
    <div
      role="status"
      aria-label="Loading"
      className={`flex h-20 items-center gap-1 ${className}`.trim()}
    >
      {Array.from({ length: STRAND_COUNT }, (_, i) => {
        const columnDelay = i * DNA_STAGGER_S + DNA_PHASE_OFFSET_S
        return (
          <div key={i} className="flex flex-col gap-4">
            <div
              className="h-2 w-2 rounded-full bg-[var(--color-accent-hover)]"
              style={dnaDotStyle(columnDelay)}
            />
            <div
              className="h-2 w-2 rounded-full bg-[var(--color-accent-deep)]"
              style={dnaDotStyle(columnDelay + DNA_DURATION_S / 2)}
            />
          </div>
        )
      })}
    </div>
  )
}
