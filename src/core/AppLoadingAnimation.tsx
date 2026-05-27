import type { CSSProperties } from 'react'

const NUM_PAIRS = 11
const FREQUENCY = 1
const SPEED_S = 2.8
const SHOW_LINKS = true

/** Top / bottom strand colors — theme tokens, cycled per column. */
const TOP_DOT_COLORS = [
  'var(--color-accent-hover)',
  'var(--color-accent)',
  'var(--loader-strand-top-alt)',
  'var(--color-accent)',
] as const
const BOTTOM_DOT_COLORS = [
  'var(--color-accent-deep)',
  'var(--loader-strand-bottom-alt)',
  'var(--color-accent-deep)',
  'var(--loader-strand-bottom-alt)',
] as const

function loaderStyle(): CSSProperties {
  return {
    '--amp': '51px',
    '--speed': `${SPEED_S}s`,
    '--max-size': '16px',
    '--min-scale': 0.375,
    '--max-scale': 1,
    '--min-opacity': 0.25,
    '--max-opacity': 1,
    '--link-width': '1px',
    '--link-opacity': SHOW_LINKS ? 0.3 : 0,
    '--gap': '6px',
    display: 'flex',
    justifyContent: 'center',
    alignItems: 'center',
  } as CSSProperties
}

type AppLoadingAnimationProps = {
  className?: string
}

/** DNA double-helix loader with optional strand links. */
export function AppLoadingAnimation({ className = '' }: AppLoadingAnimationProps) {
  return (
    <div
      role="status"
      aria-label="Loading"
      className={`app-dna-loader ${className}`.trim()}
      style={loaderStyle()}
    >
      {Array.from({ length: NUM_PAIRS }, (_, i) => {
        const delayS = (i / NUM_PAIRS) * FREQUENCY * SPEED_S
        const delay = `-${delayS}s`
        const topColor = TOP_DOT_COLORS[i % TOP_DOT_COLORS.length]
        const bottomColor = BOTTOM_DOT_COLORS[i % BOTTOM_DOT_COLORS.length]

        return (
          <div key={i} className="app-dna-pair">
            {SHOW_LINKS && <div className="app-dna-link" style={{ animationDelay: delay }} />}
            <div
              className="app-dna-dot app-dna-dot-bottom"
              style={{ animationDelay: delay, backgroundColor: bottomColor, color: bottomColor }}
            />
            <div
              className="app-dna-dot app-dna-dot-top"
              style={{ animationDelay: delay, backgroundColor: topColor, color: topColor }}
            />
          </div>
        )
      })}
    </div>
  )
}
