const STRAND_COUNT = 10

type AppLoadingAnimationProps = {
  className?: string
}

/** DNA double-strand loader — same motion as DNAHelix, app emerald palette. */
export function AppLoadingAnimation({ className = '' }: AppLoadingAnimationProps) {
  return (
    <div
      role="status"
      aria-label="Loading"
      className={`flex h-20 items-center gap-1 ${className}`.trim()}
    >
      {Array.from({ length: STRAND_COUNT }, (_, i) => (
        <div key={i} className="flex flex-col gap-4">
          <div
            className="h-2 w-2 rounded-full bg-[var(--color-accent-hover)]"
            style={{
              animation: 'dna-wave 2s ease-in-out infinite',
              animationDelay: `${i * 0.2}s`,
            }}
          />
          <div
            className="h-2 w-2 rounded-full bg-[var(--color-accent-deep)]"
            style={{
              animation: 'dna-wave 2s ease-in-out infinite',
              animationDelay: `${i * 0.2 + 1}s`,
            }}
          />
        </div>
      ))}
    </div>
  )
}
