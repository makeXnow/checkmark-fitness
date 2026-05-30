import { Pause, Play, Square } from 'lucide-react'
import type { LiftTimerController } from './useLiftTimer'

export function LiftTimerHeaderControl({
  timer,
}: {
  timer: Pick<
    LiftTimerController,
    'showControls' | 'isPlaying' | 'isPaused' | 'headerLabel' | 'toggle' | 'clearTimer'
  >
}) {
  if (!timer.showControls) return null

  return (
    <div className="inline-flex shrink-0 items-center gap-1.5">
      <button
        type="button"
        onClick={timer.toggle}
        className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-emerald-500/40 bg-neutral-900/80 px-2.5 py-1.5 text-emerald-300 transition-colors hover:border-emerald-400 hover:bg-neutral-800 active:scale-95"
        aria-label={timer.isPlaying ? 'Pause workout timer' : 'Start workout timer'}
      >
        {timer.isPlaying ? (
          <Pause className="h-4 w-4 fill-current" aria-hidden />
        ) : (
          <Play className="h-4 w-4 fill-current" aria-hidden />
        )}
        <span
          className="min-w-[2.75rem] font-black tabular-nums text-[11px] tracking-wide"
          aria-live="polite"
        >
          {timer.headerLabel}
        </span>
      </button>
      {timer.isPaused ? (
        <button
          type="button"
          onClick={timer.clearTimer}
          className="inline-flex shrink-0 items-center justify-center rounded-full border border-red-500/50 bg-red-950/40 p-1.5 text-red-400 transition-colors hover:border-red-400 hover:bg-red-950/70 hover:text-red-300 active:scale-95"
          aria-label="Stop workout timer"
        >
          <Square className="h-3.5 w-3.5 fill-current" aria-hidden />
        </button>
      ) : null}
    </div>
  )
}
